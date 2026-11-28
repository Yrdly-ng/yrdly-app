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
  if (!body || typeof body.alertId !== 'string' || !uuid.test(body.alertId)) {
    return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 });
  }

  const { data: allowed, error: rateError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_user_id: user.id,
    p_endpoint: '/api/alerts/resolve',
    p_max_requests: 20,
    p_window_seconds: 60,
  });
  if (rateError || !allowed) {
    return NextResponse.json({ error: 'Alert service is temporarily unavailable' }, { status: rateError ? 503 : 429 });
  }

  const { data: admin, error: adminError } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (adminError) {
    return NextResponse.json({ error: 'Could not verify admin access' }, { status: 503 });
  }
  if (!admin?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', body.alertId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[LegacyAlertResolve] Could not resolve alert', { code: error.code });
    return NextResponse.json({ error: 'Could not resolve alert' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
