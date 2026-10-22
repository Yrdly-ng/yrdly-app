const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  fixture,
  seller,
  account,
  sale,
} = require("./automatic-payout-flow.test.cjs");

async function scenario(options, run) {
  const h = await fixture({ recovery: true, ...options });
  try {
    await run(h);
  } finally {
    await h.close();
  }
}
async function job(h) {
  return (await h.db.query("SELECT * FROM automatic_payout_recovery")).rows[0];
}

test("new automatic sale enrolls and completes; manual and legacy payouts never enroll", async () => {
  await scenario({}, async (h) => {
    assert.equal((await (await h.complete()).json()).payoutSucceeded, true);
    assert.equal((await job(h)).state, "done");
    assert.equal((await job(h)).attempts, 1);
    assert.equal(h.provider.verifies, 1);
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "idle");
  });
  await scenario({}, async (h) => {
    await h.db.exec("UPDATE escrow_transactions SET status='completed'");
    await h.service.reservePayout(seller, account, 1176);
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "idle");
    assert.equal(await job(h), undefined);
    assert.equal(h.provider.calls.length, 0);
  });
});

test("429, 503 and transport failures retry only after due time, preserving one payout", async (t) => {
  for (const mode of [
    "rate-limit",
    "server-error",
    "html-error",
    "network-error",
  ])
    await t.test(mode, async () => {
      await scenario({ mode }, async (h) => {
        assert.equal(
          (await (await h.complete()).json()).payoutSucceeded,
          false,
        );
        const initial = await job(h);
        assert.equal(initial.action, "retry");
        assert.equal(initial.attempts, 1);
        assert.ok(
          new Date(initial.due_at) - new Date(initial.updated_at) >= 300000,
        );
        assert.equal((await h.recovery.runOne()).status, "idle");
        h.provider.mode = null;
        await h.advance();
        const results = await Promise.all([
          h.recovery.runOne(),
          h.recovery.runOne(),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), ["done", "idle"]);
        assert.equal((await job(h)).attempts, 2);
        assert.equal((await h.payouts()).length, 1);
        assert.equal((await h.payouts())[0].status, "completed");
        assert.equal(h.provider.verifies, 1);
        assert.deepEqual(h.provider.credits, [1165.25]);
      });
    });
});

test("permanent failures and exhausted attempts alert once without more transfers", async () => {
  await scenario({ mode: "invalid-bank" }, async (h) => {
    await h.complete();
    assert.equal((await job(h)).state, "attention");
    assert.equal(
      (
        await h.db.query(
          "SELECT * FROM notifications WHERE data->>'recovery'='attention'",
        )
      ).rows.length,
      1,
    );
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "idle");
    assert.equal(h.provider.verifies, 0);
  });
  await scenario({ mode: "rate-limit" }, async (h) => {
    await h.complete();
    for (let i = 0; i < 3; i++) {
      await h.advance();
      await h.recovery.runOne();
    }
    assert.equal((await job(h)).attempts, 4);
    assert.equal((await job(h)).state, "attention");
    assert.equal(
      (
        await h.db.query(
          "SELECT * FROM notifications WHERE data->>'recovery'='attention'",
        )
      ).rows.length,
      1,
    );
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "idle");
    assert.equal(h.provider.verifies, 0);
  });
});

test("lost verify response reconciles exact history read-only; missing and duplicate history never retry", async () => {
  await scenario({ mode: "verify-timeout" }, async (h) => {
    await h.complete();
    const [payout] = await h.payouts();
    assert.equal(payout.status, "processing");
    assert.equal((await job(h)).action, "reconcile");
    assert.equal(
      (await h.service.getSellerLedgerBalance(seller)).availableBalance,
      0,
    );
    await h.advance();
    const before = h.provider.calls.length;
    assert.equal((await h.recovery.runOne()).status, "reconcile");
    assert.deepEqual(h.provider.calls.slice(before), ["/v1/payment/history"]);
    const entry = {
      reference: payout.transaction_reference,
      transactionType: "withdrawal",
      status: "success",
    };
    h.provider.history = [entry, entry];
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "reconcile");
    h.provider.history = [entry];
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "done");
    assert.equal((await h.payouts())[0].status, "completed");
    assert.equal(h.provider.verifies, 1);
    assert.equal((await job(h)).attempts, 1);
  });
});

