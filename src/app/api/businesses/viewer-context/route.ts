import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.businessId !== 'string' || !uuid.test(body.businessId)) {
    return NextResponse.json({ error: 'Invalid business context request' }, { status: 400 });
  }

  const { data: allowed, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id,
    p_endpoint: '/api/businesses/viewer-context',
    p_max_requests: 60,
    p_window_seconds: 60,
  });
  if (rateError || !allowed) {
    return NextResponse.json({ error: 'Business details are temporarily unavailable' }, { status: rateError ? 503 : 429 });
  }

  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('owner_id, is_active, moderation_status, is_flagged, owner_name, owner_avatar')
    .eq('id', body.businessId)
    .maybeSingle();

  if (error) {
    console.error('[BusinessViewerContext] Could not load business', { code: error.code });
    return NextResponse.json({ error: 'Business details are temporarily unavailable' }, { status: 503 });
  }
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  const isOwner = business.owner_id === user.id;
  if ((!business.is_active || business.moderation_status !== 'approved' || business.is_flagged) && !isOwner) {
    return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  }

  const { data: ownerProfile } = await supabaseAdmin
    .from('public_profiles')
    .select('name, avatar_url')
    .eq('id', business.owner_id)
    .maybeSingle();

  return NextResponse.json({
    isOwner,
    ownerName: ownerProfile?.name || business.owner_name || null,
    ownerAvatar: ownerProfile?.avatar_url || business.owner_avatar || null,
  });
}
