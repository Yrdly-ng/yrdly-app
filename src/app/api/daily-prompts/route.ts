import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { DAILY_PROMPTS_ENABLED, lagosPromptClock } from '@/lib/daily-prompts/daily-prompt-clock';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { date, hour } = lagosPromptClock();
  if (!DAILY_PROMPTS_ENABLED() || hour < 7) {
    return NextResponse.json({ date, prompt: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { data, error } = await supabaseAdmin.from('daily_prompts')
    .select('id,prompt_date,question,category')
    .eq('prompt_date', date).eq('status', 'approved').maybeSingle();

  if (error) {
    console.error('Could not fetch approved daily prompt:', error.code);
    return NextResponse.json({ error: 'Question unavailable' }, { status: 503 });
  }
  return NextResponse.json({ date, prompt: data ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
