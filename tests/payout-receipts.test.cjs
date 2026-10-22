const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function load(file,mocks={}) { const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)((name)=>mocks[name]||{},m,m.exports);return m.exports; }
test('history serializes valid ISO dates and falls back from corrupt legacy requested_at',async()=>{
 const rows=[{id:'p',amount:'100',status:'failed',requested_at:'broken',created_at:'2026-10-22T10:00:00Z'}];
 const q={select(){return this},eq(){return this},order(){return Promise.resolve({data:rows,error:null})}};
 const mapper=fs.existsSync('src/lib/payments/payout-receipt.ts')?load('src/lib/payments/payout-receipt.ts'):{};
 const {PayoutService}=load('src/lib/payments/payout-service.ts',{'../supabase/supabase-admin':{supabaseAdmin:{from:()=>q}},'./payout-receipt':mapper});
 const [p]=JSON.parse(JSON.stringify(await PayoutService.getSellerPayoutHistory('seller')));
 assert.equal(p.requestedAt,'2026-10-22T10:00:00.000Z');
});
test('payout pushes open the individual receipt even with stale settings URL',()=>{
 const r=load('src/lib/notifications/notification-routing.ts');
 for(const type of ['payout_processed','payout_failed']) {
 assert.equal(r.getPushNotificationDestination({type,data:{payoutId:'payout-1',url:'/profile/payout-settings'}}),'/profile/payouts/payout-1');
 assert.deepEqual(r.getNotificationTarget({type,related_id:'payout-1'}),{table:'payout_requests',id:'payout-1',fallback:'/profile/payouts'});
 }
});
