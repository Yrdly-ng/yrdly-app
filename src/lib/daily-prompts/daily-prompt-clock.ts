/**
 * One calendar date for all Nigeria neighbourhood prompts.
 * Africa/Lagos is fixed UTC+1; do not use the viewer's device timezone.
 */
export function lagosPromptClock(now = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function isVisiblePrompt(
  prompt: { status: string; prompt_date: string } | null,
  now = new Date(),
): boolean {
  if (!prompt || prompt.status !== 'approved') return false;
  const current = lagosPromptClock(now);
  return prompt.prompt_date < current.date ||
    (prompt.prompt_date === current.date && current.hour >= 7);
}

export const DAILY_PROMPTS_ENABLED = () => process.env.DAILY_PROMPTS_ENABLED === 'true';
