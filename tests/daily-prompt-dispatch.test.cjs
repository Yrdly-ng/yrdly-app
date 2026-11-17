const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const A='4e0d2091-df62-4f90-bf53-f06dac1cfe93';
function runtime({enabled=true,cohort=A,provider={success:true},lookupFailure=false,consent=true,dedicatedCron=false}={}){
  const ledger=new Map(),calls=[];
  const db={
    async rpc(name,args){
      assert.equal(name,'daily_prompt_reminder_candidates');
      assert.deepEqual(args.p_testers,[A]);
      return {data:ledger.has(A)?[]:[{id:A,notification_settings:{dailyPrompts:consent}}],error:null};
    },
    from(table){
      const q={select(){return q},eq(){return q},
        async maybeSingle(){return {data:{id:'question',question:'Question for today'},error:lookupFailure?{}:null}},
        upsert(row,options){assert.equal(options.ignoreDuplicates,true);q.claim=true;q.row=row;return q},
        update(row){q.update=row;return q},
        then(resolve,reject){
          if(table==='daily_prompt_reminders'){
            if(q.claim){const exists=ledger.has(A);if(!exists)ledger.set(A,q.row);return Promise.resolve({data:exists?[]:[{prompt_id:'question'}],error:null}).then(resolve,reject)}
            ledger.set(A,{...ledger.get(A),...q.update});return Promise.resolve({error:null}).then(resolve,reject);
          }
          throw Error('Unexpected table '+table);
        }};return q;
    }
  };
  const mod={exports:{}};
  const source=fs.readFileSync('src/app/api/cron/daily-prompts/route.ts','utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const dependencies={
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
    '@/lib/supabase/supabase-admin':{supabaseAdmin:db},
    '@/lib/notifications/server-functions':{invokeServerFunction:async(_db,_name,body)=>{calls.push(body);return {data:provider,error:null}}},
    '@/lib/daily-prompts/daily-prompt-clock':{DAILY_PROMPTS_ENABLED:()=>enabled},
    '@/lib/daily-prompts/reminder-policy':{
      dailyReminderWindow:()=>({date:'2026-11-16',eligible:true}),
      dailyReminderExpiresAt:()=> '2026-11-16T23:00:00Z',
      dailyReminderDedupeKey:(d,u)=>`daily_prompt:${d}:${u}`,
      dailyReminderTesterIds:raw=>new Set(raw?raw.split(','):[]),
      shouldOfferDailyReminder:(value,_token,_answered,id,_scope,testers)=>value===true&&testers.has(id),
    }
  };
  new Function('require','module','exports','process','console',js)(
    name=>{assert.ok(dependencies[name],name);return dependencies[name]},mod,mod.exports,
    {env:{CRON_SECRET:dedicatedCron?undefined:'fixture',DAILY_PROMPT_CRON_SECRET:dedicatedCron?'fixture':undefined,DAILY_PROMPT_PUSH_ENABLED:'true',DAILY_PROMPT_PUSH_TESTER_IDS:cohort}}, {error(){}});
  return {run:auth=>mod.exports.GET({headers:new Headers({authorization:auth??'Bearer fixture'})}),calls,ledger};
}
test('unauthenticated, disabled and empty-cohort requests cannot send',async()=>{
  for(const [options,auth,status] of [[{},'wrong',401],[{enabled:false},null,200],[{cohort:''},null,200]]){
    const r=runtime(options);assert.equal((await r.run(auth)).status,status);assert.equal(r.calls.length,0);
  }
});
test('a successful retry never submits a previously reserved recipient again',async()=>{
 const r=runtime();assert.equal((await r.run()).body.submitted,1);
 await r.run();assert.equal(r.calls.length,1);assert.equal(r.ledger.get(A).status,'submitted');
 assert.equal(r.calls[0].payload.data.type,'daily_prompt');
 assert.equal(r.calls[0].payload.data.promptId,'question');
 assert.equal(r.calls[0].payload.url,'/daily-prompts?promptId=question');
 assert.equal(r.calls[0].payload.data.expiresAt,'2026-11-16T23:00:00Z');
});
test('an uncertain provider handoff is recorded and never automatically replayed',async()=>{
 const r=runtime({provider:{}});assert.equal((await r.run()).body.uncertain,1);
 await r.run();assert.equal(r.calls.length,1);assert.equal(r.ledger.get(A).status,'uncertain');
});
test('opt out or unavailable prompt cannot dispatch',async()=>{
 for(const options of [{consent:false},{lookupFailure:true}]){
   const r=runtime(options);await r.run();assert.equal(r.calls.length,0);
 }
});

test('the dedicated Supabase scheduler credential authorizes dispatch without changing existing cron secrets',async()=>{
 const r=runtime({dedicatedCron:true});assert.equal((await r.run()).body.submitted,1);
});
