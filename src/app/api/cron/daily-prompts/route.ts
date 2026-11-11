import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { invokeServerFunction } from '@/lib/notifications/server-functions';
import { DAILY_PROMPTS_ENABLED } from '@/lib/daily-prompts/daily-prompt-clock';
import {
  dailyReminderWindow,dailyReminderExpiresAt,dailyReminderDedupeKey,
  dailyReminderTesterIds,shouldOfferDailyReminder,
} from '@/lib/daily-prompts/reminder-policy';

export const dynamic='force-dynamic';
export const maxDuration=300;

// A scheduled job may retry after network failure. The database ledger makes
// each user+question at-most-once, including uncertain provider submissions.
export async function GET(request:Request){
  if(!process.env.CRON_SECRET || request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error:'Unauthorized'},{status:401});
  if(!DAILY_PROMPTS_ENABLED() || process.env.DAILY_PROMPT_PUSH_ENABLED!=='true')
    return NextResponse.json({skipped:'disabled'});
  const now=dailyReminderWindow();
  if(!now.eligible)return NextResponse.json({skipped:'outside_window',date:now.date});

  const scope=process.env.DAILY_PROMPT_PUSH_SCOPE||'testers';
  if(scope!=='testers'&&scope!=='all')return NextResponse.json({skipped:'invalid_scope'});
  const testers=dailyReminderTesterIds(process.env.DAILY_PROMPT_PUSH_TESTER_IDS);
  if(scope==='testers'&&testers.size===0)return NextResponse.json({skipped:'no_testers'});

  const {data:prompt,error:promptError}=await supabaseAdmin.from('daily_prompts')
    .select('id,question,push_title,push_body').eq('prompt_date',now.date)
    .eq('status','approved').maybeSingle();
  if(promptError)return NextResponse.json({error:'Question lookup failed'},{status:503});
  if(!prompt)return NextResponse.json({skipped:'no_approved_question'});

  const counters={scanned:0,considered:0,reserved:0,submitted:0,skipped:0,uncertain:0};
  let cursor:string|null=null;
  let hasMore=false;
  const maxScanned=500;
  const BATCH_SIZE=50;
  const started=Date.now();

  try{
    while(counters.scanned<maxScanned && Date.now()-started < 200000){
      let query=supabaseAdmin.from('users')
        .select('id,notification_settings').contains('notification_settings',{dailyPrompts:true})
        .order('id',{ascending:true}).limit(BATCH_SIZE);
      if(cursor)query=query.gt('id',cursor);
      const {data:users,error:userError}=await query;
      if(userError)throw new Error('Could not read opted-in recipients');
      if(!users?.length){hasMore=false;break;}
      cursor=users[users.length-1].id;
      counters.scanned+=users.length;
      hasMore=users.length===BATCH_SIZE;
      const candidateIds=users.filter(u=>scope==='all'||testers.has(u.id.toLowerCase())).map(u=>u.id);
      if(candidateIds.length===0){if(!hasMore)break;continue;}
      const [answeredResult,tokenResult,webResult]=await Promise.all([
        supabaseAdmin.from('posts').select('user_id').eq('daily_prompt_id',prompt.id).in('user_id',candidateIds),
        supabaseAdmin.from('user_push_tokens').select('user_id').in('user_id',candidateIds),
        supabaseAdmin.from('push_subscriptions').select('user_id').in('user_id',candidateIds),
      ]);
      if(answeredResult.error||tokenResult.error||webResult.error)
        throw new Error('Could not verify reminder eligibility');
      const answered=new Set((answeredResult.data??[]).map(p=>p.user_id));
      const devices=new Set([...(tokenResult.data??[]),...(webResult.data??[])].map(p=>p.user_id));
      const eligible=users.filter(u=>shouldOfferDailyReminder(u.notification_settings?.dailyPrompts,
        devices.has(u.id),answered.has(u.id),u.id,scope,testers));
      counters.considered+=eligible.length;

      // Bounded concurrency; rechecking preference in the Edge function closes
      // most opt-out races. Never retry an uncertain handoff automatically.
      for(let k=0;k<eligible.length;k+=5){
        await Promise.all(eligible.slice(k,k+5).map(async u=>{
          const claim=await supabaseAdmin.from('daily_prompt_reminders').upsert(
            {prompt_id:prompt.id,user_id:u.id,status:'attempting'},
            {onConflict:'prompt_id,user_id',ignoreDuplicates:true}
          ).select('prompt_id');
          if(claim.error)throw new Error('Could not reserve a unique reminder');
          if(!claim.data?.length){counters.skipped++;return;}
          counters.reserved++;
          let resultCode='uncertain',status:'uncertain';
          try{
            const response=await invokeServerFunction<{success?:boolean;skipped?:boolean;reason?:string}>(
              supabaseAdmin,'send-push-notification',{
                userId:u.id,type:'daily_prompt',payload:{
                  title:prompt.push_title||'Your neighbourhood is talking 🌿',
                  body:prompt.push_body||prompt.question,url:'/daily-prompts',
                  data:{
                    type:'daily_prompt',
                    deliveryKey:dailyReminderDedupeKey(now.date,u.id),
                    expiresAt:dailyReminderExpiresAt(now.date),
                  },
                },
              });
            if(response.error)resultCode='provider_unconfirmed';
            else if(response.data?.skipped===true ||
                    (response.data?.success===false && response.data?.reason==='no_token')){
              status='skipped';resultCode='recipient_unavailable';
            }else if(response.data?.success===true){
              status='submitted';resultCode='provider_accepted';
            }else resultCode='provider_unconfirmed';
          }catch{resultCode='provider_unconfirmed';}
          const update=await supabaseAdmin.from('daily_prompt_reminders')
            .update({status,finished_at:new Date().toISOString(),result_code:resultCode})
            .eq('prompt_id',prompt.id).eq('user_id',u.id);
          if(update.error)throw new Error('Could not finalize reminder status');
          if(status==='submitted')counters.submitted++;
          else if(status==='uncertain')counters.uncertain++;
          else counters.skipped++;
        }));
      }
      if(!hasMore)break;
    }
    return NextResponse.json({success:true,date:now.date,...counters,hasMore});
  }catch{
    console.error('[daily-prompts-cron] Worker failed after a bounded batch');
    return NextResponse.json({error:'Campaign worker failed',...counters},{status:503});
  }
}
