const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(
  config = { PAYLUK_SECRET_KEY: "sk_live_fixture" },
  failure = false,
) {
  const calls = [];
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync("src/lib/campaigns/order-evidence.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", "process", "console", code)(
    (name) => {
      assert.equal(name, "@/lib/supabase/supabase-admin");
      return {
        supabaseAdmin: {
          rpc: async (name, args) => {
            calls.push({ name, args });
            return { data: true, error: failure ? { code: "fixture" } : null };
          },
        },
      };
    },
    module,
    module.exports,
    { env: config },
    { error() {} },
  );
  return { ...module.exports, calls };
}
const remote = {
  id: "escrow-1",
  status: "COMPLETED",
  state: "CLOSED",
  amount: 3000,
  completedAt: "2026-11-04T12:00:00Z",
};
test("only explicit key and matching host can classify live/test; never expose key", () => {
  const r = load();
  assert.equal(r.campaignPaymentEnvironment(), "live");
  assert.equal(
    r.campaignPaymentEnvironment({ PAYLUK_SECRET_KEY: "sk_test_fixture" }),
    "test",
  );
  for (const cfg of [
    {},
    { PAYLUK_SECRET_KEY: "unknown" },
    {
      PAYLUK_SECRET_KEY: "sk_live_fixture",
      PAYLUK_BASE_URL: "https://staging.api.payluk.ng",
    },
    {
      PAYLUK_SECRET_KEY: "sk_live_fixture",
      PAYLUK_BASE_URL: "https://api.payluk.ng/redirect",
    },
    {
      PAYLUK_SECRET_KEY: "sk_live_fixture",
      PAYLUK_BASE_URL: "https://api.payluk.ng.evil.test",
    },
  ])
    assert.equal(r.campaignPaymentEnvironment(cfg), null);
});
test("wrong provider identities, amounts, automatic claims and open states cannot record release", async () => {
  const r = load();
  for (const patch of [
    { id: "wrong" },
    { amount: 3001 },
    { status: "CLAIMED" },
    { state: "OPENED" },
  ])
    assert.equal(
      await r.finishCampaignReceipt(
        "tx",
        "buyer",
        "escrow-1",
        { ...remote, ...patch },
        3000,
      ),
      false,
    );
  assert.equal(r.calls.length, 0);
  await r.finishCampaignReceipt("tx", "buyer", "escrow-1", remote, 3000);
  assert.equal(r.calls[0].name, "finish_campaign_receipt");
  assert.equal(r.calls[0].args.p_buyer_id, "buyer");
});
test("capture is server-configured, never sends scores and fails before provider operations on uncertain persistence", async () => {
  const r = load();
  await r.captureCampaignOrder("tx");
  assert.deepEqual(r.calls[0], {
    name: "capture_campaign_order",
    args: { p_transaction_id: "tx", p_environment: "live" },
  });
  await assert.rejects(
    load({}, false).captureCampaignOrder("tx"),
    /No payment has been started/,
  );
  await assert.rejects(
    load(undefined, true).beginCampaignReceipt("tx", "buyer"),
    /requires reconciliation/,
  );
});
