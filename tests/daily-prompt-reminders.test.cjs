const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');

function loadPolicy(){
  const timeSource=fs.readFileSync('src/lib/daily-prompts/daily-prompt-clock.ts','utf8');
  const policySource=fs.readFileSync('src/lib/daily-prompts/reminder-policy.ts','utf8');
  const compile=(source)=>ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
  }}).outputText;
  const clockModule={exports:{}};
  new Function('require','module','exports',compile(timeSource))(
    ()=>{throw new Error('unexpected time dependency')},clockModule,clockModule.exports);
  const policyModule={exports:{}};
  new Function('require','module','exports',compile(policySource))(
    id=>{assert.equal(id,'./daily-prompt-clock');return clockModule.exports},
    policyModule,policyModule.exports);
  return policyModule.exports;
}
const p=loadPolicy();
const A='4e0d2091-df62-4f90-bf53-f06dac1cfe93';
const B='6ec8e2aa-3cb1-4884-b741-72f2ec03cfd8';

test('18:00 and delayed 19:00 Nigeria time are allowed, not 17 or 20',()=>{
  assert.equal(p.dailyReminderWindow(new Date('2026-11-12T16:59:59Z')).eligible,false);
  assert.deepEqual(p.dailyReminderWindow(new Date('2026-11-12T17:00:00Z')),
    {date:'2026-11-12',eligible:true});
  assert.equal(p.dailyReminderWindow(new Date('2026-11-12T18:35:00Z')).eligible,true);
  assert.equal(p.dailyReminderWindow(new Date('2026-11-12T19:00:00Z')).eligible,false);
});

test('same Nigerian day ends at 23:00 UTC',()=>{
  assert.equal(p.dailyReminderExpiresAt('2026-11-12'),'2026-11-12T23:00:00.000Z');
});
test('dedupe is keyed by local date and user',()=>{
  assert.equal(p.dailyReminderDedupeKey('2026-11-12',A),p.dailyReminderDedupeKey('2026-11-12',A));
  assert.notEqual(p.dailyReminderDedupeKey('2026-11-12',A),p.dailyReminderDedupeKey('2026-11-12',B));
  assert.notEqual(p.dailyReminderDedupeKey('2026-11-12',A),p.dailyReminderDedupeKey('2026-11-13',A));
});
test('explicit opt in, device and unanswered gate are mandatory',()=>{
  const testers=new Set([A]);
  for(const consent of [undefined,null,false,0,'true'])assert.equal(
    p.shouldOfferDailyReminder(consent,true,false,A,'all',testers),false);
  assert.equal(p.shouldOfferDailyReminder(true,false,false,A,'all',testers),false);
  assert.equal(p.shouldOfferDailyReminder(true,true,true,A,'all',testers),false);
  assert.equal(p.shouldOfferDailyReminder(true,true,false,A,'all',testers),true);
});
test('default tester cohort excludes everyone except permitted UUIDs',()=>{
  const testers=p.dailyReminderTesterIds(`  ${A.toUpperCase()} ,not-an-id,${A} `);
  assert.equal(testers.size,1);
  assert.equal(p.shouldOfferDailyReminder(true,true,false,A,'testers',testers),true);
  assert.equal(p.shouldOfferDailyReminder(true,true,false,B,'testers',testers),false);
  assert.equal(p.shouldOfferDailyReminder(true,true,false,A,'invalid',testers),false);
  assert.equal(p.dailyReminderTesterIds('').size,0);
});
test('schema locks one recipient per prompt and forbids anonymous reads',()=>{
  const migration=fs.readFileSync('supabase/migrations/20261111234000_daily_prompt_dispatch_guardrails.sql','utf8');
  assert.match(migration,/PRIMARY KEY \(prompt_id,user_id\)/);
  assert.match(migration,/REVOKE ALL ON public\.daily_prompt_reminders FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/UPDATE OF daily_prompt_id,category,visibility,state,lga/);
  assert.match(migration,/OLD\.daily_prompt_id IS NOT NULL/);
});
test('cron requires explicit opt in, feature flags, secure request and no uncertain retries',()=>{
 const route=fs.readFileSync('src/app/api/cron/daily-prompts/route.ts','utf8');
 for(const term of ['CRON_SECRET','DAILY_PROMPT_PUSH_ENABLED','DAILY_PROMPTS_ENABLED',
  'dailyReminderTesterIds','ignoreDuplicates:true','daily_prompt_reminders',
   'send-push-notification','dailyReminderExpiresAt',"resultCode='uncertain'",
   'notification_settings'].filter(x=>typeof x==='string')){
   assert.ok(route.includes(term),'missing '+term);
 }
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 assert.ok(config.crons.some(c=>c.path==='/api/cron/daily-prompts'&&c.schedule==='0 17 * * *'));
});
test('push sender and outbox have independent safety kill-switch and consent checks',()=>{
 const sender=fs.readFileSync('supabase/functions/send-push-notification/index.ts','utf8');
 const worker=fs.readFileSync('supabase/functions/process-push-notification-outbox/index.ts','utf8');
 for(const code of [sender,worker]){
   assert.match(code,/DAILY_PROMPT_PUSH_ENABLED/);
   assert.match(code,/dailyPrompts/);
   assert.match(code,/daily_prompt/);
 }
});
