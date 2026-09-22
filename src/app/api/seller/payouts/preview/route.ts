import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PayoutService } from '@/lib/payout-service';
import { PaylukService } from '@/lib/payluk-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';

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

    // Validate seller's current available balance
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

    // Get seller primary account details
    const { data: sellerAccount, error: saError } = await supabaseAdmin
      .from('seller_accounts')
      .select('*, account_type, account_details')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (saError || !sellerAccount) {
      return NextResponse.json(
        { error: 'NO_ACTIVE_ACCOUNT', message: 'No active bank account found. Please link your bank account in Settings.' },
        { status: 400 }
      );
    }

    const accountDetails = sellerAccount.account_details as Record<string, string> | null;
    const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
    const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;
    const accountName = accountDetails?.account_name || accountDetails?.accountName;
    const bankName = accountDetails?.bank_name || accountDetails?.bankName || accountDetails?.bank || 'Bank';

    const sellerPaylukId = await getPaylukCustomerId(user.id);

    if (sellerPaylukId && bankCode && accountNumber) {
      const previewResult = await PaylukService.previewWithdrawal({
        sellerPaylukCustomerId: sellerPaylukId,
        amount,
        bankCode,
        bankName,
        accountNumber,
        accountName,
        reference: `preview-${user.id}-${Date.now()}`,
        yrdlyAvailableBalance: currentBalance.availableBalance,
      });

      if (!previewResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: previewResult.error || 'Withdrawal preview failed',
            reason: previewResult.reason,
            requestedAmount: amount,
            fee: previewResult.intentFee,
            maximumWithdrawable: previewResult.maximumWithdrawable,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        amount,
        fee: previewResult.intentFee,
        totalDebit: previewResult.totalPaylukDebit,
        netToBank: amount,
        availableBalance: currentBalance.availableBalance,
        maximumWithdrawable: previewResult.maximumWithdrawable,
      });
    }

    // Fallback if no Payluk ID
    return NextResponse.json({
      success: true,
      amount,
      fee: 0,
      totalDebit: amount,
      netToBank: amount,
      availableBalance: currentBalance.availableBalance,
    });
  } catch (error) {
    console.error('Payout preview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
