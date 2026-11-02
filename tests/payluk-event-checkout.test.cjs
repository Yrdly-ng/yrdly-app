const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, env = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', 'process', 'require', source)(module, module.exports, { env }, n => n === './payluk-event-finance-config' ? load('src/lib/events/payluk-event-finance-config.ts', env) : require(n));
  return module.exports;
}
const file = 'src/lib/events/payluk-event-checkout.ts';
test('refund finance activation cannot enable event withdrawals without a separate switch', () => {
  const config = 'src/lib/events/payluk-event-finance-config.ts';
  const env = { QA_ENVIRONMENT:'staging',QA_EXPECTED_PROJECT_REF:'jxgpvvehajxegeeozlnl',NEXT_PUBLIC_SUPABASE_URL:'https://jxgpvvehajxegeeozlnl.supabase.co',PAYLUK_BASE_URL:'https://staging.api.payluk.ng',PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED:'true', PAYLUK_SECRET_KEY: 'sk_test_fixture', PAYLUK_EVENT_FINANCE_ENABLED: 'true' };
  assert.equal(load(config, env).paylukEventFinanceEnabled(), true);
  assert.equal(load(config, env).paylukEventWithdrawalsEnabled(), false);
  const enabled = { ...env, PAYLUK_EVENT_WITHDRAWALS_ENABLED: 'true' };
  assert.equal(load(config, enabled).paylukEventWithdrawalsEnabled(), true);
  for (const change of [
    { PAYLUK_EVENT_FINANCE_ENABLED: 'false' },
    { PAYLUK_SECRET_KEY: 'sk_live_fixture' },
    { PAYLUK_BASE_URL: 'https://api.payluk.ng' },
    { PAYLUK_BASE_URL: 'https://staging.api.payluk.ng.attacker.test' },
  ]) assert.equal(load(config, { ...enabled, ...change }).paylukEventWithdrawalsEnabled(), false);
});
test('Payluk ticket checkout requires explicit staging and native commission confirmation', () => {
  const env = { QA_ENVIRONMENT:'staging',QA_EXPECTED_PROJECT_REF:'jxgpvvehajxegeeozlnl',NEXT_PUBLIC_SUPABASE_URL:'https://jxgpvvehajxegeeozlnl.supabase.co',PAYLUK_BASE_URL:'https://staging.api.payluk.ng',PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED:'true', PAYLUK_SECRET_KEY: 'sk_test_fixture', PAYLUK_EVENT_CHECKOUT_ENABLED: 'true' };
  assert.equal(load(file, env).paylukEventCheckoutEnabled(), true);
  for (const change of [
    { PAYLUK_EVENT_CHECKOUT_ENABLED: 'false' }, { PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED: 'false' },
    { PAYLUK_SECRET_KEY: 'sk_live_fixture' }, { PAYLUK_BASE_URL: 'https://api.payluk.ng' },
    { PAYLUK_BASE_URL: 'https://staging.api.payluk.ng.attacker.test' },
  ]) assert.equal(load(file, { ...env, ...change }).paylukEventCheckoutEnabled(), false);
});
test('claim delivery windows round later and enforce the provider 365 day limit', () => {
  const { paylukEventDeliveryDays } = load(file);
  const start = Date.parse('2026-11-01T12:00:00Z');
  for (const hours of [0.1, 24, 24.1, 365 * 24]) {
    const end = start + hours * 3600000;
    const days = paylukEventDeliveryDays(new Date(end).toISOString(), start);
    assert.ok(start + (days + 1) * 86400000 >= end + 86400000);
  }
  for (const end of ['invalid', new Date(start).toISOString(), new Date(start + 366 * 86400000).toISOString()]) {
    assert.throws(() => paylukEventDeliveryDays(end, start), /supported escrow window/);
  }
});
test('native commission matching rejects an additional commission fee and preserves old contracts', () => {
  const { paylukAmountsMatch, paylukEscrowPrincipal } = load('src/lib/payments/payment-state.ts');
  const tx = { amount: 3000, commission: 90, metadata: { payluk_fee_mode: 'native_commission_v1' } };
  assert.equal(paylukEscrowPrincipal(tx), 3000);
  assert.equal(paylukAmountsMatch(tx, { amount: 3000, whoPays: 'seller', additionalFee: 0 }), true);
  assert.equal(paylukAmountsMatch(tx, { amount: 3000, whoPays: 'seller', additionalFee: 90 }), false);
  tx.metadata.payluk_fee_mode = 'seller_commission_v1';
  assert.equal(paylukEscrowPrincipal(tx), 2910);
  assert.equal(paylukAmountsMatch(tx, { amount: 2910, whoPays: 'seller', additionalFee: 90 }), true);
});

