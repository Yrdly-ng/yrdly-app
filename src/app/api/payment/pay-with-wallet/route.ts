import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/supabase-server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from '@/lib/payments/payluk-service';
import { getPaylukCustomerId } from '@/lib/payments/payluk-onboarding';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';
import { reservationHasExpired } from '@/lib/payments/checkout-reservation-expiry';
import { applyEscrowPayment } from '@/lib/payments/escrow-payment';
import { flagPayment } from '@/lib/payments/payment-reconciliation';

export const maxDuration = 60;

/**
 * POST /api/payment/pay-with-wallet
 * A buyer-initiated alternative to bank transfer checkout. Useful when a
 * delayed bank transfer was reconciled into the buyer's main Payluk wallet
 * after the original escrow had already been cancelled.
 *
 * Never creates a bank deposit or settles a cancelled order. Provider escrow
 * status, amount, buyer identity and wallet balance are verified server-side.
 */
export async function POST(request: NextRequest) {
  // Default OFF until the full Payluk funded sandbox wallet test passes.
  if (process.env.PAYLUK_WALLET_RECOVERY_ENABLED !== 'true') {
    return NextResponse.json({
      error: 'Direct wallet checkout is not available yet. You can resume the Payluk checkout or contact YRDLY support.',
    }, { status: 503 });
  }
  try {
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (!user || authError) return NextResponse.json(
      { error: 'Please sign in again before paying.' },
      { status: authError?.status === 503 ? 503 : 401 },
    );

    const body = await request.json().catch(() => null);
    const transactionId = body?.transactionId;
    if (typeof transactionId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId)) {
      return NextResponse.json({ error: 'Invalid checkout reference.' }, { status: 400 });
    }

    const { data: tx, error: txError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id,buyer_id,seller_id,item_type,status,amount,total_amount,commission,metadata,payment_provider,payluk_tx_ref,payluk_escrow_id,created_at')
      .eq('id', transactionId).maybeSingle();
    if (txError) throw txError;
    if (!tx || tx.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Checkout not found.' }, { status: 404 });
    }
    if (['paid', 'shipped', 'delivered', 'completed'].includes(tx.status)) {
      return NextResponse.json({ success: true, alreadyPaid: true, transactionId: tx.id });
    }
    if (tx.item_type !== 'post' && tx.item_type !== 'catalog_item') {
      return NextResponse.json({ error: 'Wallet payment is not available for this order.' }, { status: 409 });
    }
    if (tx.status !== 'pending' || tx.payment_provider !== 'payluk' ||
        !tx.payluk_tx_ref || !tx.payluk_escrow_id ||
        tx.metadata?.payluk_fee_mode !== 'native_commission_v1') {
      return NextResponse.json({
        error: 'This checkout is closed or needs reconciliation. Return to the item to start a new checkout; do not transfer money again.',
      }, { status: 409 });
    }

    const escrow = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (escrow.id !== tx.payluk_escrow_id || !paylukAmountsMatch(tx, escrow) ||
        Math.round(Number(tx.total_amount) * 100) !== Math.round(escrow.amount * 100)) {
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'wallet_escrow_amount_mismatch');
      return NextResponse.json({ error: 'Payment details need manual review. Your wallet was not charged.' }, { status: 409 });
    }

    const providerStatus = String(escrow.status || '').toUpperCase();
    if (['ONGOING', 'COMPLETED', 'CLAIMED'].includes(providerStatus)) {
      await applyEscrowPayment(tx.id, 'payluk', tx.payluk_escrow_id);
      return NextResponse.json({ success: true, alreadyPaid: true, transactionId: tx.id });
    }
    if (escrow.state !== 'AWAITING_PAYMENT' || providerStatus !== 'PENDING') {
      return NextResponse.json({ error: 'This escrow is not payable. Contact support for reconciliation.' }, { status: 409 });
    }
    if (reservationHasExpired(tx)) {
      return NextResponse.json({
        error: 'This payment window has expired. Return to the item and start a new checkout using your Payluk wallet. Do not transfer money again.',
      }, { status: 409 });
    }

    const customerId = await getPaylukCustomerId(user.id);
    const wallet = await PaylukService.getCustomerWallet(customerId);
    const debit = Number(tx.total_amount);
    if (wallet.currency !== 'NGN' || !Number.isFinite(wallet.mainBalance) ||
        !Number.isFinite(debit) || wallet.mainBalance + 0.00001 < debit) {
      return NextResponse.json({
        error: 'Your Payluk wallet does not yet contain enough for this order. Check again after bank-transfer reconciliation.',
      }, { status: 409 });
    }

    // Claim before submitting to Payluk. A second tap cannot submit a second
    // wallet debit. Unknown outcomes stay locked for provider reconciliation.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({ status: 'reconciling', updated_at: new Date().toISOString() })
      .eq('id', tx.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      return NextResponse.json({
        error: 'A payment confirmation is already processing. Check this order before trying again.',
      }, { status: 409 });
    }

    const reference = `yrdly-wallet-${tx.id}`;
    try {
      await PaylukService.fundEscrowFromWallet(customerId, tx.payluk_escrow_id, debit, reference);
    } catch (error) {
      // Payluk may have accepted the debit before a timeout. Never retry it here.
      console.error('[WalletCheckout] Uncertain provider submission', error);
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'wallet_funding_outcome_uncertain');
    }

    try {
      const checked = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
      if (checked.id === tx.payluk_escrow_id && paylukAmountsMatch(tx, checked) &&
          ['ONGOING', 'COMPLETED', 'CLAIMED'].includes(String(checked.status || '').toUpperCase())) {
        await applyEscrowPayment(tx.id, 'payluk', tx.payluk_escrow_id);
        return NextResponse.json({ success: true, transactionId: tx.id });
      }
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'wallet_funding_pending_verification');
    } catch (error) {
      console.error('[WalletCheckout] Provider confirmation needs review', error);
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'wallet_funding_confirmation_uncertain');
    }

    return NextResponse.json({
      pending: true,
      transactionId: tx.id,
      message: 'Payluk is verifying the payment. Do not try to pay again; check your order or contact support.',
    }, { status: 202 });
  } catch (error) {
    console.error('[WalletCheckout] Checkout failed', error);
    return NextResponse.json({
      error: 'Payment could not be confirmed. Check your existing order before trying again.',
    }, { status: 503 });
  }
}
