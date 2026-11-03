const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function setup(secret,outcome='ok'){
 let calls=0;const e={};const mocks={'next/server':{NextResponse:{json:(b,o)=>Response.json(b,o)}},'@/lib/events/payluk-event-finance':{advanceNextPaylukEventWithdrawal:async()=>{calls++;if(outcome==='fail')throw Error('private provider data');return{processed:0};}}};
 const code=ts.transpileModule(fs.readFileSync('src/app/api/cron/advance-event-withdrawals/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','exports','process',code)(n=>mocks[n],e,{env:{EVENT_PAYOUT_CRON_SECRET:secret}});
 return {calls:()=>calls,run:header=>e.GET(new Request('https://qa.invalid',{headers:header?{Authorization:header}:{}}))};
}
test('event worker requires its dedicated scheduler secret before any database/provider work',async()=>{
 for(const [secret,header] of [[undefined,undefined],[undefined,'Bearer undefined'],['expected',undefined],['expected','Bearer wrong']]){const f=setup(secret);assert.equal((await f.run(header)).status,401);assert.equal(f.calls(),0);}
});
test('authorized invocation advances one bounded worker and never returns private financial details',async()=>{
 const f=setup('expected');const r=await f.run('Bearer expected');assert.equal(r.status,200);assert.equal(f.calls(),1);const b=await r.json();assert.equal(b.processed,0);assert.ok(b.checkedAt);
 const failed=setup('expected','fail');const error=await failed.run('Bearer expected');assert.equal(error.status,503);assert.ok(!(await error.text()).includes('private provider data'));
});