test('live event mode requires matching database, key, host and explicit approval', () => {
 const file='src/lib/events/payluk-event-finance-config.ts';
 const env={PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED:'true',PAYLUK_EVENT_LIVE_APPROVED:'true',PAYLUK_EVENT_EXPECTED_PROJECT_REF:'yoiyqxtpmxnrrbqqidcs',NEXT_PUBLIC_SUPABASE_URL:'https://api.yrdly.ng',PAYLUK_SECRET_KEY:'sk_live_fixture',PAYLUK_BASE_URL:'https://api.payluk.ng'};
 assert.equal(load(file,env).paylukEventEnvironment(),'live');
 for(const patch of [{PAYLUK_EVENT_LIVE_APPROVED:'false'},{QA_ENVIRONMENT:'staging'},{NEXT_PUBLIC_SUPABASE_URL:'https://jxgpvvehajxegeeozlnl.supabase.co'},{PAYLUK_SECRET_KEY:'sk_test_fixture'},{PAYLUK_BASE_URL:'https://staging.api.payluk.ng'},{PAYLUK_EVENT_EXPECTED_PROJECT_REF:'other'}])assert.equal(load(file,{...env,...patch}).paylukEventEnvironment(),null);
 const config=load(file,env);assert.throws(()=>config.assertPaylukEventEnvironment({item_type:'ticket',metadata:{payluk_environment:'test',payluk_fee_mode:'native_commission_v1'}},{environment:'live'}));
 assert.doesNotThrow(()=>config.assertPaylukEventEnvironment({item_type:'ticket',metadata:{payluk_environment:'live',payluk_fee_mode:'native_commission_v1'}},{environment:'live'}));
});

function refundFixture({status='ONGOING',state='OPENED',environment='test',owner='owner',rpcError=null,providerFailure=false}={}){
 const module={exports:{}};let mutations=0,reads=0;
 const rows={tickets:{event_id:'event',payment_tx_ref:'order'},events:{organizer_id:owner},escrow_transactions:{item_type:'ticket',payment_provider:'payluk',payluk_tx_ref:'PY_ticket',payluk_escrow_id:'escrow',amount:1200,commission:36,metadata:{payluk_fee_mode:'native_commission_v1',payluk_environment:'test'}}};
 const db={from(table){const q={select(){return q},eq(){return q},single:async()=>({data:rows[table]})};return q},rpc:async()=>{mutations++;return{data:{id:'request'},error:rpcError}}};
 const mocks={'server-only':{},'@/lib/supabase/supabase-admin':{supabaseAdmin:db},'@/lib/payments/payluk-service':{PaylukService:{verifyEscrow:async()=>{reads++;if(providerFailure)throw Error('Provider unavailable');return{id:'escrow',environment,state,status,amount:1200,fee:60,whoPays:'seller',additionalFee:0}}}},'@/lib/payments/payluk-onboarding':{},'@/lib/payments/payment-state':{paylukAmountsMatch:()=>true},'./payluk-event-finance-config':{paylukEventFinanceEnabled:()=>true,paylukEventEnvironment:()=>'test'},'./event-finance-error':{EventFinanceError:class extends Error{constructor(m,status=409){super(m);this.status=status}}}};
 const code=ts.transpileModule(fs.readFileSync('src/lib/events/payluk-event-finance.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',code)(n=>mocks[n]||require(n),module,module.exports);
 return{request:()=>module.exports.requestPaylukTicketRefund('ticket','owner','Refund test reason'),mutations:()=>mutations,reads:()=>reads};
}
test('ticket refunds reject closed provider funds before creating a request or changing entry',async()=>{
 for(const status of ['COMPLETED','CLAIMED','REFUNDED','SPLIT']){const f=refundFixture({status,state:'CLOSED'});await assert.rejects(f.request(),/cannot refund.*left escrow/i);assert.equal(f.mutations(),0);}
 for(const scenario of [{environment:'live'},{providerFailure:true}]){const f=refundFixture(scenario);await assert.rejects(f.request());assert.equal(f.mutations(),0);}
 const wrong=refundFixture({owner:'someone else'});await assert.rejects(wrong.request(),/Only the event organiser/);assert.equal(wrong.reads(),0);assert.equal(wrong.mutations(),0);
});
test('held ticket refunds remain available and concurrent payout reservations are explicit conflicts',async()=>{
 for(const status of ['ONGOING','DISPUTED','INVESTIGATING']){const f=refundFixture({status});assert.equal((await f.request()).status,'review');assert.equal(f.mutations(),1);}
 const reserved=refundFixture({rpcError:{message:'event_payout_already_reserved'}});await assert.rejects(reserved.request(),/already being processed/);
});
