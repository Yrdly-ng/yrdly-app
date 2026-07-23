
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { PaystackService } from '@/lib/paystack-service';

export async function POST(request: NextRequest) {
  try {
    // txRef = our transaction UUID, which is also the Paystack reference
    const { txRef: bodyTxRef } = await request.json();

    if (!bodyTxRef) {
      return NextResponse.json(
        { error: 'Transaction reference is required' },
        { status: 400 }
      );
    }

    // ── Authenticate the caller ──────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);

    if (!user || authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ── Check DB first — webhook may have already marked it PAID ──
    if (bodyTxRef) {
      const { data: existing } = await supabaseAdmin
        .from('escrow_transactions')
        .select('buyer_id, item_id, seller_id, status, total_amount')
        .eq('id', bodyTxRef)
        .single();

      if (user && existing?.buyer_id !== user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      if (existing?.status === EscrowStatus.PAID) {
        return NextResponse.json({
          success: true,
          message: 'Payment already verified',
          transactionId: bodyTxRef,
          amount: existing.total_amount,
        });
      }
    }

    // ── Verify with Paystack using the reference (same as our txRef) ──
    const verification = await PaystackService.verifyPayment(bodyTxRef);

    if (!verification.success || verification.status !== 'success') {
      console.error(`[PaymentVerify] Paystack verification failed:`, verification.error);
      return NextResponse.json(
        { error: verification.error || 'Payment verification failed' },
        { status: 400 }
      );
    }

    const txRef: string = verification.transactionReference!; // our UUID
    const amount: number = verification.amount!;

    console.log(`[PaymentVerify] Paystack confirmed payment for txRef: ${txRef}`);

    // ── Lookup the transaction ────────────────────────────
    const { data: txRow } = await supabaseAdmin
      .from('escrow_transactions')
      .select('buyer_id, item_id, seller_id, status, total_amount')
      .eq('id', txRef)
      .single();

    if (!txRow) {
      console.error(`[PaymentVerify] Transaction not found: ${txRef}`);
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    if (Math.abs(amount - txRow.total_amount) > 1) {
      console.error(`[PaymentVerify] Amount mismatch. Expected: ${txRow.total_amount}, Actual: ${amount}`);
      return NextResponse.json(
        { error: `Amount mismatch. Expected: ${txRow.total_amount}, Actual: ${amount}` },
        { status: 400 }
      );
    }

    if (user && txRow.buyer_id !== user.id) {
      console.warn(`[PaymentVerify] User ${user.id} tried to verify transaction for buyer ${txRow.buyer_id}`);
      return NextResponse.json(
        { error: 'Unauthorized: you cannot verify this transaction' },
        { status: 403 }
      );
    }

    console.log(`[PaymentVerify] Transaction ${txRef} ownership verified`);

    // ── Skip if already paid (idempotent) ──────────────
    if (txRow.status === EscrowStatus.PAID) {
      console.log(`[PaymentVerify] Transaction ${txRef} already marked as PAID (idempotent)`);
      return NextResponse.json({
        success: true,
        message: 'Payment already verified',
        transactionId: txRef,
        amount,
      });
    }

    // ── Update escrow transaction status (admin bypasses RLS) ──
    const { data: updateData, error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.PAID,
        payment_reference: txRef,   // store our UUID as the reference
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', txRef)
      .eq('status', EscrowStatus.PENDING)
      .select();

    if (updateError) {
      console.error(`[PaymentVerify] Failed to update escrow transaction ${txRef}:`, updateError);
      // Don't fail — payment was real, log and continue
    } else if (!updateData || updateData.length === 0) {
      console.log(`[PaymentVerify] Transaction ${txRef} already processed (race condition avoided)`);
      return NextResponse.json({
        success: true,
        message: 'Payment verified successfully',
        transactionId: txRef,
        amount,
      });
    } else {
      console.log(`[PaymentVerify] Successfully updated transaction ${txRef} to PAID`);
    }

    // ── Mark item as sold ──────────────────────────────────
    if (txRow.item_id) {
      const { error: saleError } = await supabaseAdmin
        .from('posts')
        .update({ 
          is_sold: true, 
          sold_to_user_id: txRow.buyer_id,
          sold_at: new Date().toISOString(),
          transaction_id: txRef,
          updated_at: new Date().toISOString() 
        })
        .eq('id', txRow.item_id);

      if (saleError) {
        console.error(`[PaymentVerify] Failed to mark item ${txRow.item_id} as sold:`, saleError);
      } else {
        console.log(`[PaymentVerify] Item ${txRow.item_id} marked as sold`);
      }
    }

    // ── Send notification to seller ────────────────────────
    try {
      const { data: buyer } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', txRow.buyer_id)
        .single();

      const { data: item } = await supabaseAdmin
        .from('posts')
        .select('title, text')
        .eq('id', txRow.item_id)
        .single();

      const buyerName = buyer?.name || 'A buyer';
      const itemTitle = item?.title || item?.text || 'an item';

      try {
        const { data: notifData, error: notifError } = await supabaseAdmin.rpc('create_notification', {
          p_user_id: txRow.seller_id,
          p_type: 'payment_successful',
          p_title: 'Payment Received! 💰',
          p_message: `${buyerName} has paid for "${itemTitle}". Arrange handover with the buyer.`,
          p_sender_id: null,
          p_related_id: txRef,
          p_related_type: 'escrow_transaction',
          p_data: { buyerName, itemTitle, transactionId: txRef, amount }
        });

        if (notifError) {
          console.error('[PaymentVerify] Error creating notification via RPC:', notifError);
        } else {
          let shouldPush = true;
          let pushMessage = `${buyerName} has paid for "${itemTitle}". Arrange handover with the buyer.`;
          
          if (notifData && typeof notifData === 'object') {
            shouldPush = (notifData as any).should_push ?? true;
            if ((notifData as any).message) pushMessage = (notifData as any).message;
          }

          if (shouldPush) {
            await supabaseAdmin.functions.invoke('send-push-notification', {
              body: { 
                userId: txRow.seller_id, 
                payload: {
                  title: 'Payment Received! 💰',
                  body: pushMessage,
                  data: { buyerName, itemTitle, transactionId: txRef, amount },
                  url: `/transactions/${txRef}`
                },
                type: 'payment_successful'
              }
            });
          }
        }
      } catch (notificationError) {
        console.error('Failed to send payment notification:', notificationError);
        // Don't fail the response — payment is confirmed
      }
    } catch (notificationProcessError) {
      console.error('Failed to process payment notification:', notificationProcessError);
    }

    console.log(`[PaymentVerify] Payment verification completed successfully for transaction ${txRef}`);
    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully',
      transactionId: txRef,
      amount,
    });
  } catch (error) {
    console.error('[PaymentVerify] Critical error during payment verification:', error);
    console.error('[PaymentVerify] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
