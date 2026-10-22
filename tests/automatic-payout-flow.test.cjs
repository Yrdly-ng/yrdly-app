const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHmac } = require("node:crypto");
const ts = require("typescript");
const { PGlite } = require("@electric-sql/pglite");

// Real HTTP handlers, payment services and SQL reservation functions. Only
// auth, notifications, unrelated booking fulfillment and external I/O are faked.
// These credentials/hosts are invented. No environment files are ever loaded.
const secret = "sk_test_automatic_payout_fixture";
const seller = "00000000-0000-4000-8000-000000000001";
const buyer = "00000000-0000-4000-8000-000000000002";
const account = "00000000-0000-4000-8000-000000000003";
const sale = "00000000-0000-4000-8000-000000000004";
const numericKeys = new Set([
  "amount",
  "seller_amount",
  "commission",
  "total_amount",
]);
const normalize = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      numericKeys.has(key) && value !== null ? Number(value) : value,
    ]),
  );

function databaseAdapter(db) {
  return {
    async rpc(name, args) {
      assert.ok(
        [
          "reserve_seller_payout",
          "requeue_seller_payout",
          "reserve_automatic_seller_payout",
          "claim_automatic_payout_recovery",
          "start_automatic_payout_attempt",
          "submit_automatic_payout_attempt",
          "requeue_automatic_payout",
          "finish_automatic_payout_recovery",
        ].includes(name),
      );
      const values = Object.values(args);
      try {
        const result = await db.query(
          `SELECT public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
          values,
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table) {
      assert.match(table, /^[a-z_]+$/);
      const filters = [],
        values = [];
      let update,
        insert,
        single = false,
        relation = false,
        limit;
      const bind = (value) => {
        values.push(value);
        return `$${values.length}`;
      };
      const column = (name) => {
        assert.match(name, /^[a-z_]+$/);
        return name;
      };
      const q = {
        select(columns = "*") {
          relation = columns.includes("seller_account:");
          return q;
        },
        eq(key, value) {
          filters.push(`${column(key)} = ${bind(value)}`);
          return q;
        },
        neq(key, value) {
          filters.push(`${column(key)} <> ${bind(value)}`);
          return q;
        },
        in(key, list) {
          filters.push(`${column(key)} IN (${list.map(bind).join(",")})`);
          return q;
        },
        or(expression) {
          filters.push(
            `(${expression
              .split(",")
              .map((term) => {
                const [key, op, ...rest] = term.split(".");
                assert.equal(op, "eq");
                return `${column(key)} = ${bind(rest.join("."))}`;
              })
              .join(" OR ")})`,
          );
          return q;
        },
        limit(n) {
          limit = n;
          return q;
        },
        update(payload) {
          update = payload;
          return q;
        },
        insert(payload) {
          insert = payload;
          return q;
        },
        single() {
          single = true;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        async then(resolve, reject) {
          try {
            const where = filters.length
              ? ` WHERE ${filters.join(" AND ")}`
              : "";
            let sql;
            if (update)
              sql = `UPDATE ${table} SET ${Object.entries(update)
                .map(([k, v]) => `${column(k)} = ${bind(v)}`)
                .join(",")}${where} RETURNING *`;
            else if (insert)
              sql = `INSERT INTO ${table} (${Object.keys(insert).map(column).join(",")}) VALUES (${Object.values(insert).map(bind).join(",")}) RETURNING *`;
            else
              sql = `SELECT * FROM ${table}${where}${limit ? ` LIMIT ${Number(limit)}` : ""}`;
            const result = await db.query(sql, values);
            const rows = result.rows.map(normalize);
            if (relation)
              for (const row of rows)
                row.seller_account = (
                  await db.query("SELECT * FROM seller_accounts WHERE id=$1", [
                    row.account_id,
                  ])
                ).rows[0];
            resolve({ data: single ? rows[0] || null : rows, error: null });
          } catch (error) {
            resolve({ data: null, error });
          }
        },
      };
      return q;
    },
  };
}

async function fixture(options = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE seller_accounts (id uuid PRIMARY KEY, user_id uuid, is_active boolean, is_primary boolean, verification_status text, account_updated_at timestamptz, account_type text, account_details jsonb);
    CREATE TABLE users (id uuid PRIMARY KEY, payluk_customer_id text, phone text, phone_verified boolean, name text, legal_name text, is_admin boolean DEFAULT false);
    CREATE TABLE escrow_transactions (id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid, seller_amount numeric, amount numeric, total_amount numeric, commission numeric, status text, item_id uuid, item_type text, payment_provider text, payluk_escrow_id text, payluk_tx_ref text, payment_reference text, metadata jsonb, completed_at timestamptz, updated_at timestamptz);
    CREATE TABLE payout_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, account_id uuid, amount numeric, status text, transaction_id uuid, payment_provider text, transaction_reference text, failure_reason text, execution_stage text, processed_at timestamptz, receipt_snapshot jsonb);
    CREATE UNIQUE INDEX payout_requests_transaction_id_key ON payout_requests(transaction_id) WHERE transaction_id IS NOT NULL;
    CREATE TABLE disputes (id uuid PRIMARY KEY, transaction_id uuid);
    CREATE TABLE notifications (id uuid DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, related_id uuid, related_type text, is_read boolean, created_at timestamptz, data jsonb);
    INSERT INTO seller_accounts VALUES ('${account}','${seller}',true,true,'verified',now(),'bank_account','{"bank_code":"TEST","account_number":"0000000000","account_name":"Fixture Seller"}');
    INSERT INTO users (id,payluk_customer_id,phone,phone_verified,name,legal_name) VALUES ('${seller}','seller-customer','08000000001',true,'Fixture Seller',null), ('${buyer}','buyer-customer','08000000002',true,'Fixture Buyer',null);
    INSERT INTO escrow_transactions (id,seller_id,buyer_id,seller_amount,amount,total_amount,commission,status,item_type,payment_provider,payluk_escrow_id,payluk_tx_ref) VALUES ('${sale}','${seller}','${buyer}',1176,1200,1200,0,'paid','post','payluk','test-escrow','test-token');
  `);
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261022010913_remove_payout_account_cooldown.sql",
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261022101737_automatic_payout_recovery.sql",
      "utf8",
    ),
  );
  if (options.invalidAccount)
    await db.exec("UPDATE seller_accounts SET verification_status='pending'");
  const provider = {
    calls: [],
    minuteCalls: 0,
    wallet: 0,
    verifies: 0,
    credits: [],
    intents: new Map(),
    mode: options.mode,
    violations: [],
    history: [],
    beforeIntent: null,
  };
  const response = (data, status = 200, message = "OK") =>
    Response.json(
      { status, message, data },
      { status, headers: { "Retry-After": "60" } },
    );
  const forbidden = (message) => {
    provider.violations.push(message);
    throw new Error(message);
  };
  const fakeFetch = async (url, init = {}) => {
    if (new URL(url).origin !== "https://payluk.invalid")
      return forbidden(`Live network prohibited: ${url}`);
    const endpoint = new URL(url).pathname;
    provider.calls.push(endpoint);
    provider.minuteCalls++;
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    if (provider.minuteCalls > 10)
      return response(null, 429, "Too many requests");
    if (endpoint.startsWith("/v1/customer/get/")) {
      const id = endpoint.split("/").at(-1);
      return response({
        customerId: id,
        phone: id === "seller-customer" ? "08000000001" : "08000000002",
      });
    }
    if (endpoint === "/v1/escrow/confirm-payment/test-escrow") {
      assert.equal(init.headers["customer-id"], "buyer-customer");
      provider.wallet = 1176;
      return response({ status: "COMPLETED", state: "CLOSED" });
    }
    assert.equal(init.headers["customer-id"], "seller-customer");
    if (endpoint === "/v1/wallet")
      return response({ mainBalance: provider.wallet, escrowBalance: 0 });
    if (endpoint === "/v1/payment/create-intent") {
      if (provider.mode === "rate-limit")
        return response(null, 429, "Too many requests");
      if (provider.mode === "html-error")
        return new Response("Gateway unavailable", { status: 503 });
      if (provider.mode === "server-error")
        return response(null, 503, "Temporary failure");
      if (provider.mode === "network-error")
        throw new TypeError("fetch failed");
      if (provider.mode === "invalid-bank")
        return response(null, 400, "Invalid account");
      if (provider.beforeIntent) await provider.beforeIntent();
      const body = JSON.parse(init.body);
      assert.equal(body.transactionType, "withdrawal");
      assert.equal(body.withdrawalDetails.accountNumber, "0000000000");
      if (body.amount + 10.75 > provider.wallet)
        return response(null, 400, "Insufficient balance");
      const intent = {
        amount: body.amount,
        fee: 10.75,
        reference: body.reference,
      };
      provider.intents.set(intent.reference, intent);
      return response(intent);
    }
    if (endpoint === "/v1/payment/verify") {
      provider.verifies++;
      const intent = provider.intents.get(JSON.parse(init.body).reference);
      assert.ok(intent, "only a staged reference can execute");
      assert.ok(intent.amount + intent.fee <= provider.wallet);
      const durable = await db.query(
        "SELECT * FROM payout_requests WHERE transaction_reference=$1 AND execution_stage='submitted' AND status='processing'",
        [intent.reference],
      );
      assert.equal(
        durable.rows.length,
        1,
        "reference must be durable before verification",
      );
      provider.wallet -= intent.amount + intent.fee;
      provider.credits.push(intent.amount);
      if (provider.mode === "verify-timeout")
        throw new Error(
          "Fixture: response lost after provider accepted transfer",
        );
      return response({ status: "success" });
    }
    if (endpoint === "/v1/payment/history") return response(provider.history);
    if (endpoint === "/v1/payment/transactions")
      return response({ transactions: [] });
    return forbidden(`Unexpected fixture endpoint: ${endpoint}`);
  };
  const admin = databaseAdapter(db),
    notifications = [];
  const mocks = {
    "supabase-admin": { supabaseAdmin: admin },
    "supabase-server": {
      getAuthenticatedUser: async (request) => ({
        data: {
          user: {
            id:
              request.headers.get("Authorization") === "Bearer seller-fixture"
                ? seller
                : buyer,
          },
        },
        error: null,
      }),
    },
    "server-notification-service": {
      NotificationService: new Proxy(
        {},
        {
          get:
            (_, name) =>
            async (...args) =>
              notifications.push({ name, args }),
        },
      ),
    },
    "server-functions": { invokeServerFunction: async () => ({ error: null }) },
    "server-push-notification": { sendPushNotification: async () => {} },
    "booking-payments": { handlePaylukWebhookEvent: async () => {} },
    "escrow-payment": {},
    "ticket-service": {},
    "dispute-settlement": {},
    "payment-reconciliation": { flagPayment: async () => {} },
  };
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (id) => {
      if (mocks[path.basename(id)]) return mocks[path.basename(id)];
      if (id === "next/server")
        return { NextRequest: Request, NextResponse: { json: Response.json } };
      if (id === "server-only") return {};
      if (id === "@supabase/supabase-js") return { createClient: () => admin };
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`);
      if (id.startsWith("."))
        return load(path.resolve(path.dirname(filename), `${id}.ts`));
      if (id === "crypto" || id === "node:crypto") return require(id);
      throw new Error(`Unexpected dependency: ${id}`);
    };
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        require: localRequire,
        console: { log() {}, warn() {}, error() {} },
        process: {
          env: {
            PAYLUK_SECRET_KEY: secret,
            PAYLUK_BASE_URL: "https://payluk.invalid",
            AUTO_PAYOUT_RECOVERY_ENABLED: options.recovery ? "true" : "false",
            PAYOUT_RECOVERY_CRON_SECRET: "fixture-cron-secret",
          },
        },
        fetch: fakeFetch,
        Request,
        Response,
        Headers,
        URL,
        Buffer,
        AbortSignal,
        FormData,
        setTimeout,
        clearTimeout,
      },
      { filename },
    );
    return module.exports;
  }
  const completion = load(
    "src/app/api/transactions/[id]/complete/route.ts",
  ).POST;
  const webhook = load("src/app/api/webhooks/payluk/route.ts").POST;
  const retryRoute = load(
    "src/app/api/seller/payouts/[payoutId]/retry/route.ts",
  ).POST;
  const requestRoute = load("src/app/api/seller/payouts/request/route.ts").POST;
  const service = load("src/lib/payments/payout-service.ts").PayoutService;
  return {
    db,
    provider,
    service,
    eventService: load("src/lib/events/event-escrow-service.ts").EventEscrowService,
    notifications,
    admin,
    recovery: load("src/lib/payments/automatic-payout-recovery.ts")
      .AutomaticPayoutRecovery,
    cron: load("src/app/api/cron/recover-payouts/route.ts").GET,
    async advance() {
      provider.minuteCalls = 0;
      await db.exec(
        "UPDATE automatic_payout_recovery SET due_at=now()-interval '1 second',lease_until=now()-interval '1 second'; UPDATE payout_recovery_worker SET available_at=now()-interval '1 second'",
      );
    },
    complete: () =>
      completion(
        new Request("https://yrdly.invalid/complete", {
          method: "POST",
          headers: { Authorization: "Bearer buyer-fixture" },
        }),
        { params: Promise.resolve({ id: sale }) },
      ),
    webhook: (signed = true) => {
      const body = JSON.stringify({
        event: "escrow.completed",
        data: {
          id: "test-escrow",
          paymentToken: "test-token",
          status: "COMPLETED",
        },
      });
      return webhook(
        new Request("https://yrdly.invalid/webhook", {
          method: "POST",
          body,
          headers: {
            "x-payluk-signature": signed
              ? createHmac("sha512", secret).update(body).digest("hex")
              : "bad",
          },
        }),
      );
    },
    withdraw: (amount = 1176) => requestRoute(new Request("https://yrdly.invalid/withdraw", {
      method: "POST", headers: { Authorization: "Bearer seller-fixture", "Content-Type": "application/json" }, body: JSON.stringify({ amount }),
    })),
    retry: (payoutId) =>
      retryRoute(
        new Request("https://yrdly.invalid/retry", {
          method: "POST",
          headers: { Authorization: "Bearer seller-fixture" },
        }),
        { params: Promise.resolve({ payoutId }) },
      ),
    payouts: async () =>
      (await db.query("SELECT * FROM payout_requests")).rows.map(normalize),
    async close() {
      await db.close();
      assert.deepEqual(provider.violations, []);
    },
  };
}

if (require.main === module)
  test("seller-controlled withdrawals with all network isolated", async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error("Live network prohibited"); };
    try {
      await t.test("completion and duplicate signed webhooks release funds without a bank transfer", async () => {
        const h = await fixture({ recovery: true });
        try {
          const response = await h.complete();
          assert.equal(response.status, 200);
          assert.equal((await response.json()).withdrawalRequired, true);
          await h.webhook(); await h.webhook();
          assert.equal((await h.webhook(false)).status, 401);
          assert.deepEqual(await h.payouts(), []);
          assert.equal(h.provider.verifies, 0);
          assert.equal(h.provider.wallet, 1176);
          assert.equal((await h.service.getSellerLedgerBalance(seller)).availableBalance, 1176);
          await assert.rejects(h.service.initiateAutoPayout(sale), /disabled/);
          assert.equal(h.provider.verifies, 0);
        } finally { await h.close(); }
      });
      await t.test("standalone signed webhook leaves earnings available for manual withdrawal", async () => {
        const h = await fixture();
        try {
          h.provider.wallet = 1176;
          assert.equal((await h.webhook()).status, 200);
          assert.deepEqual(await h.payouts(), []);
          assert.equal(h.provider.calls.length, 0);
          assert.equal((await h.service.getSellerLedgerBalance(seller)).availableBalance, 1176);
        } finally { await h.close(); }
      });
      await t.test("explicit seller withdrawal transfers once with fees included", async () => {
        const h = await fixture();
        try {
          await h.complete();
          const response = await h.withdraw();
          assert.equal(response.status, 200);
          assert.equal((await response.json()).amountSentToBank, 1165.25);
          assert.equal((await h.payouts())[0].status, "completed");
          assert.equal((await h.payouts())[0].transaction_id, null);
          assert.deepEqual(h.provider.credits, [1165.25]);
          assert.equal(h.provider.verifies, 1);
          assert.equal((await h.service.getSellerLedgerBalance(seller)).availableBalance, 0);
        } finally { await h.close(); }
      });
      await t.test("unverified bank blocks explicit withdrawal but preserves earnings", async () => {
        const h = await fixture({ invalidAccount: true });
        try {
          assert.equal((await h.complete()).status, 200);
          assert.equal((await h.withdraw()).status, 403);
          assert.deepEqual(await h.payouts(), []);
          assert.equal(h.provider.verifies, 0);
        } finally { await h.close(); }
      });
      await t.test("rate-limited withdrawal retries only after explicit seller action", async () => {
        const h = await fixture({ mode: "rate-limit" });
        try {
          await h.complete();
          assert.equal((await h.withdraw()).status, 429);
          const [payout] = await h.payouts();
          assert.equal(payout.status, "failed");
          const calls = h.provider.calls.length;
          await h.webhook();
          assert.equal(h.provider.calls.length, calls);
          h.provider.mode = null; h.provider.minuteCalls = 0;
          assert.equal((await h.retry(payout.id)).status, 200);
          assert.equal(h.provider.verifies, 1);
          assert.equal((await h.payouts()).length, 1);
        } finally { await h.close(); }
      });
      await t.test("uncertain explicit withdrawal remains reserved without another transfer", async () => {
        const h = await fixture({ mode: "verify-timeout" });
        try {
          await h.complete(); await h.withdraw();
          const [payout] = await h.payouts();
          assert.equal(payout.status, "processing");
          assert.equal(payout.execution_stage, "submitted");
          await h.webhook();
          await h.service.processPayout(payout.id);
          assert.equal(h.provider.verifies, 1);
          assert.equal((await h.service.getSellerLedgerBalance(seller)).availableBalance, 0);
        } finally { await h.close(); }
      });
    } finally { globalThis.fetch = originalFetch; }
  });

module.exports = { fixture, seller, buyer, account, sale };
