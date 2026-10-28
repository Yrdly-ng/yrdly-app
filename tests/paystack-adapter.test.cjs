const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const ts = require('typescript');
const fs = require('node:fs');
const source = ts.transpileModule(fs.readFileSync('src/lib/payments/paystack-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function adapter(env) {
  const module={exports:{}};
  new Function('require','module','exports','process','Buffer',source)(name=>name==='server-only'?{}:require(name),module,module.exports,{env},Buffer);
  return module.exports;
}
test('test-on-main needs explicit opt-in, matching project and separately permitted users',()=>{
  const env={PAYSTACK_SECRET_KEY:'sk_test_fixture',PAYSTACK_EVENT_CHECKOUT_ENABLED:'true',VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',PAYSTACK_SANDBOX_PROJECT_REF:'example'};
  assert.equal(adapter(env).getPaystackEventMode(),null);
  env.PAYSTACK_TEST_ON_MAIN='true';
  assert.equal(adapter(env).getPaystackEventMode(),'test');
  assert.equal(adapter(env).paystackSandboxUserAllowed('tester'),false);
  env.PAYSTACK_TEST_ALLOW_ALL_USERS='true';
  assert.equal(adapter(env).paystackSandboxUserAllowed('tester'),true);
  env.PAYSTACK_SANDBOX_PROJECT_REF='different';
  assert.equal(adapter(env).getPaystackEventMode(),null);
});
test('live checkout stays disabled without every operations gate',()=>{
  const env={PAYSTACK_SECRET_KEY:'sk_live_fixture',PAYSTACK_EVENT_CHECKOUT_ENABLED:'true',PAYSTACK_LIVE_ENABLED:'true',PAYSTACK_MANUAL_PAYOUTS_ENABLED:'true'};
  assert.equal(adapter(env).getPaystackEventMode(),null);
  env.PAYSTACK_EVENT_OPERATIONS_APPROVED='true';
  assert.equal(adapter(env).getPaystackEventMode(),'live');
});

test('the activated YRDLY Supabase custom domain matches only its known project',()=>{
  const env={PAYSTACK_SECRET_KEY:'sk_test_fixture',PAYSTACK_EVENT_CHECKOUT_ENABLED:'true',VERCEL_ENV:'production',PAYSTACK_TEST_ON_MAIN:'true',NEXT_PUBLIC_SUPABASE_URL:'https://api.yrdly.ng',PAYSTACK_SANDBOX_PROJECT_REF:'yoiyqxtpmxnrrbqqidcs'};
  assert.equal(adapter(env).getPaystackEventMode(),'test');
  env.PAYSTACK_SANDBOX_PROJECT_REF='another-project';
  assert.equal(adapter(env).getPaystackEventMode(),null);
});
test('signature binds exact raw bytes and malformed signatures fail safely',()=>{
  const key='sk_test_fixture',raw='{"event":"charge.success","data":{}}';
  const api=adapter({PAYSTACK_SECRET_KEY:key});
  const signature=createHmac('sha512',key).update(raw).digest('hex');
  assert.equal(api.verifyPaystackSignature(raw,signature),true);
  assert.equal(api.verifyPaystackSignature(raw+' ',signature),false);
  for(const value of [null,'','xx','a'.repeat(127)]) assert.equal(api.verifyPaystackSignature(raw,value),false);
});
test('currency conversion rejects fractional kobo, negative and unsafe totals',()=>{
  const api=adapter({});
  assert.equal(api.nairaToKobo(3000.01),300001);
  for(const amount of [-1,0.001,Infinity,Number.MAX_SAFE_INTEGER]) assert.throws(()=>api.nairaToKobo(amount));
});
