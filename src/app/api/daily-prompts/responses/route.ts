import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { DAILY_PROMPTS_ENABLED, isVisiblePrompt } from '@/lib/daily-prompts/daily-prompt-clock';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!DAILY_PROMPTS_ENABLED()) return NextResponse.json({ responses: [], nextPage: null });
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Sign in to view neighbourhood answers' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('promptId') ?? '';
  const pageRaw = request.nextUrl.searchParams.get('page') ?? '0';
  if (!uuid.test(id) || !/^\d{1,2}$/.test(pageRaw) || Number(pageRaw) > 20)
    return NextResponse.json({ error: 'Invalid question or page' }, { status: 400 });
  const page = Number(pageRaw);
  const { data: prompt, error: promptError } = await supabaseAdmin.from('daily_prompts')
    .select('id,prompt_date,status').eq('id', id).maybeSingle();
  if (promptError) return NextResponse.json({ error: 'Question unavailable' }, { status: 503 });
  if (!isVisiblePrompt(prompt)) return NextResponse.json({ error: 'Question unavailable' }, { status: 404 });

  const { data: profile, error: profileError } = await supabaseAdmin.from('users')
    .select('home_state,home_lga,blocked_users').eq('id', user.id).single();
  if (profileError || !profile) return NextResponse.json({ error: 'Could not load neighbourhood' }, { status: 503 });
  if (!profile.home_state || !profile.home_lga) return NextResponse.json({ responses: [], nextPage: null });

  const { data: posts, error: postsError } = await supabaseAdmin.from('posts')
    .select('id,user_id,author_name,author_image,text,created_at,comment_count,liked_by,moderation_status,category,visibility,state,lga')
    .eq('daily_prompt_id', id).eq('category','General')
    .eq('moderation_status','approved').eq('visibility','public')
    .eq('state',profile.home_state).eq('lga',profile.home_lga)
    .order('created_at',{ ascending:false })
    .range(page * PAGE_SIZE,(page+1)*PAGE_SIZE);
  if (postsError) return NextResponse.json({ error: 'Could not load answers' }, { status: 503 });

  const items = posts ?? [];
  const authorIds = [...new Set(items.map(p => p.user_id).filter(Boolean))];
  const { data: authors, error: authorError } = authorIds.length ?
    await supabaseAdmin.from('users').select('id,blocked_users').in('id', authorIds) :
    { data: [], error: null };
  if (authorError) return NextResponse.json({ error: 'Could not filter answers' }, { status: 503 });
  const reverseBlocked = new Set((authors ?? [])
    .filter(a => Array.isArray(a.blocked_users) && a.blocked_users.includes(user.id))
    .map(a => a.id));
  const myBlocked = new Set(Array.isArray(profile.blocked_users) ? profile.blocked_users : []);
  const responses = items.slice(0, PAGE_SIZE).filter(p => !!p.user_id && !myBlocked.has(p.user_id) && !reverseBlocked.has(p.user_id));
  return NextResponse.json({ responses, nextPage: items.length > PAGE_SIZE ? page + 1 : null }, { headers: { 'Cache-Control':'no-store' } });
}
