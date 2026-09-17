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

    // Auth verification should be done via Authorization header in a production environment.
    // For now, we rely on the client sending a POST request to complete the transaction.
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Get the transaction using admin client to bypass RLS for this specific secure flow
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('status, seller_amount, seller_id, buyer_id, payment_provider, payluk_escrow_id')
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
        // If Payluk says the escrow is already closed/completed, treat as success
        if (!msg.includes('Action not allowed')) {
          console.error('[complete] PaylukService.confirmDelivery failed:', msg);
          return NextResponse.json({ error: msg || 'Failed to release Payluk escrow' }, { status: 502 });
        }
        console.warn('[complete] Payluk escrow already closed — proceeding to DB update.');
      }
    }

    // 2. Update transaction status
    const { error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId);

    if (updateError) {
      console.error('Error completing transaction:', updateError);
      return NextResponse.json({ error: 'Failed to complete transaction' }, { status: 500 });
    }

    // 3. Initiate payout to seller now that buyer has confirmed receipt
    try {
      await PayoutService.initiateAutoPayout(transactionId);
    } catch (payoutError) {
      console.error('Payout initiation failed after buyer confirmation:', payoutError);
      // Don't throw — transaction is still completed even if payout initiation fails
    }



    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Complete transaction error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
