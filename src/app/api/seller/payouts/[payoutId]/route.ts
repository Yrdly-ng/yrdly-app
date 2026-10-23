import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { toPayoutReceipt } from '@/lib/payments/payout-receipt';

export async function GET(request: NextRequest, { params }: { params: Promise<{ payoutId: string }> }) {
  const { data: { user }, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, {
    status: error?.status === 403 ? 403 : error?.status === 503 ? 503 : 401,
  });
  const { payoutId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payoutId)) {
    return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 });
  }
  try {
    const { data, error: queryError } = await supabaseAdmin.from('payout_requests')
      .select('*, seller_account:seller_accounts(account_details,created_at,updated_at,account_updated_at)')
      .eq('id', payoutId).eq('seller_id', user.id).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 });
    return NextResponse.json({ payout: toPayoutReceipt(data) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Payout receipt failed:', error);
    return NextResponse.json({ error: 'Could not load withdrawal receipt' }, { status: 503 });
  }
}
