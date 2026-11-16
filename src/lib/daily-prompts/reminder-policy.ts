import { lagosPromptClock } from './daily-prompt-clock';

export function dailyReminderWindow(now = new Date()) {
  const {date,hour}=lagosPromptClock(now);
  return {date, eligible: hour===18 || hour===19};
}

export function dailyReminderExpiresAt(date: string): string {
  // WAT is fixed UTC+1. At 23:00 UTC, the selected Nigerian day ends.
  return new Date(date+'T23:00:00Z').toISOString();
}

export function dailyReminderDedupeKey(date: string,userId:string):string {
  return `daily_prompt:${date}:${userId}`;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function dailyReminderTesterIds(raw: string|undefined): Set<string> {
  return new Set((raw||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>UUID.test(x)));
}

export function shouldOfferDailyReminder(
  consent:unknown, hasToken:boolean, answered:boolean, userId:string,
  scope:string, testers:Set<string>
):boolean {
  if(consent!==true || !hasToken || answered)return false;
  if(scope==='all')return true;
  return scope==='testers' && testers.has(userId.toLowerCase());
}
