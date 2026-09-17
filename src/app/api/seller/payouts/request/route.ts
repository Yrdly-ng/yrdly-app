import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PayoutService } from '@/lib/payout-service';

export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { amount } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Get seller account ID
    const { data: sellerAccount, error: saError } = await supabaseAdmin
      .from('seller_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (saError || !sellerAccount) {
      return NextResponse.json(
        { error: 'NO_ACTIVE_ACCOUNT', message: 'No active bank account found. Please link your bank account in Settings.' },
        { status: 400 }
      );
    }

    // Insert payout request
    const { data: payout, error: insertError } = await supabaseAdmin
      .from('payout_requests')
      .insert({
        seller_id: user.id,
        account_id: sellerAccount.id,
        amount,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Insert payout error:', insertError);
      return NextResponse.json({ error: 'Failed to request payout' }, { status: 500 });
    }

    // Attempt to process it via PayoutService if you process them instantly, otherwise leave it pending.
    // The retry API attempts processPayout, so we can try processing it here too.
    try {
      await PayoutService.processPayout(payout.id);
    } catch (e) {
      console.error('Failed initial processing of payout:', e);
      // Don't fail the request, the cron job or admin can retry it later.
    }

    return NextResponse.json({ success: true, payoutId: payout.id });
  } catch (error) {
    console.error('Payout request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
