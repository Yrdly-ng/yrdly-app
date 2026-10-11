import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200 ||
      typeof body.description !== 'string' || !body.description.trim() || body.description.length > 5000 ||
      !['information', 'caution', 'urgent'].includes(body.severity) || !['safety', 'amber', 'info'].includes(body.type)) {
    return NextResponse.json({ error: 'Invalid alert' }, { status: 400 });
  }
  const { data: admin } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).single();
  const fields = Object.fromEntries(['title', 'description', 'severity', 'type', 'area_name', 'state', 'lga', 'ward', 'action']
    .filter(key => typeof body[key] === 'string').map(key => [key, body[key]]));
  const { data, error: insertError } = await supabaseAdmin.from('safety_alerts')
    .insert({ ...fields, user_id: user.id, status: admin?.is_admin && body.publish === true ? 'approved' : 'pending' }).select().single();
  if (insertError) return NextResponse.json({ error: 'Could not create alert' }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: admin } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).single();
  if (!admin?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.id || !['approved', 'rejected'].includes(body.status)) return NextResponse.json({ error: 'Invalid moderation action' }, { status: 400 });
  const { error: updateError } = await supabaseAdmin.from('safety_alerts')
    .update({ status: body.status, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', body.id);
  return updateError ? NextResponse.json({ error: 'Could not moderate alert' }, { status: 500 }) : NextResponse.json({ success: true });
}
