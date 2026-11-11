import { invokeServerFunction } from '@/lib/notifications/server-functions';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { isMoneyAmount, isPaidPrice, MINIMUM_PRICE_MESSAGE } from '@/lib/marketplace/price-policy';
import { DAILY_PROMPTS_ENABLED, lagosPromptClock } from '@/lib/daily-prompts/daily-prompt-clock';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function save(request: NextRequest, editing: boolean) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input = body?.post;
  if (!input || (input.text != null && (typeof input.text !== 'string' || input.text.length > 10000)) ||
      (input.title != null && (typeof input.title !== 'string' || input.title.length > 200)) ||
      (input.price != null && !isMoneyAmount(input.price)) ||
      (input.image_urls != null && (!Array.isArray(input.image_urls) || input.image_urls.length > 10 || input.image_urls.some((url: unknown) => typeof url !== 'string')))) {
    return NextResponse.json({ error: 'Invalid post details' }, { status: 400 });
  }
  // Untrusted clients cannot link a post to an unpublished or expired question.
  let promptId: string | null = null;
  if (input.daily_prompt_id !== undefined && input.daily_prompt_id !== null) {
    if (editing || typeof input.daily_prompt_id !== 'string' ||
        !UUID_PATTERN.test(input.daily_prompt_id) || !DAILY_PROMPTS_ENABLED() ||
        input.category !== 'General' || input.visibility !== 'public') {
      return NextResponse.json({ error: 'Invalid daily question response' }, { status: 400 });
    }
    const { date, hour } = lagosPromptClock();
    if (hour < 7) return NextResponse.json({ error: 'Today’s question is not open yet' }, { status: 409 });
    const { data: approved, error: lookupError } = await supabaseAdmin.from('daily_prompts')
      .select('id').eq('id',input.daily_prompt_id).eq('status','approved')
      .eq('prompt_date',date).maybeSingle();
    if (lookupError) return NextResponse.json({ error: 'Could not verify question' }, { status: 503 });
    if (!approved) return NextResponse.json({ error: 'Today’s question has expired' }, { status: 409 });
    promptId = approved.id;
  }
  const clientPostId = !editing ? input.id : undefined;
  if (clientPostId !== undefined && (typeof clientPostId !== 'string' || !UUID_PATTERN.test(clientPostId))) {
    return NextResponse.json({ error: 'Invalid post identifier' }, { status: 400 });
  }
  // Mobile retries reuse the draft's client-generated ID. Return the original
  // row before moderation or uploads can create side effects a second time.
  if (clientPostId) {
    const { data: existing, error: lookupError } = await supabaseAdmin.from('posts')
      .select('*').eq('id', clientPostId).maybeSingle();
    if (lookupError) return NextResponse.json({ error: 'Could not verify post status' }, { status: 503 });
    if (existing) {
      if (existing.user_id !== user.id) return NextResponse.json({ error: 'Post identifier unavailable' }, { status: 409 });
      return NextResponse.json({ data: existing, error: null });
    }
  }
  let category = input.category;
  let price = input.price;
  if (editing) {
    const { data: existing } = await supabaseAdmin.from('posts').select('user_id,category,price').eq('id', body.id).maybeSingle();
    if (existing?.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    category = input.category ?? existing.category;
    price = input.price !== undefined ? input.price : Number(existing.price);
  }
  if (category === 'For Sale' && (!editing || input.price !== undefined || input.category !== undefined) && !isPaidPrice(price)) {
    return NextResponse.json({ error: MINIMUM_PRICE_MESSAGE }, { status: 400 });
  }
  const { data: profile, error: profileError } = await supabaseAdmin.from('users')
    .select('id,name,avatar_url,home_state,home_lga,home_ward,created_at,verified_seller,phone_verified').eq('id', user.id).single();
  if (profileError || !profile) return NextResponse.json({ error: 'Could not load profile' }, { status: 500 });
  const checks = await Promise.all([
    invokeServerFunction(supabaseAdmin, 'moderate-content', { type: 'text', content: `${input.title || ''}\n${input.text || ''}\n${input.description || ''}` }),
    ...(input.image_urls || []).map((url: string) => invokeServerFunction(supabaseAdmin, 'moderate-content', { type: 'image', content: url })),
  ]);
  const approved = checks.every(check => !check.error && check.data?.isSafe === true);
  const fields = Object.fromEntries(['title', 'text', 'description', 'category', 'sub_category', 'condition', 'price',
    'image_url', 'image_urls', 'video_urls', 'video_thumbnail_url', 'image_width', 'image_height', 'visibility',
    'state', 'lga', 'ward', 'lat', 'lng', 'location', 'event_date', 'event_time', 'event_link', 'event_location', 'negotiable']
    .filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  const payload: Record<string, unknown> = { ...fields, user_id: user.id, author_name: profile.name, author_image: profile.avatar_url,
    moderation_status: approved ? 'approved' : 'pending', updated_at: new Date().toISOString(),
    ...(!editing ? { timestamp: new Date().toISOString(),
      state: promptId ? profile.home_state : (input.state ?? profile.home_state),
      lga: promptId ? profile.home_lga : (input.lga ?? profile.home_lga),
      ward: promptId ? profile.home_ward : (input.ward ?? profile.home_ward),
      ...(promptId ? { daily_prompt_id: promptId } : {}),
    } : { is_edited: true }) };
  const query = editing ? supabaseAdmin.from('posts').update(payload).eq('id', body.id).eq('user_id', user.id)
    : supabaseAdmin.from('posts').insert(clientPostId ? { ...payload, id: clientPostId } : payload);
  const { data, error: saveError } = await query.select().single();
  if (saveError) {
    // Two retries can race after both observe no row. The primary-key winner is
    // authoritative; reconcile the loser to that row instead of surfacing a
    // false failure or creating another post.
    if (!editing && clientPostId) {
      const { data: existing } = await supabaseAdmin.from('posts').select('*')
        .eq('id', clientPostId).eq('user_id', user.id).maybeSingle();
      if (existing) return NextResponse.json({ data: existing, error: null });
    }
    return NextResponse.json({ error: 'Could not save post' }, { status: 500 });
  }
  if (!approved) {
    const { error: queueError } = await supabaseAdmin.from('moderation_queue').insert({ content_id: data.id, table_name: 'posts',
      user_id: user.id, status: 'pending', reason: 'Server moderation requires review', text_content: input.text || input.title || '', image_urls: input.image_urls || [] });
    if (queueError) console.error('Post withheld; moderation queue needs reconciliation', { postId: data.id, code: queueError.code });
  }
  return NextResponse.json({ data: { ...data, user: profile }, error: null });
}

export async function POST(request: NextRequest) { return save(request, false); }
export async function PATCH(request: NextRequest) { return save(request, true); }

export async function GET(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Invalid post identifier' }, { status: 400 });
  const { data, error: lookupError } = await supabaseAdmin.from('posts').select('*')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: 'Could not verify post status' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  return NextResponse.json({ data, error: null });
}
