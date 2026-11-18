import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { loadDailyPromptCampaign } from '../_shared/daily-prompt-policy.ts';
const reply=(body:unknown,options:{status?:number}={})=>new Response(JSON.stringify(body),{status:options.status??200,headers:{'Content-Type':'application/json'}});
/**
 * One calendar date for all Nigeria neighbourhood prompts.
 * Africa/Lagos is fixed UTC+1; do not use the viewer's device timezone.
 */
function lagosPromptClock(now = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function dailyReminderWindow(now = new Date()) {
  const {date,hour}=lagosPromptClock(now);
  return {date, eligible: hour===18 || hour===19};
}

function dailyReminderExpiresAt(date: string): string {
  // WAT is fixed UTC+1. At 23:00 UTC, the selected Nigerian day ends.
  return new Date(date+'T23:00:00Z').toISOString();
}

function dailyReminderDedupeKey(date: string,userId:string):string {
  return `daily_prompt:${date}:${userId}`;
}

function shouldOfferDailyReminder(
  consent:unknown, hasToken:boolean, answered:boolean, userId:string,
  scope:string, testers:Set<string>
):boolean {
  if(consent!==true || !hasToken || answered)return false;
  if(scope==='all')return true;
  return scope==='testers' && testers.has(userId.toLowerCase());
}

function validServiceKey(req: Request): string | null {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let namedKeys: unknown;
  try {
    namedKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  } catch {
    namedKeys = {};
  }
  const secretKeys =
    namedKeys && typeof namedKeys === "object"
      ? Object.values(namedKeys).filter(
          (key): key is string =>
            typeof key === "string" && key.startsWith("sb_secret_"),
        )
      : [];
  const apiKey = req.headers.get("apikey");
  if (apiKey && (secretKeys.includes(apiKey) || apiKey === legacyKey))
    return apiKey;
  if (legacyKey && req.headers.get("authorization") === `Bearer ${legacyKey}`)
    return legacyKey;
  return null;
}


async function invokeServerFunction<T>(admin:any,name:string,body:Record<string,unknown>){
 return admin.functions.invoke(name,{body}) as Promise<{data:T|null;error:unknown}>;
}
serve(async(req:Request)=>{
 if(req.method!=='POST')return reply({error:'Method not allowed'},{status:405});
 const key=validServiceKey(req);if(!key)return reply({error:'Forbidden'},{status:403});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
 const campaign=await loadDailyPromptCampaign(admin,Deno.env.get('DAILY_PROMPT_PUSH_ENABLED'));
 if(!campaign)return reply({skipped:'disabled',reason:Deno.env.get('DAILY_PROMPT_PUSH_ENABLED')==='false'?'emergency_stop':'campaign_disabled'});
  const now=dailyReminderWindow();
  if(!now.eligible)return reply({skipped:'outside_window',date:now.date});

  const scope=campaign.scope;
  if(scope!=='testers'&&scope!=='all')return reply({skipped:'invalid_scope'});
  const testers=new Set<string>(campaign.tester_ids);
  if(scope==='testers'&&testers.size===0)return reply({skipped:'no_testers'});

  const {data:prompt,error:promptError}=await admin.from('daily_prompts')
    .select('id,question,push_title,push_body').eq('prompt_date',now.date)
    .eq('status','approved').maybeSingle();
  if(promptError)return reply({error:'Question lookup failed'},{status:503});
  if(!prompt)return reply({skipped:'no_approved_question'});

  const counters={scanned:0,considered:0,reserved:0,submitted:0,skipped:0,uncertain:0};
  let cursor:string|null=null;
  let hasMore=false;
  const maxScanned=500;
  const BATCH_SIZE=50;
  const started=Date.now();

  try{
    while(counters.scanned<maxScanned && Date.now()-started < 90000){
      const {data:recipients,error:userError}=await admin.rpc('daily_prompt_reminder_candidates',{
        p_prompt_id:prompt.id,p_after:cursor,p_limit:BATCH_SIZE,
        p_testers:scope==='testers'?[...testers]:null,
      });
      if(userError)throw new Error('Could not read opted-in recipients');
      const users=(recipients??[]) as {id:string;notification_settings:{dailyPrompts?:unknown}|null}[];
      if(!users.length){hasMore=false;break;}
      cursor=users[users.length-1].id;
      counters.scanned+=users.length;
      hasMore=users.length===BATCH_SIZE;
      const eligible=users.filter(u=>shouldOfferDailyReminder(u.notification_settings?.dailyPrompts,
        true,false,u.id,scope,testers));
      counters.considered+=eligible.length;

      // Bounded concurrency; rechecking preference in the Edge function closes
      // most opt-out races. Never retry an uncertain handoff automatically.
      for(let k=0;k<eligible.length;k+=5){
        await Promise.all(eligible.slice(k,k+5).map(async u=>{
          const claim=await admin.from('daily_prompt_reminders').upsert(
            {prompt_id:prompt.id,user_id:u.id,status:'attempting'},
            {onConflict:'prompt_id,user_id',ignoreDuplicates:true}
          ).select('prompt_id');
          if(claim.error)throw new Error('Could not reserve a unique reminder');
          if(!claim.data?.length){counters.skipped++;return;}
          counters.reserved++;
          let resultCode='uncertain';
          let status: 'uncertain' | 'submitted' | 'skipped' = 'uncertain';
          try{
            const response=await invokeServerFunction<{success?:boolean;skipped?:boolean;reason?:string}>(
              admin,'send-push-notification',{
                userId:u.id,type:'daily_prompt',payload:{
                  title:prompt.push_title||'Your neighbourhood is talking 🌿',
                  body:prompt.push_body||prompt.question,url:`/daily-prompts?promptId=${encodeURIComponent(prompt.id)}`,
                  data:{
                    type:'daily_prompt',
                    promptId:prompt.id,
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
          const update=await admin.from('daily_prompt_reminders')
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
    return reply({success:true,date:now.date,...counters,hasMore});
  }catch{
    console.error('[daily-prompts-cron] Worker failed after a bounded batch');
    return reply({error:'Campaign worker failed',...counters},{status:503});
  }
});
