import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaystackService } from '@/lib/paystack-service';
import { PayoutService } from '@/lib/payout-service';
import { NotificationService } from '@/lib/notification-service';

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

    // 3. Process Payments (Refund Buyer)
    if (refundAmount > 0 && transaction.payment_reference) {
      const refundSuccess = await PaystackService.refundTransaction(transaction.payment_reference, refundAmount);
      if (!refundSuccess) {
        return NextResponse.json({ error: 'Failed to process refund with Paystack' }, { status: 500 });
      }
    }

    // 4. Process Payments (Payout Seller)
    if (sellerAmount > 0) {
      try {
        await PayoutService.manualPayout(transaction.seller_id, sellerAmount, user.id);
      } catch (payoutError) {
        console.error('Failed to initiate seller payout:', payoutError);
        return NextResponse.json({ error: 'Failed to initiate seller payout' }, { status: 500 });
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
