import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaystackService } from '@/lib/paystack-service';
import { PayoutService } from '@/lib/payout-service';
import { NotificationService } from '@/lib/notification-service';
import { PaylukService } from '@/lib/payluk-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ disputeId: string }> }
) {
  try {
    const { disputeId } = await context.params;
    const body = await request.json();
    const { resolution, refundAmount, sellerAmount } = body;

    // 1. Verify Authentication & Admin Status
    const { data: { user }, error: authError } = await getAuthenticatedUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Fetch Dispute & Transaction Details
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select('*, transaction:escrow_transactions(*)')
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const transaction = Array.isArray(dispute.transaction) ? dispute.transaction[0] : dispute.transaction;
    
    if (transaction.status === 'completed' || transaction.status === 'cancelled') {
      return NextResponse.json({ error: 'Transaction is already closed' }, { status: 400 });
    }

    // 3 & 4. Process Payments
    if (transaction.payment_provider === 'payluk') {
      if (!transaction.payluk_escrow_id) {
        return NextResponse.json({ error: 'Missing Payluk escrow ID on transaction' }, { status: 400 });
      }

      let status: 'COMPLETED' | 'REFUNDED' | 'SPLIT';
      if (refundAmount > 0 && sellerAmount > 0) {
        status = 'SPLIT';
      } else if (refundAmount > 0) {
        status = 'REFUNDED';
      } else {
        status = 'COMPLETED';
      }

      try {
        await PaylukService.resolveDispute(transaction.payluk_escrow_id, {
          resolution,
          status,
          sellerAmount: sellerAmount > 0 ? sellerAmount : undefined,
          buyerAmount: refundAmount > 0 ? refundAmount : undefined,
        });
      } catch (paylukError: any) {
        console.error('Failed to resolve dispute with Payluk:', paylukError);
        return NextResponse.json({ error: `Failed to resolve dispute with Payluk: ${paylukError.message}` }, { status: 500 });
      }
    } else {
      // Legacy / Paystack behavior (Refund Buyer)
      if (refundAmount > 0 && transaction.payment_reference) {
        const refundSuccess = await PaystackService.refundTransaction(transaction.payment_reference, refundAmount);
        if (!refundSuccess) {
          return NextResponse.json({ error: 'Failed to process refund with Paystack' }, { status: 500 });
        }
      }

      // Legacy / Paystack behavior (Payout Seller)
      if (sellerAmount > 0) {
        try {
          await PayoutService.manualPayout(transaction.seller_id, sellerAmount, user.id);
        } catch (payoutError) {
          console.error('Failed to initiate seller payout:', payoutError);
          return NextResponse.json({ error: 'Failed to initiate seller payout' }, { status: 500 });
        }
      }
    }

    // 5. Update Database Records
    await supabaseAdmin
      .from('disputes')
      .update({
        resolution,
        refund_amount: refundAmount,
        seller_amount: sellerAmount,
        status: 'resolved',
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    const newStatus = refundAmount > 0 ? 'cancelled' : 'completed';
    await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: newStatus,
        dispute_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);

    // If refunded/cancelled, restock the item so it can be re-listed
    if (newStatus === 'cancelled' && transaction.item_id) {
      if (transaction.item_type === 'catalog_item') {
        await supabaseAdmin
          .from('catalog_items')
          .update({ in_stock: true, updated_at: new Date().toISOString() })
          .eq('id', transaction.item_id);
      } else {
        await supabaseAdmin
          .from('posts')
          .update({ is_sold: false, sold_to_user_id: null, transaction_id: null })
          .eq('id', transaction.item_id);
      }
    }

    // 6. Notifications
    try {
      const itemTitle = 'Item'; // Best effort fallback
      await Promise.all([
        NotificationService.createDisputeResolvedNotification(
          transaction.buyer_id,
          itemTitle,
          resolution,
          disputeId,
          transaction.id
        ),
        NotificationService.createDisputeResolvedNotification(
          transaction.seller_id,
          itemTitle,
          resolution,
          disputeId,
          transaction.id
        )
      ]);
    } catch (notificationError) {
      console.error('Notification error', notificationError);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error resolving dispute API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