test("unresolved submitted payout stops after eight checks and preserves funds", async () => {
  await scenario({ mode: "verify-timeout" }, async (h) => {
    await h.complete();
    for (let i = 0; i < 8; i++) {
      await h.advance();
      await h.recovery.runOne();
    }
    assert.equal((await job(h)).state, "attention");
    assert.equal((await job(h)).checks, 8);
    assert.equal((await h.payouts())[0].status, "processing");
    assert.equal(
      (await h.service.getSellerLedgerBalance(seller)).availableBalance,
      0,
    );
    assert.equal(h.provider.verifies, 1);
  });
});

test("expired lease cannot submit and stale token cannot start or finish", async () => {
  await scenario({}, async (h) => {
    h.provider.beforeIntent = async () => {
      await h.db.exec(
        "UPDATE automatic_payout_recovery SET lease_until=now()-interval '1 second'",
      );
    };
    await h.complete();
    assert.equal(h.provider.verifies, 0);
    const j = await job(h);
    const stale = await h.admin.rpc("start_automatic_payout_attempt", {
      p_payout_id: j.payout_id,
      p_token: j.lease_token,
      p_reference: "stale",
    });
    assert.equal(stale.data, false);
    const done = await h.admin.rpc("finish_automatic_payout_recovery", {
      p_payout_id: j.payout_id,
      p_token: j.lease_token,
      p_action: "done",
      p_delay_seconds: 60,
      p_error: null,
    });
    assert.equal(done.data, false);
  });
});

test("manual retry racing the recovery worker executes at most one transfer", async () => {
  await scenario({ mode: "rate-limit" }, async (h) => {
    await h.complete();
    const [payout] = await h.payouts();
    h.provider.mode = null;
    await h.advance();
    await Promise.all([h.recovery.runOne(), h.retry(payout.id)]);
    assert.equal(h.provider.verifies, 1);
    assert.deepEqual(h.provider.credits, [1165.25]);
    assert.equal((await h.payouts())[0].status, "completed");
  });
});

test("queue privileges exclude public roles and cron requires dedicated secret", async () => {
  await scenario({}, async (h) => {
    const result = await h.db.query(
      "SELECT has_table_privilege('anon','automatic_payout_recovery','SELECT') AS anon_read, has_function_privilege('authenticated','claim_automatic_payout_recovery(uuid)','EXECUTE') AS user_claim, has_function_privilege('service_role','claim_automatic_payout_recovery(uuid)','EXECUTE') AS worker_claim",
    );
    assert.deepEqual(result.rows[0], {
      anon_read: false,
      user_claim: false,
      worker_claim: true,
    });
    assert.equal(
      (await h.cron(new Request("https://yrdly.invalid/cron"))).status,
      401,
    );
    assert.equal(
      (
        await h.cron(
          new Request("https://yrdly.invalid/cron", {
            headers: { Authorization: "Bearer wrong" },
          }),
        )
      ).status,
      401,
    );
    const allowed = await h.cron(
      new Request("https://yrdly.invalid/cron", {
        headers: { Authorization: "Bearer fixture-cron-secret" },
      }),
    );
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).status, "idle");
    assert.equal(h.provider.calls.length, 0);
  });
});

test("manual submitted reference cannot reuse the automatic attempt quote", async () => {
  await scenario({ mode: "verify-timeout" }, async (h) => {
    await h.complete();
    await h.db.exec(
      "UPDATE payout_requests SET transaction_reference='manual-new-attempt'",
    );
    h.provider.history = [
      {
        reference: "manual-new-attempt",
        transactionType: "withdrawal",
        status: "success",
      },
    ];
    await h.advance();
    const before = h.provider.calls.length;
    assert.equal((await h.recovery.runOne()).status, "attention");
    assert.equal(h.provider.calls.length, before);
    assert.equal((await h.payouts())[0].status, "processing");
    assert.equal(h.provider.verifies, 1);
  });
});

test("manual permanent failure cannot inherit an older automatic transient retry", async () => {
  await scenario({ mode: "rate-limit" }, async (h) => {
    await h.complete();
    const [payout] = await h.payouts();
    const original = await job(h);
    h.provider.mode = "invalid-bank";
    h.provider.minuteCalls = 0;
    await h.retry(payout.id);
    assert.equal((await h.payouts())[0].status, "failed");
    assert.notEqual(
      (await h.payouts())[0].transaction_reference,
      original.attempt_reference,
    );
    await h.advance();
    const calls = h.provider.calls.length;
    assert.equal((await h.recovery.runOne()).status, "attention");
    assert.equal(h.provider.calls.length, calls);
    assert.equal(h.provider.verifies, 0);
  });
});
