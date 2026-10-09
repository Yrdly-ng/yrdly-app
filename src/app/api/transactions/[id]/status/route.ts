import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { data: { user }, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!['shipped', 'delivered'].includes(body?.action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  const { data: transaction, error } = await supabaseAdmin.from('escrow_transactions')
    .select('buyer_id,seller_id,status').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load transaction' }, { status: 500 });
  if (!transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  const shipping = body.action === 'shipped';
  if (user.id !== (shipping ? transaction.seller_id : transaction.buyer_id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  if (transaction.status === body.action) return NextResponse.json({ success: true });
  const allowed = shipping ? ['paid'] : ['paid', 'shipped'];
  if (!allowed.includes(transaction.status)) return NextResponse.json({ error: 'Invalid transaction state' }, { status: 409 });
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin.from('escrow_transactions')
    .update({ status: body.action, [shipping ? 'shipped_at' : 'delivered_at']: now, updated_at: now })
    .eq('id', id).eq('status', transaction.status).select('id').maybeSingle();
  if (updateError) return NextResponse.json({ error: 'Could not update transaction' }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Transaction changed; refresh and retry' }, { status: 409 });
  return NextResponse.json({ success: true });
}
