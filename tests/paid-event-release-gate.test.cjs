const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
test('disabled Paystack cannot fall back to Payluk or reserve paid tickets',async()=>{
 for(const env of [{PAYSTACK_EVENT_CHECKOUT_ENABLED:'false'},{PAYLUK_EVENT_CHECKOUT_ENABLED:'true',PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED:'true',PAYLUK_SECRET_KEY:'sk_live_fixture',PAYLUK_BASE_URL:'https://api.payluk.ng'}]){
 let financialCalls=0;const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync('src/lib/events/ticket-checkout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports','process',code)(name=>name.endsWith('paystack-service')?{getPaystackEventMode:()=>null}:name.endsWith('supabase-admin')?{supabaseAdmin:{rpc:()=>{financialCalls++;throw Error('Must not reserve');},from:()=>{financialCalls++;throw Error('Must not query');}}}:{},module,module.exports,{env});
 await assert.rejects(module.exports.createTicketCheckout({tier_id:'tier'},'Ticket','2026-12-01'),e=>e.status===503);
 assert.equal(financialCalls,0);
 }
});
