// Service-only operational control. An explicit environment stop always wins.
export async function loadDailyPromptCampaign(admin: any, emergencyStop?: string) {
  if (emergencyStop === 'false') return null;
  const {data,error}=await admin.from('notification_campaigns')
    .select('enabled,scope,tester_ids').eq('name','daily_prompt').maybeSingle();
  if(error || data?.enabled!==true || !['testers','all'].includes(data.scope)
      || !Array.isArray(data.tester_ids)) return null;
  return data as {enabled:true;scope:'testers'|'all';tester_ids:string[]};
}
export async function dailyPromptRecipientEnabled(admin:any,userId:string,emergencyStop?:string) {
  const campaign=await loadDailyPromptCampaign(admin,emergencyStop);
  return !!campaign && (campaign.scope==='all' || campaign.tester_ids.includes(userId));
}
