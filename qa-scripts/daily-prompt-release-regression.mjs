import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readQaEnv, createAdminClient, QA_PROJECT_REF, QA_PREFIX } from './qa-common.mjs';
const {env,projectRef}=await readQaEnv();
assert.equal(projectRef,QA_PROJECT_REF);
const origin='http://localhost:9002';
const seed=JSON.parse(await readFile('qa-seed-output.json','utf8'));
assert.equal(seed.projectRef,QA_PROJECT_REF);assert.equal(seed.qaPrefix,QA_PREFIX);
const admin=createAdminClient(env),buyer=seed.users.buyer;
const ok=({data,error})=>{if(error)throw Error(`QA operation failed (${error.code || 'unknown'})`);return data;};
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const profile=ok(await admin.from('users').select('home_state,home_lga,home_ward').eq('id',buyer).single());
let prompt,createdPrompt=false;
const ids=[randomUUID(),randomUUID(),randomUUID()];
try {
  prompt=ok(await admin.from('daily_prompts').select('id,status').eq('prompt_date',clock).maybeSingle());
  if(!prompt){prompt=ok(await admin.from('daily_prompts').insert({id:randomUUID(),prompt_date:clock,question:'YRDLY-QA: Which local service would you recommend to a neighbour?',category:'neighbourhood',status:'approved',created_by:seed.users.admin,approved_by:seed.users.admin}).select('id,status').single());createdPrompt=true;}
  assert.equal(prompt.status,'approved','Existing QA question must be approved; never overwrite it');
  ok(await admin.from('users').update({home_state:'Lagos',home_lga:'Ikeja',home_ward:null}).eq('id',buyer));
  const reader=createClient(env.SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=ok(await reader.auth.signInWithPassword({email:env.QA_BUYER_EMAIL,password:env.QA_BUYER_PASSWORD}));
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${auth.session.access_token}`};
  const current=await fetch(`${origin}/api/daily-prompts`);
  assert.equal(current.status,200);assert.equal((await current.json()).prompt?.id,prompt.id,'QA feature must expose the real approved question');
  const quoted=await fetch(`${origin}/api/daily-prompts?promptId=${prompt.id}`);
  assert.equal(quoted.status,200);assert.equal((await quoted.json()).prompt?.id,prompt.id,'Post quote must resolve its stored question ID');
  const malformed=await fetch(`${origin}/api/daily-prompts?promptId=not-a-question`);assert.equal(malformed.status,400);
  const post={id:ids[0],category:'General',visibility:'public',daily_prompt_id:prompt.id,text:'YRDLY-QA response persistence regression.',state:'Abuja',lga:'Wrong client location'};
  const invalid=await fetch(`${origin}/api/posts`,{method:'POST',headers,body:JSON.stringify({post:{...post,visibility:'private'}})});
  assert.equal(invalid.status,400,'Private prompt responses must be rejected');
  const saved=await fetch(`${origin}/api/posts`,{method:'POST',headers,body:JSON.stringify({post})});
  assert.equal(saved.status,200,'Real QA response API must persist the answer');
  const row=ok(await admin.from('posts').select('id,user_id,daily_prompt_id,state,lga,visibility').eq('id',ids[0]).single());
  assert.equal(row.user_id,buyer);assert.equal(row.daily_prompt_id,prompt.id);assert.equal(row.state,'Lagos');assert.equal(row.lga,'Ikeja');assert.equal(row.visibility,'public');
  const retry=await fetch(`${origin}/api/posts`,{method:'POST',headers,body:JSON.stringify({post})});assert.equal(retry.status,200);
  assert.equal(ok(await admin.from('posts').select('id').eq('id',ids[0])).length,1,'Retry must not duplicate an answer');
  ok(await admin.from('posts').update({moderation_status:'approved'}).eq('id',ids[0]).eq('user_id',buyer));
  ok(await admin.from('posts').insert([
    {id:ids[1],user_id:buyer,author_name:'YRDLY-QA',text:'YRDLY-QA pending answer',category:'General',visibility:'public',daily_prompt_id:prompt.id,state:'Lagos',lga:'Ikeja',moderation_status:'pending'},
    {id:ids[2],user_id:seed.users.seller,author_name:'YRDLY-QA',text:'YRDLY-QA other neighbourhood',category:'General',visibility:'public',daily_prompt_id:prompt.id,state:'Lagos',lga:'Epe',moderation_status:'approved'},
  ]));
  const response=await fetch(`${origin}/api/daily-prompts/responses?promptId=${prompt.id}`,{headers});assert.equal(response.status,200);
  const visible=(await response.json()).responses.map(p=>p.id);
  assert.ok(visible.includes(ids[0]));assert.ok(!visible.includes(ids[1]));assert.ok(!visible.includes(ids[2]));
  const anonymous=await fetch(`${origin}/api/daily-prompts/responses?promptId=${prompt.id}`);assert.equal(anonymous.status,401);
  console.log('PASS real isolated daily question: approved display, answer persistence, retry dedupe, server-owned location, moderation/locality filtering and authentication');
} finally {
  ok(await admin.from('moderation_queue').delete().in('content_id',ids).eq('table_name','posts'));
  ok(await admin.from('posts').delete().in('id',ids).in('user_id',[buyer,seed.users.seller]));
  if(createdPrompt)ok(await admin.from('daily_prompts').delete().eq('id',prompt.id).eq('created_by',seed.users.admin));
  ok(await admin.from('users').update(profile).eq('id',buyer));
}
