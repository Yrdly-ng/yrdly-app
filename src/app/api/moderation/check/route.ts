import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { invokeServerFunction } from '@/lib/notifications/server-functions';

/** Client text feedback only. Publication still requires server-side moderation. */
export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, {
    status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
  });
  const body = await request.json().catch(() => null);
  if (typeof body?.content !== 'string' || !body.content.trim() || body.content.length > 10000 || body.type !== 'text') {
    return NextResponse.json({ error: 'Provide text between 1 and 10000 characters' }, { status: 400 });
  }
  const { data: allowed, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id, p_endpoint: '/api/moderation/check', p_max_requests: 10, p_window_seconds: 60,
  });
  if (rateError || !allowed) return NextResponse.json({ error: 'Text review unavailable. Please try again later.' }, { status: rateError ? 503 : 429 });
  const result = await invokeServerFunction(supabaseAdmin, 'moderate-content', { type: 'text', content: body.content });
  if (result.error || typeof result.data?.isSafe !== 'boolean') {
    return NextResponse.json({ error: 'Text review unavailable. Please try again later.' }, { status: 503 });
  }
  return NextResponse.json({ isSafe: result.data.isSafe,
    ...(typeof result.data.reason === 'string' ? { reason: result.data.reason } : {}) });
}
