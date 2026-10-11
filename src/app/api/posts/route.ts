import { invokeServerFunction } from '@/lib/server-functions';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function save(request: NextRequest, editing: boolean) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input = body?.post;
  if (!input || (input.text != null && (typeof input.text !== 'string' || input.text.length > 10000)) ||
      (input.title != null && (typeof input.title !== 'string' || input.title.length > 200)) ||
      (input.price != null && (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0)) ||
      (input.image_urls != null && (!Array.isArray(input.image_urls) || input.image_urls.length > 10 || input.image_urls.some((url: unknown) => typeof url !== 'string')))) {
    return NextResponse.json({ error: 'Invalid post details' }, { status: 400 });
  }
  if (editing) {
    const { data: existing } = await supabaseAdmin.from('posts').select('user_id').eq('id', body.id).maybeSingle();
    if (existing?.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    ...(!editing ? { timestamp: new Date().toISOString(), state: input.state ?? profile.home_state,
      lga: input.lga ?? profile.home_lga, ward: input.ward ?? profile.home_ward } : { is_edited: true }) };
  const query = editing ? supabaseAdmin.from('posts').update(payload).eq('id', body.id).eq('user_id', user.id)
    : supabaseAdmin.from('posts').insert(payload);
  const { data, error: saveError } = await query.select().single();
  if (saveError) return NextResponse.json({ error: 'Could not save post' }, { status: 500 });
  if (!approved) {
    const { error: queueError } = await supabaseAdmin.from('moderation_queue').insert({ content_id: data.id, table_name: 'posts',
      user_id: user.id, status: 'pending', reason: 'Server moderation requires review', text_content: input.text || input.title || '', image_urls: input.image_urls || [] });
    if (queueError) console.error('Post withheld; moderation queue needs reconciliation', { postId: data.id, code: queueError.code });
  }
  return NextResponse.json({ data: { ...data, user: profile }, error: null });
}

export async function POST(request: NextRequest) { return save(request, false); }
export async function PATCH(request: NextRequest) { return save(request, true); }
