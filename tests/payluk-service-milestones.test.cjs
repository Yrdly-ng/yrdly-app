const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture(data = {}, env = {}) {
  const requests = [], module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('src/lib/payments/payluk-service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', 'process', 'fetch', source)(() => ({}), module, module.exports,
    { env: { PAYLUK_SECRET_KEY: 'sk_test_fixture', ...env } }, async (url, options) => {
      requests.push({ url, ...options });
      return new Response(JSON.stringify({ status: 200, data }), { status: 200 });
    });
  return { service: module.exports.PaylukService, requests };
}
const params = { amount: 3000, purpose: 'Service booking', maxDelivery: 2, deliveryTimeline: 'days',
  milestones: [{ title: 'First half', amount: 1500 }, { title: 'Final half', amount: 1500 }] };
test('milestone creation uses seller identity, buyer-paid native fees and the full principal', async () => {
  const f = fixture({ id: 'escrow' });
  const escrow=await f.service.createMilestoneEscrow('seller', params);assert.equal(escrow.id, 'escrow');assert.equal(escrow.environment,'test');
  const r = f.requests[0], body = JSON.parse(r.body);
  assert.equal(r.url, 'https://staging.api.payluk.ng/v1/escrow/milestone/create');
  assert.equal(r.headers['customer-id'], 'seller');
  assert.equal(body.whoPays, 'buyer');assert.equal(body.amount, 3000);
  assert.equal(body.additionalFee, undefined);assert.equal(body.totalQuantity, 1);
});
test('invalid totals and fractional kobo never reach the provider', async () => {
  const f = fixture();
  for (const change of [{ amount: 3000.001 }, { maxDelivery: 366 }, { milestones: params.milestones.slice(0,1) },
    { milestones: [{ title: 'First', amount: 1500 }, { title: 'Final', amount: 1499 }] }]) {
    await assert.rejects(f.service.createMilestoneEscrow('seller', { ...params, ...change }), /Invalid service milestone/);
  }
  assert.equal(f.requests.length, 0);
});
test('individual confirmation uses buyer identity and authoritative milestone reads are token-addressed', async () => {
  const f = fixture([{ id: 'milestone', status: 'RELEASED' }]);
  await f.service.confirmMilestone('buyer', 'escrow/id', 'milestone/id');
  assert.ok(f.requests[0].url.endsWith('/milestone/confirm/escrow%2Fid/milestone%2Fid'));
  assert.equal(f.requests[0].headers['customer-id'], 'buyer');
  const milestones = await f.service.getMilestones('PY_token');
  assert.equal(milestones[0].status, 'RELEASED');
  assert.ok(f.requests[1].url.endsWith('/milestone/PY_token'));
  assert.equal(f.requests[1].headers['customer-id'], undefined);
  await assert.rejects(fixture({}).service.getMilestones('PY_token'), /Invalid provider milestone response/);
});
function contract() {
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync('src/lib/bookings/milestone-contract.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('exports',code)(module.exports);return module.exports;
}
test('50/50 preserves every kobo and puts the odd kobo in the final release',()=>{
 const {splitBookingMilestones}=contract();
 assert.deepEqual(splitBookingMilestones(3000),[1500,1500]);
 assert.deepEqual(splitBookingMilestones(3000.01),[1500,1500.01]);
 for(const amount of [NaN,Infinity,1199.99,3000.001])assert.throws(()=>splitBookingMilestones(amount));
});
test('release evidence rejects changed IDs, beneficiary substitutions and amounts',()=>{
 const {verifyBookingMilestoneContract:verify}=contract();const expected=[{id:'a',amount:1500},{id:'b',amount:1500}];
 verify(expected,expected);
 for(const actual of [[expected[0],expected[0]],[expected[0],{...expected[1],amount:1499}],[expected[0],{...expected[1],customerId:'other'}]])assert.throws(()=>verify(actual,expected));
});

test('escrow verification binds absent provider environment to authenticated host and rejects mismatches', async () => {
 const f=fixture({id:'escrow'});const result=await f.service.verifyEscrow('PY_token');assert.equal(result.environment,'test');assert.equal(f.requests[0].redirect,'error');
 const live=fixture({id:'escrow'},{PAYLUK_SECRET_KEY:'sk_live_fixture',PAYLUK_BASE_URL:'https://api.payluk.ng'});assert.equal((await live.service.verifyEscrow('PY_token')).environment,'live');
 const mismatch=fixture({id:'escrow',environment:'live'});await assert.rejects(mismatch.service.verifyEscrow('PY_token'),/environment/);
 const wrongHost=fixture({id:'escrow'},{PAYLUK_BASE_URL:'https://api.payluk.ng'});await assert.rejects(wrongHost.service.verifyEscrow('PY_token'),/environment/);assert.equal(wrongHost.requests.length,0);
});
