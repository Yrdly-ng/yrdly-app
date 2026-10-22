const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, seller, account, sale } = require("./automatic-payout-flow.test.cjs");

test("legacy automatic queue cannot transfer even with recovery enabled", async () => {
  const h = await fixture({ recovery: true });
  try {
    await h.complete();
    const { data, error } = await h.admin.rpc("reserve_automatic_seller_payout", {
      p_seller_id: seller, p_account_id: account, p_amount: 1176,
      p_wallet_limit: 1176, p_transaction_id: sale,
    });
    assert.equal(error, null);
    const before = h.provider.calls.length;
    assert.equal((await h.service.processPayout(data.id, data.token)).success, false);
    await h.advance();
    assert.equal((await h.recovery.runOne()).status, "attention");
    assert.equal(h.provider.calls.length, before);
    assert.equal(h.provider.verifies, 0);
    assert.equal((await h.db.query("SELECT state FROM automatic_payout_recovery")).rows[0].state, "attention");
  } finally { await h.close(); }
});

test("disabled recovery and unauthorized cron cannot mutate or transfer funds", async () => {
  const h = await fixture();
  try {
    assert.equal((await h.recovery.runOne()).status, "disabled");
    assert.equal((await h.cron(new Request("https://yrdly.invalid/cron"))).status, 401);
    assert.deepEqual(await h.payouts(), []);
    assert.equal(h.provider.calls.length, 0);
  } finally { await h.close(); }
});


test("submitted legacy transfer reconciles history without verifying or sending again", async () => {
  const h = await fixture({ recovery: true, mode: "verify-timeout" });
  try {
    await h.complete(); await h.withdraw();
    const [payout] = await h.payouts();
    assert.equal(payout.status, "processing");
    await h.db.query(`INSERT INTO automatic_payout_recovery
      (payout_id, action, attempts, provider_debit, net_amount, provider_reference, attempt_reference)
      VALUES ($1, 'reconcile', 1, 1176, 1165.25, $2, $2)`, [payout.id, payout.transaction_reference]);
    await h.advance();
    const before = h.provider.calls.length;
    assert.equal((await h.recovery.runOne()).status, "reconcile");
    assert.deepEqual(h.provider.calls.slice(before), ["/v1/payment/history"]);
    const entry = { reference: payout.transaction_reference, transactionType: "withdrawal", status: "success" };
    h.provider.history = [entry, entry]; await h.advance();
    assert.equal((await h.recovery.runOne()).status, "reconcile");
    h.provider.history = [entry]; await h.advance();
    assert.equal((await h.recovery.runOne()).status, "done");
    assert.equal((await h.payouts())[0].status, "completed");
    assert.equal(h.provider.verifies, 1);
  } finally { await h.close(); }
});

test("event maturity scheduler never initiates bank withdrawals", async () => {
  const h = await fixture();
  try {
    const result = await h.eventService.processMaturedPayouts();
    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0);
    assert.equal(h.provider.calls.length, 0);
    assert.deepEqual(await h.payouts(), []);
  } finally { await h.close(); }
});
