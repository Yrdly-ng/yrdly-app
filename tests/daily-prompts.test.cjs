const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');

const source=fs.readFileSync('src/lib/daily-prompts/daily-prompt-clock.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module_={exports:{}};
new Function('module','exports','process',js)(module_,module_.exports,{env:{DAILY_PROMPTS_ENABLED:'false'}});
const {lagosPromptClock,isVisiblePrompt,DAILY_PROMPTS_ENABLED}=module_.exports;

test('date boundary uses Nigeria time rather than device UTC clock',()=>{
 assert.deepEqual(lagosPromptClock(new Date('2026-11-11T22:59:00Z')),{date:'2026-11-11',hour:23});
 assert.deepEqual(lagosPromptClock(new Date('2026-11-11T23:01:00Z')),{date:'2026-11-12',hour:0});
});
test('today is not visible until 07:00 Lagos time',()=>{
 const question={status:'approved',prompt_date:'2026-11-12'};
 assert.equal(isVisiblePrompt(question,new Date('2026-11-12T05:59:00Z')),false);
 assert.equal(isVisiblePrompt(question,new Date('2026-11-12T06:00:00Z')),true);
});
test('draft and paused prompts never appear; old approved prompts remain readable',()=>{
 const now=new Date('2026-11-12T17:00:00Z');
 assert.equal(isVisiblePrompt({status:'draft',prompt_date:'2026-11-12'},now),false);
 assert.equal(isVisiblePrompt({status:'paused',prompt_date:'2026-11-12'},now),false);
 assert.equal(isVisiblePrompt({status:'approved',prompt_date:'2026-11-11'},now),true);
 assert.equal(isVisiblePrompt({status:'approved',prompt_date:'2026-11-13'},now),false);
});
test('feature defaults off, including when no environment flag exists',()=>{
 assert.equal(DAILY_PROMPTS_ENABLED(),false);
});
test('migration requires approved publication before posts can be tagged',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261111213000_daily_neighbourhood_prompts.sql','utf8');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/daily_prompts_public_read/);
 assert.match(sql,/CREATE TRIGGER validate_daily_prompt_post_trigger/);
 assert.match(sql,/status = 'approved'/);
 assert.match(sql,/prompt_date = \(now\(\) AT TIME ZONE 'Africa\/Lagos'\)::date/);
 assert.match(sql,/NEW\.category::text <> 'General'/);
});
test('existing API enforces prompt ID and home neighbourhood for tagged posts',()=>{
 const route=fs.readFileSync('src/app/api/posts/route.ts','utf8');
 assert.match(route,/daily_prompt_id/);
 assert.match(route,/input\.category !== 'General'/);
 assert.match(route,/promptId \? profile\.home_state/);
 assert.match(route,/promptId \? profile\.home_lga/);
 assert.match(route,/existing\.daily_prompt_id !== input\.daily_prompt_id/);
});
test('responses must be moderated, local and blocked in either direction',()=>{
 const route=fs.readFileSync('src/app/api/daily-prompts/responses/route.ts','utf8');
 for(const check of [".eq('moderation_status','approved')",".eq('visibility','public')",".eq('state',profile.home_state)",".eq('lga',profile.home_lga)",'reverseBlocked','myBlocked'])assert.ok(route.includes(check),check);
});
