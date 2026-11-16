const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const A='4e0d2091-df62-4f90-bf53-f06dac1cfe93';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function runtime({enabled=false,scope='testers',testers=[A],stop,consent=true,provider={success:true}}={}){
 const ledger=new Map(),sent=[];let handler;
 const campaign={enabled,scope,tester_ids:testers};
 const db={rpc:async(name,args)=>{
   assert.equal(name,'daily_prompt_reminder_candidates');
   assert.deepEqual(args.p_testers,scope==='all'?null:testers);
   return {data:ledger.has(A)?[]:[{id:A,notification_settings:{dailyPrompts:consent}}],error:null};
 },functions:{invoke:async(name,{body})=>{assert.equal(name,'send-push-notification');sent.push(body);return {data:provider,error:null}}},
 from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='notification_campaigns'?campaign:{id:'question',question:'Question for today'},error:null}},
 upsert(row,options){assert.equal(options.ignoreDuplicates,true);q.claim=row;return q},update(row){q.update=row;return q},
 then(resolve,reject){
   if(table!=='daily_prompt_reminders')throw Error('Unexpected table '+table);
   if(q.claim){const exists=ledger.has(A);if(!exists)ledger.set(A,q.claim);return Promise.resolve({data:exists?[]:[{prompt_id:'question'}],error:null}).then(resolve,reject)}
   ledger.set(A,{...ledger.get(A),...q.update});return Promise.resolve({error:null}).then(resolve,reject);
 }};return q;}};
 const policy={exports:{}};
 new Function('module','exports',compile(fs.readFileSync('supabase/functions/_shared/daily-prompt-policy.ts','utf8')))(policy,policy.exports);
 const source=compile(fs.readFileSync('supabase/functions/dispatch-daily-prompts/index.ts','utf8'));
 const deps={
  'https://deno.land/std@0.168.0/http/server.ts':{serve:fn=>handler=fn},
  'https://esm.sh/@supabase/supabase-js@2.106.2':{createClient:()=>db},
  '../_shared/daily-prompt-policy.ts':policy.exports,
 };
 const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-16T17:05:00Z']))}static now(){return new Date('2026-11-16T17:05:00Z').getTime()}};
 new Function('require','exports','Deno','Request','Response','Date','console',source)(name=>{assert.ok(deps[name],name);return deps[name]}, {},
 {env:{get:name=>({SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_URL:'https://backend.invalid',DAILY_PROMPT_PUSH_ENABLED:stop})[name]}},Request,Response,FixedDate,{error(){}});
 return {run:async(key='fixture-service')=>{const r=await handler(new Request('https://backend.invalid/functions/v1/dispatch-daily-prompts',{method:'POST',headers:{authorization:'Bearer '+key}}));return {status:r.status,body:await r.json()}},sent,ledger,db,policy:policy.exports};
}
test('internal worker rejects untrusted callers and defaults to no sending',async()=>{
 const r=runtime();assert.equal((await r.run('wrong')).status,403);
 assert.equal((await r.run()).body.skipped,'disabled');assert.equal(r.sent.length,0);
});
test('enabled internal dispatch uses the approved question and safe local destination exactly once',async()=>{
 const r=runtime({enabled:true});assert.equal((await r.run()).body.submitted,1);
 await r.run();assert.equal(r.sent.length,1);
 assert.equal(r.sent[0].payload.url,'/daily-prompts');
 assert.equal(r.sent[0].payload.data.expiresAt,'2026-11-16T23:00:00.000Z');
});
test('an empty cohort, explicit emergency stop and opted-out profile never send',async()=>{
 for(const options of [{enabled:true,testers:[]},{enabled:true,stop:'false'},{enabled:true,consent:false}]){
  const r=runtime(options);await r.run();assert.equal(r.sent.length,0);
 }
});
test('uncertain internal handoffs are durable and never automatically replayed',async()=>{
 const r=runtime({enabled:true,provider:{}});assert.equal((await r.run()).body.uncertain,1);
 await r.run();assert.equal(r.sent.length,1);assert.equal(r.ledger.get(A).status,'uncertain');
});
test('delivery checks enforce the live campaign cohort independently of the scheduler',async()=>{
 const r=runtime({enabled:true});
 assert.equal(await r.policy.dailyPromptRecipientEnabled(r.db,A),true);
 assert.equal(await r.policy.dailyPromptRecipientEnabled(r.db,'other'),false);
 assert.equal(await r.policy.dailyPromptRecipientEnabled(r.db,A,'false'),false);
 const all=runtime({enabled:true,scope:'all'});assert.equal(await all.policy.dailyPromptRecipientEnabled(all.db,'other'),true);
});
