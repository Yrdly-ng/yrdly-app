import { paylukRetryAfterSeconds, payoutRateLimitMessage } from '@/lib/payments/payluk-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PayoutService } from '@/lib/payments/payout-service';
import { payoutAccountError } from '@/lib/payments/payout-account';

export async function POST(request: NextRequest) {
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    }

    const { amount } = await request.json();

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const PAYLUK_MINIMUM_WITHDRAWAL = 1000;
    if (amount < PAYLUK_MINIMUM_WITHDRAWAL) {
      return NextResponse.json(
        {
          error: 'BELOW_MINIMUM',
          message: `Minimum withdrawal amount is ₦${PAYLUK_MINIMUM_WITHDRAWAL.toLocaleString()}. Your balance of ₦${amount.toLocaleString()} is too low to withdraw.`,
        },
        { status: 400 }
      );
    }
    // Get seller account ID
    const { data: sellerAccount, error: saError } = await supabaseAdmin
      .from('seller_accounts')
      .select('id,is_active,verification_status,account_updated_at')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (saError || !sellerAccount) {
      return NextResponse.json(
        { error: 'NO_ACTIVE_ACCOUNT', message: 'No active bank account found. Please link your bank account in Settings.' },
        { status: 400 }
      );
    }

    const accountError = payoutAccountError(sellerAccount);
    if (accountError) return NextResponse.json({ error: accountError }, { status: 403 });

    // Reserve earned funds under the seller lock; processPayout performs the
    // authoritative provider wallet check immediately before staging.
    let payoutId: string;
    try {
      payoutId = await PayoutService.reservePayout(user.id, sellerAccount.id, amount);
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
        return NextResponse.json({ error: 'INSUFFICIENT_BALANCE', message: 'Requested amount exceeds your available balance. Refresh your balance and retry.' }, { status: 400 });
      }
      throw error;
    }
    const payout = { id: payoutId };

    // Process payout immediately
    let processResult: {
      success: boolean;
      error?: string;
      reason?: string;
      maximumWithdrawable?: number;
      intentFee?: number;
      netAmount?: number;
      totalPaylukDebit?: number;
      retryAfterSeconds?: number;
      retryable?: boolean;
    } | undefined;
    try {
      processResult = await PayoutService.processPayout(payout.id);
    } catch (e) {
      console.error('Failed initial processing of payout:', e);
      return NextResponse.json({ error: 'Payout state is uncertain; contact support before retrying.', payoutId: payout.id }, { status: 502 });
    }

    if (processResult && !processResult.success) {
      const displayError = processResult.reason || processResult.error || 'Withdrawal processing failed';
      return NextResponse.json({
        success: false,
        payoutId: payout.id,
        error: displayError,
        message: displayError,
        reason: processResult.reason,
        requestedAmount: amount,
        fee: processResult.intentFee,
        maximumWithdrawable: processResult.maximumWithdrawable,
        retryAfterSeconds: processResult.retryAfterSeconds,
        retryable: processResult.retryable,
      }, { status: processResult.retryAfterSeconds ? 429 : 400,
        headers: processResult.retryAfterSeconds ? { 'Retry-After': String(processResult.retryAfterSeconds) } : undefined });
    }

    return NextResponse.json({
      success: true,
      payoutId: payout.id,
      amountSentToBank: processResult?.netAmount ?? amount,
      fee: processResult?.intentFee ?? 0,
      totalDebited: processResult?.totalPaylukDebit ?? amount,
    });
  } catch (error) {
    console.error('Payout request error:', error);
    const delay = paylukRetryAfterSeconds(error);
    if (delay) return NextResponse.json({ error: payoutRateLimitMessage(delay), retryAfterSeconds: delay }, { status: 429, headers: { 'Retry-After': String(delay) } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
