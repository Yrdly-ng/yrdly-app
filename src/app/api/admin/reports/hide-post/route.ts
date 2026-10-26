import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 503 ? 503 : authError?.status === 403 ? 403 : 401 });
  }

  const { data: admin } = await supabaseAdmin
    .from('users')
    .select('is_admin,role')
    .eq('id', user.id)
    .maybeSingle();
  if (!admin || (!admin.is_admin && admin.role !== 'admin')) {
    return NextResponse.json({ error: 'Admin privileges required.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'A valid request body is required.' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });
  }

  const reportId = typeof body.reportId === 'string' ? body.reportId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) {
    return NextResponse.json({ error: 'A valid report reference is required.' }, { status: 400 });
  }

  const { data: actionLogId, error } = await supabaseAdmin.rpc('admin_hide_child_safety_reported_post', {
    p_actor_user_id: user.id,
    p_report_id: reportId,
  });
  if (error) {
    if (error.code === 'P0002') return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.code === '42501') return NextResponse.json({ error: 'Admin privileges required.' }, { status: 403 });
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ success: true, actionLogId });
}
