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

    // Validate requested amount against server-computed seller available balance
    const currentBalance = await PayoutService.getSellerBalance(user.id);
    if (amount > currentBalance.availableBalance) {
      return NextResponse.json(
        {
          error: 'INSUFFICIENT_BALANCE',
          message: `Requested withdrawal amount (₦${amount.toLocaleString()}) exceeds available balance (₦${currentBalance.availableBalance.toLocaleString()}).`,
          requestedAmount: amount,
          availableBalance: currentBalance.availableBalance,
        },
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

    // Process payout immediately
    let processResult: { success: boolean; error?: string; reason?: string; maximumWithdrawable?: number; intentFee?: number } | undefined;
    try {
      processResult = await PayoutService.processPayout(payout.id);
    } catch (e) {
      console.error('Failed initial processing of payout:', e);
      await supabaseAdmin
        .from('payout_requests')
        .update({
          status: 'failed',
          failure_reason: e instanceof Error ? e.message : 'Processing error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payout.id);
    }

    if (processResult && !processResult.success) {
      return NextResponse.json({
        success: false,
        payoutId: payout.id,
        error: processResult.error || 'Withdrawal processing failed',
        reason: processResult.reason,
        requestedAmount: amount,
        fee: processResult.intentFee,
        maximumWithdrawable: processResult.maximumWithdrawable,
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, payoutId: payout.id });
  } catch (error) {
    console.error('Payout request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
