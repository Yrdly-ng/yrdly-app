import { getAuthenticatedUser } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { PayoutService } from '@/lib/payout-service';
import { PaylukService } from '@/lib/payluk-service';
import { getPaylukCustomerId } from '@/lib/payluk-onboarding';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const transactionId = resolvedParams.id;

    if (!transactionId) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: authError?.status === 403 ? 403 : authError?.status === 503 ? 503 : 401 });
    }

    // 1. Get the transaction using admin client to bypass RLS for this specific secure flow
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('status, amount, seller_amount, seller_id, buyer_id, payment_provider, payluk_escrow_id')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Only the buyer can complete the transaction
    if (transaction.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can complete this transaction' }, { status: 403 });
    }

    // Allow completion from PAID, SHIPPED, or DELIVERED — seller may have skipped the ship step
    const confirmableStatuses = [EscrowStatus.PAID, EscrowStatus.SHIPPED, EscrowStatus.DELIVERED];
    if (!confirmableStatuses.includes(transaction.status as EscrowStatus)) {
      return NextResponse.json({ error: `Transaction cannot be completed in state: ${transaction.status}` }, { status: 400 });
    }

    // For Payluk transactions: call confirm-payment FIRST so Payluk releases funds to the seller's
    // wallet. Without this the escrow stays locked and the subsequent bank withdrawal has nothing
    // to draw from.
    if (transaction.payment_provider === 'payluk') {
      if (!transaction.payluk_escrow_id) {
        return NextResponse.json({ error: 'Payluk escrow ID missing on this transaction' }, { status: 500 });
      }
      try {
        const buyerPaylukId = await getPaylukCustomerId(user.id);
        await PaylukService.confirmDelivery(buyerPaylukId, transaction.payluk_escrow_id);
      } catch (paylukErr: any) {
        const msg: string = paylukErr?.message ?? '';
        const escrow = await PaylukService.verifyEscrow(transaction.payluk_escrow_id).catch(() => null);
        const providerStatuses = [escrow?.status, escrow?.state].map(value => String(value || '').toLowerCase());
        if (!providerStatuses.some(value => ['completed', 'claimed'].includes(value))) {
          console.error('[complete] PaylukService.confirmDelivery failed:', msg);
          return NextResponse.json({ error: msg || 'Failed to release Payluk escrow' }, { status: 502 });
        }
        console.warn('[complete] Payluk escrow already closed — proceeding to DB update.');
      }

      // After Payluk releases escrow, query the seller's ACTUAL wallet balance.
      // Payluk takes an escrow fee (e.g. ₦50 on a ₦1,000 escrow), so the seller
      // receives less than the item price. We must update seller_amount in the DB
      // to reflect the real amount the seller can actually withdraw.
      try {
        const sellerPaylukId = await getPaylukCustomerId(transaction.seller_id);
        if (sellerPaylukId) {
          const wallet = await PaylukService.getCustomerWallet(sellerPaylukId);
          const actualWalletBalance = wallet.mainBalance;
          // Only adjust if the wallet balance is less than the original seller_amount
          // (i.e. Payluk took a fee). Use the wallet balance as the true seller_amount.
          if (typeof actualWalletBalance === 'number' && actualWalletBalance > 0 && actualWalletBalance < transaction.seller_amount) {
            console.log(`[complete] Adjusting seller_amount from ₦${transaction.seller_amount} to ₦${actualWalletBalance} (Payluk escrow fee deducted)`);
            await supabaseAdmin
              .from('escrow_transactions')
              .update({ seller_amount: actualWalletBalance })
              .eq('id', transactionId);
          }
        }
      } catch (walletErr) {
        // Non-fatal — if we can't check the wallet, the downstream withdrawal
        // flow will still use the Payluk wallet balance as a cap.
        console.warn('[complete] Could not query seller Payluk wallet to adjust seller_amount:', walletErr);
      }
    }

    // 2. Update transaction status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId)
      .in('status', confirmableStatuses)
      .select('id');

    if (updateError) {
      console.error('Error completing transaction:', updateError);
      return NextResponse.json({ error: 'Failed to complete transaction' }, { status: 500 });
    }
    if (!updated?.length) {
      const { data: current } = await supabaseAdmin.from('escrow_transactions').select('status').eq('id', transactionId).single();
      if (current?.status === EscrowStatus.COMPLETED) return NextResponse.json({ success: true, alreadyCompleted: true });
      return NextResponse.json({ error: 'Transaction state changed; refresh and try again' }, { status: 409 });
    }

    // 3. Initiate payout to seller now that buyer has confirmed receipt
    let payoutSucceeded = false;
    try {
      await PayoutService.initiateAutoPayout(transactionId);
      payoutSucceeded = true;
    } catch (payoutError) {
      console.error('Payout initiation failed after buyer confirmation:', payoutError);
      // Don't throw — transaction is still completed even if payout initiation fails
    }



    return NextResponse.json({ success: true, payoutSucceeded });
  } catch (error: any) {
    console.error('Complete transaction error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
