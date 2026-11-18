import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { DAILY_PROMPTS_ENABLED, lagosPromptClock, isVisiblePrompt } from '@/lib/daily-prompts/daily-prompt-clock';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { date, hour } = lagosPromptClock();
  if (!DAILY_PROMPTS_ENABLED()) {
    return NextResponse.json({ date, prompt: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const promptId = request.nextUrl.searchParams.get('promptId');
  if (promptId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(promptId))
    return NextResponse.json({ error: 'Invalid question' }, { status: 400 });
  if (promptId === null && hour < 7)
    return NextResponse.json({ date, prompt: null }, { headers: { 'Cache-Control': 'no-store' } });
  let query = supabaseAdmin.from('daily_prompts')
    .select('id,prompt_date,question,category,status').eq('status', 'approved');
  query = promptId === null ? query.eq('prompt_date', date) : query.eq('id', promptId);
  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Could not fetch approved daily prompt:', error.code);
    return NextResponse.json({ error: 'Question unavailable' }, { status: 503 });
  }
  if (promptId !== null && !isVisiblePrompt(data))
    return NextResponse.json({ error: 'Question unavailable' }, { status: 404 });
  const prompt = data && isVisiblePrompt(data) ? { id: data.id, prompt_date: data.prompt_date, question: data.question, category: data.category } : null;
  return NextResponse.json({ date, prompt }, { headers: { 'Cache-Control': 'no-store' } });
}
