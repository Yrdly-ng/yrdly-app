const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean DEFAULT false);
 CREATE TABLE businesses(id uuid PRIMARY KEY,owner_id uuid,name text,logo_url text,logo text,image_urls text[] DEFAULT '{}',is_active boolean DEFAULT true,moderation_status text DEFAULT 'approved',mode text DEFAULT 'product',created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE catalog_items(id uuid PRIMARY KEY,business_id uuid,price numeric);
 CREATE TABLE escrow_transactions(id uuid PRIMARY KEY,item_id text,item_type text,buyer_id uuid,seller_id uuid,amount numeric,status text DEFAULT 'pending',payment_provider text DEFAULT 'payluk',payluk_escrow_id text,payluk_tx_ref text,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),completed_at timestamptz,metadata jsonb DEFAULT '{}',delivery_details jsonb DEFAULT '{}');
 CREATE TABLE disputes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid,refund_amount numeric DEFAULT 0,status text DEFAULT 'open');
 CREATE TABLE payment_reconciliation_flags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid,status text DEFAULT 'open',reason text);
 GRANT SELECT,INSERT,UPDATE,DELETE ON users,businesses,catalog_items,escrow_transactions,disputes,payment_reconciliation_flags TO service_role;
 CREATE SCHEMA private;
 CREATE TABLE private.test_clock(value timestamptz); GRANT SELECT ON private.test_clock TO service_role; INSERT INTO private.test_clock VALUES('2026-11-03T12:00:00Z');
 CREATE FUNCTION private.test_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT value FROM private.test_clock $$;`);
  let migration = readFileSync(
    "supabase/migrations/20261031180409_small_business_campaign.sql",
    "utf8",
  );
  migration = migration
    .replaceAll("clock_timestamp()", "private.test_now()")
    .replaceAll("statement_timestamp()", "private.test_now()")
    .replace(/\bnow\(\)/g, "private.test_now()");
  await db.exec(migration);
  let automaticEntry = readFileSync(
    "supabase/migrations/20261101180745_automatic_small_business_campaign_entry.sql",
    "utf8",
  );
  automaticEntry = automaticEntry
    .replaceAll("clock_timestamp()", "private.test_now()")
    .replaceAll("statement_timestamp()", "private.test_now()")
    .replace(/\bnow\(\)/g, "private.test_now()");
  await db.exec(automaticEntry);
  await db.query(
    "INSERT INTO users VALUES($1,true),($2,false),($3,false),($4,false)",
    [id(1), id(2), id(3), id(4)],
  );
  await db.query("INSERT INTO businesses(id,owner_id,name) VALUES($1,$2,$3)", [
    id(20),
    id(2),
    "Owner shop",
  ]);
  await db.query("INSERT INTO catalog_items VALUES($1,$2,3000)", [
    id(30),
    id(20),
  ]);
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `SELECT ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
        args,
      )
    ).rows[0].value;
  const part = (await db.query("SELECT id FROM campaign_participations"))
    .rows[0].id;
  await db.exec("UPDATE private.test_clock SET value='2026-11-04T12:00:00Z'");
  async function order(n = 40, env = "live", extra = {}) {
    await db.query(
      `INSERT INTO escrow_transactions(id,item_id,item_type,buyer_id,seller_id,amount,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id(n),
        id(30),
        extra.itemType || "catalog_item",
        extra.buyer || id(3),
        id(2),
        3000,
        extra.createdAt || "2026-11-04T10:00:00Z",
      ],
    );
    const captured = await rpc("capture_campaign_order", [id(n), env]);
    if (captured)
      await db.query(
        "UPDATE escrow_transactions SET status='paid',payluk_escrow_id=$2,payluk_tx_ref=$3 WHERE id=$1",
        [id(n), "provider-" + n, "token-" + n],
      );
    return captured;
  }
  async function complete(n = 40) {
    await rpc("begin_campaign_receipt", [id(n), id(3)]);
    return rpc("finish_campaign_receipt", [
      id(n),
      id(3),
      "provider-" + n,
      "COMPLETED",
      "2026-11-04T12:00:00Z",
      "live",
    ]);
  }
  const read = (actor = null, admin = false) =>
    rpc("read_sales_campaign", [actor, admin]);
  return { db, rpc, order, complete, read, part };
}

test("catalog completed sale counts once; retries, top/own snapshot and public privacy", async () => {
  const t = await setup();
  try {
    assert.equal(await t.order(), true);
    await t.complete();
    await t.complete();
    const pub = await t.read();
    const mine = await t.read(id(2));
    assert.equal(pub.snapshot.entries[0].completedSales, 1);
    assert.equal(mine.ownEntries[0].completedSales, 1);
    assert.equal(pub.snapshot.id, mine.snapshot.id);
    assert.equal(
      (await t.db.query("SELECT * FROM campaign_sale_evidence")).rows.length,
      1,
    );
    assert.doesNotMatch(
      JSON.stringify(pub),
      /buyerId|sellerId|provider-|token-|ownerId/,
    );
    assert.equal(pub.snapshot.prizeAllocations[0].amountKobo, 50000000);
  } finally {
    await t.db.close();
  }
});
test("paid, manually completed and timed claims cannot manufacture receipt evidence", async () => {
  const t = await setup();
  try {
    await t.order();
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
    await t.db.query(
      "UPDATE escrow_transactions SET status='completed' WHERE id=$1",
      [id(40)],
    );
    assert.equal(await t.rpc("begin_campaign_receipt", [id(40), id(3)]), false);
    await assert.rejects(t.complete(), /Verified buyer release/);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
  } finally {
    await t.db.close();
  }
});
test("test mode, self purchases, personal posts and unknown environment fail closed", async () => {
  const t = await setup();
  try {
    await t.order(40, "test");
    await t.rpc("begin_campaign_receipt", [id(40), id(3)]);
    await t.rpc("finish_campaign_receipt", [
      id(40),
      id(3),
      "provider-40",
      "COMPLETED",
      null,
      "test",
    ]);
    assert.equal(await t.order(41, "live", { buyer: id(2) }), false);
    assert.equal(await t.order(42, "live", { itemType: "post" }), false);
    await assert.rejects(t.order(43, "unknown"), /Unknown payment environment/);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
  } finally {
    await t.db.close();
  }
});
test("buyer authorization, immutable business origin and server-only evidence permissions", async () => {
  const t = await setup();
  try {
    await t.order();
    await assert.rejects(
      t.rpc("begin_campaign_receipt", [id(40), id(4)]),
      /Only the buyer/,
    );
    await assert.rejects(
      t.db.query("UPDATE campaign_sale_evidence SET business_id=$1", [id(99)]),
      /immutable/,
    );
    await t.db.exec("SET ROLE authenticated");
    await assert.rejects(
      t.rpc("capture_campaign_order", [id(40), "live"]),
      /permission denied/,
    );
    await assert.rejects(t.read(id(2)), /permission denied/);
    await assert.rejects(
      t.db.query("SELECT * FROM campaign_sale_evidence"),
      /permission denied/,
    );
  } finally {
    await t.db.close();
  }
});
test("disputes suspend eligibility; dismissed valid payment restores; partial refund never restores", async () => {
  const t = await setup();
  try {
    await t.order();
    await t.complete();
    const before = (await t.read()).snapshot.id;
    await t.db.query("INSERT INTO disputes(id,transaction_id) VALUES($1,$2)", [
      id(60),
      id(40),
    ]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
    assert.notEqual((await t.read()).snapshot.id, before);
    await t.db.query("UPDATE disputes SET status='closed' WHERE id=$1", [
      id(60),
    ]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 1);
    await t.rpc("record_campaign_refund", [id(40)]);
    await t.rpc("record_campaign_refund", [id(40)]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
    await assert.rejects(
      t.db.query("UPDATE campaign_sale_evidence SET refund_confirmed_at=NULL"),
      /immutable/,
    );
    const changes = (
      await t.db.query(
        "SELECT * FROM campaign_audit WHERE action='eligibility_changed'",
      )
    ).rows;
    assert.ok(changes.length >= 5);
  } finally {
    await t.db.close();
  }
});
test("eligible businesses enter automatically and ownership follows the directory", async () => {
  const t = await setup();
  try {
    await t.order();
    await t.complete();
    await t.db.query("INSERT INTO businesses(id,owner_id,name) VALUES($1,$2,$3)", [id(21), id(2), "Second business"]);
    assert.equal((await t.read()).snapshot.participantCount, 2);
    assert.equal((await t.read(id(2))).ownEntries.length, 2);
    await t.db.query("UPDATE businesses SET owner_id=$1 WHERE id=$2", [
      id(4),
      id(20),
    ]);
    assert.equal((await t.read()).snapshot.entries.length, 2);
    await t.db.query("UPDATE businesses SET owner_id=$1 WHERE id=$2", [
      id(2),
      id(20),
    ]);
    assert.equal((await t.read()).snapshot.entries.length, 2);
  } finally {
    await t.db.close();
  }
});
test("order creation and completion must be inside the campaign window", async () => {
  const t = await setup();
  try {
    assert.equal(
      await t.order(40, "live", { createdAt: "2026-10-31T22:59:59Z" }),
      false,
    );
    assert.equal(
      await t.order(41, "live", { createdAt: "2026-11-02T12:00:00Z" }),
      true,
    );
    await t.order(42);
    await t.db.exec(
      "UPDATE private.test_clock SET value='2026-11-30T22:59:59.999Z'",
    );
    await t.rpc("begin_campaign_receipt", [id(42), id(3)]);
    await t.rpc("finish_campaign_receipt", [
      id(42),
      id(3),
      "provider-42",
      "COMPLETED",
      "2026-11-30T22:59:59.999Z",
      "live",
    ]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 1);
    await t.db.exec(
      "UPDATE private.test_clock SET value='2026-11-04T12:00:00Z'",
    );
    await t.order(43);
    await t.rpc("begin_campaign_receipt", [id(43), id(3)]);
    await t.db.exec(
      "UPDATE private.test_clock SET value='2026-11-30T23:00:00Z'",
    );
    await t.rpc("finish_campaign_receipt", [
      id(43),
      id(3),
      "provider-43",
      "COMPLETED",
      "2026-11-30T23:00:00Z",
      "live",
    ]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 1);
  } finally {
    await t.db.close();
  }
});
test("finalization binds reviewed snapshot, waits seven days and never initiates prizes", async () => {
  const t = await setup();
  try {
    await t.order();
    await t.complete();
    const snapshot = (await t.read()).snapshot;
    await assert.rejects(
      t.rpc("admin_sales_campaign", [
        id(1),
        "finalize",
        null,
        "Reviewed all qualifying order evidence",
        snapshot.id,
      ]),
      /Review period/,
    );
    await t.db.exec(
      "UPDATE private.test_clock SET value='2026-12-08T00:00:00Z'",
    );
    await assert.rejects(
      t.rpc("admin_sales_campaign", [
        id(1),
        "finalize",
        null,
        "Reviewed all qualifying order evidence",
        "stale",
      ]),
      /Results changed/,
    );
    const final = await t.rpc("admin_sales_campaign", [
      id(1),
      "finalize",
      null,
      "Reviewed all qualifying order evidence",
      (await t.read()).snapshot.id,
    ]);
    assert.equal(final.campaign.status, "finalized");
    assert.equal(final.snapshot.provisional, false);
    assert.equal(final.prizeRecords.length, 0);
    await t.rpc("record_campaign_refund", [id(40)]);
    const changed = await t.read();
    assert.equal(changed.campaign.integrityReviewRequired, true);
    assert.equal(changed.snapshot.entries[0].completedSales, 1);
    await assert.rejects(
      t.rpc("record_campaign_prize", [
        id(1),
        id(20),
        "verification",
        "verified",
        "Ownership and identity checked",
        null,
        null,
      ]),
      /Reviewed final/,
    );
  } finally {
    await t.db.close();
  }
});

test("equal first-place ranks split exactly 50 million kobo with deterministic remainder; prize records require verification", async () => {
  const t = await setup();
  try {
    await t.order();
    await t.complete();
    for (const n of [70, 80]) {
      await t.db.query("INSERT INTO users VALUES($1,false)", [id(n)]);
      await t.db.query(
        "INSERT INTO businesses(id,owner_id,name) VALUES($1,$2,$3)",
        [id(n + 1), id(n), `Shop ${n}`],
      );
      const part = (
        await t.db.query(
          "SELECT id FROM campaign_participations WHERE owner_id=$1",
          [id(n)],
        )
      ).rows[0].id;
      await t.rpc("admin_sales_campaign", [
        id(1),
        "approve",
        part,
        "Ownership and eligibility verified",
        null,
      ]);
      await t.db.query("INSERT INTO catalog_items VALUES($1,$2,3000)", [
        id(n + 2),
        id(n + 1),
      ]);
      await t.db.query(
        "INSERT INTO escrow_transactions(id,item_id,item_type,buyer_id,seller_id,amount,created_at) VALUES($1,$2,'catalog_item',$3,$4,3000,'2026-11-04T12:00:00Z')",
        [id(n + 3), id(n + 2), id(3), id(n)],
      );
      await t.rpc("capture_campaign_order", [id(n + 3), "live"]);
      await t.db.query(
        "UPDATE escrow_transactions SET status='paid',payluk_escrow_id=$2 WHERE id=$1",
        [id(n + 3), "provider-" + n],
      );
      await t.rpc("begin_campaign_receipt", [id(n + 3), id(3)]);
      await t.rpc("finish_campaign_receipt", [
        id(n + 3),
        id(3),
        "provider-" + n,
        "COMPLETED",
        null,
        "live",
      ]);
    }
    const read = await t.read();
    assert.deepEqual(
      read.snapshot.entries.map((e) => e.rank),
      [1, 1, 1],
    );
    assert.deepEqual(
      read.snapshot.prizeAllocations.map((a) => a.amountKobo),
      [16666667, 16666667, 16666666],
    );
    assert.equal(
      read.snapshot.prizeAllocations.reduce((sum, a) => sum + a.amountKobo, 0),
      50000000,
    );
    await t.db.exec(
      "UPDATE private.test_clock SET value='2026-12-08T00:00:00Z'",
    );
    await t.rpc("admin_sales_campaign", [
      id(1),
      "finalize",
      null,
      "Reviewed completed orders and all participants",
      (await t.read()).snapshot.id,
    ]);
    await assert.rejects(
      t.rpc("record_campaign_prize", [
        id(1),
        id(20),
        "payment",
        "recorded",
        "Recorded separately authorized payment",
        16666667,
        "reference-1",
      ]),
      /verification required/,
    );
    await t.rpc("record_campaign_prize", [
      id(1),
      id(20),
      "verification",
      "verified",
      "Identity and ownership verified",
      null,
      null,
    ]);
    await assert.rejects(
      t.rpc("record_campaign_prize", [
        id(1),
        id(20),
        "payment",
        "recorded",
        "Recorded separately authorized payment",
        16666666,
        "reference-1",
      ]),
      /allocation/,
    );
    await t.rpc("record_campaign_prize", [
      id(1),
      id(20),
      "payment",
      "recorded",
      "Recorded separately authorized payment",
      16666667,
      "reference-1",
    ]);
    await assert.rejects(
      t.rpc("record_campaign_prize", [
        id(1),
        id(20),
        "payment",
        "recorded",
        "Duplicate payment record attempt",
        16666667,
        "reference-2",
      ]),
      /duplicate key/,
    );
    await assert.rejects(
      t.db.exec("DELETE FROM campaign_prize_records"),
      /append-only/,
    );
  } finally {
    await t.db.close();
  }
});

test("multiple businesses owned by one person enter automatically and source data stays private", async () => {
  const t = await setup();
  try {
    await t.db.query(
      "INSERT INTO businesses(id,owner_id,name) VALUES($1,$2,$3)",
      [id(21), id(2), "Second business"],
    );
    const automatic = await t.read(id(2));
    assert.equal(automatic.businesses.length, 2);
    assert.equal(automatic.snapshot.participantCount, 2);
    await t.order();
    await t.complete();
    await t.db.query(
      "INSERT INTO disputes(id,transaction_id,status,refund_amount) VALUES($1,$2,'resolved',1)",
      [id(60), id(40)],
    );
    await t.db.query("UPDATE disputes SET refund_amount=0 WHERE id=$1", [
      id(60),
    ]);
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
    await t.db.exec("SET ROLE service_role");
    const roleRead = await t.read(id(2));
    assert.equal(roleRead.ownEntries.length, 2);
    await t.db.exec("RESET ROLE; SET ROLE authenticated");
    for (const table of [
      "campaign_audit",
      "campaign_order_events",
      "campaign_order_scores",
      "campaign_prize_records",
    ])
      await assert.rejects(
        t.db.query(`SELECT * FROM ${table}`),
        /permission denied/,
      );
  } finally {
    await t.db.close();
  }
});

test("one provider escrow release cannot score under two local order identities", async () => {
  const t = await setup();
  try {
    await t.order(40);
    await t.complete(40);
    await t.order(41);
    await t.db.query(
      "UPDATE escrow_transactions SET payluk_escrow_id='provider-40' WHERE id=$1",
      [id(41)],
    );
    await t.rpc("begin_campaign_receipt", [id(41), id(3)]);
    await assert.rejects(
      t.rpc("finish_campaign_receipt", [
        id(41),
        id(3),
        "provider-40",
        "COMPLETED",
        null,
        "live",
      ]),
      /duplicate key/,
    );
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 1);
    await t.db.query(
      "UPDATE escrow_transactions SET payluk_escrow_id='changed-provider' WHERE id=$1",
      [id(40)],
    );
    assert.equal((await t.read()).snapshot.entries[0].completedSales, 0);
  } finally {
    await t.db.close();
  }
});

test("automatic entry does not require business creators to access private campaign tables", async () => {
 const t=await setup(); try {
 await t.db.exec("GRANT INSERT ON public.businesses TO authenticated");
 await t.db.exec("BEGIN; SET LOCAL ROLE authenticated; INSERT INTO public.businesses(id,owner_id,name) VALUES('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000002','New business'); COMMIT;");
 const rows=await t.db.query("SELECT status FROM public.campaign_participations WHERE business_id='00000000-0000-4000-8000-000000000099'");
 assert.equal(rows.rows[0].status,'approved');
 const rights=await t.db.query("SELECT has_table_privilege('authenticated','public.campaign_participations','INSERT') AS write,has_function_privilege('authenticated','private.sync_small_business_campaign_business()','EXECUTE') AS invoke");
 assert.equal(rights.rows[0].write,false);assert.equal(rights.rows[0].invoke,false);
 } finally {await t.db.close();}
});
