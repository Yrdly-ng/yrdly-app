import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';
import { FlutterwaveService } from '@/lib/flutterwave-service';

/**
 * POST /api/webhooks/flutterwave
 *
 * Server-authoritative webhook handler for Flutterwave payment events.
 * This ensures payment confirmation even if the buyer closes their browser
 * after paying on Flutterwave.
 *
 * Flutterwave sends `charge.completed` events here with the transaction details.
 * We verify the webhook signature using FLUTTERWAVE_SECRET_HASH.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Verify webhook signature ──────────────────────────
    const signature = request.headers.get('verif-hash');
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;

    if (!secretHash) {
      console.error('[Webhook] CRITICAL: FLUTTERWAVE_SECRET_HASH is not set in environment variables');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (!signature || signature !== secretHash) {
      console.error('[Webhook] Invalid signature. Expected:', secretHash.substring(0, 10) + '***', 'Received:', signature?.substring(0, 10) + '***');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const payload = await request.json();
    const { event, data } = payload;

    console.log(`[Webhook] Received event: ${event}, status: ${data?.status}`);

    // ── Handle charge.completed ───────────────────────────
    if (event === 'charge.completed' && data?.status === 'successful') {
      const flwTxId = data.id;         // Flutterwave's numeric transaction_id

      if (!flwTxId) {
        console.error('[Webhook] Missing transaction id in payload');
        return NextResponse.json({ status: 'ok' }); // Ack to prevent retries
      }

      // ── Server-side Verification ───────────────────────────
      // Double check with Flutterwave that this transaction is actually successful
      const verification = await FlutterwaveService.verifyPayment(flwTxId);
      
      if (!verification.success || verification.status !== 'successful') {
        console.error(`[Webhook] Transaction ${flwTxId} failed server-side verification:`, verification.error);
        return NextResponse.json({ status: 'ok' }); // Ack to prevent retries
      }

      const txRef = verification.transactionReference; // Our transaction ID from verification
      const amount = verification.amount ?? 0;

      if (!txRef) {
        console.error('[Webhook] Missing tx_ref after verification');
        return NextResponse.json({ status: 'ok' });
      }

      // ── Handle Event Tickets Webhook ─────────────────────
      if (txRef.startsWith('evt-')) {
        console.log(`[Webhook] Processing event ticket transaction ${txRef}`);
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yrdly-app.vercel.app';
          const verifyUrl = `${appUrl}/api/events/tickets/verify?tx_ref=${txRef}`;
          // Calling the verify endpoint natively handles idempotency, capacity checks, and email sending
          await fetch(verifyUrl, { method: 'GET' });
          console.log(`[Webhook] Event ticket verify triggered successfully for ${txRef}`);
        } catch (e) {
          console.error('[Webhook] Failed to trigger verify route for event ticket', e);
        }
        return NextResponse.json({ status: 'ok' });
      }

      // ── Check current transaction state (idempotent) for Escrow ────
      const { data: txRow, error: fetchError } = await supabaseAdmin
        .from('escrow_transactions')
        .select('id, status, item_id, buyer_id, seller_id, total_amount')
        .eq('id', txRef)
        .single();

      if (fetchError || !txRow) {
        console.error(`[Webhook] Transaction not found for tx_ref: ${txRef}`, fetchError);
        return NextResponse.json({ status: 'ok' }); // Ack anyway to prevent retries
      }

      console.log(`[Webhook] Found transaction ${txRef} with status: ${txRow.status}`);

      // Verify the webhook amount matches what we stored — prevents crafted payloads
      if (Math.abs(amount - txRow.total_amount) > 1) {
        console.error(`[Webhook] Amount mismatch for ${txRef}. Expected ${txRow.total_amount}, got ${amount}`);
        return NextResponse.json({ status: 'ok' }); // Ack to prevent retries
      }

      // Already paid or beyond — skip
      if (txRow.status !== EscrowStatus.PENDING) {
        console.log(`[Webhook] Transaction ${txRef} already ${txRow.status}, skipping (idempotent)`);
        return NextResponse.json({ status: 'ok' });
      }

      // ── Update to PAID ──────────────────────────────────
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.PAID,
          payment_reference: String(flwTxId),
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', txRef)
        .eq('status', EscrowStatus.PENDING)
        .select();

      if (updateError) {
        console.error(`[Webhook] Failed to update escrow transaction ${txRef}:`, updateError);
        return NextResponse.json({ status: 'ok' });
      } else if (!updateData || updateData.length === 0) {
        console.log(`[Webhook] Transaction ${txRef} already processed (race condition avoided)`);
        return NextResponse.json({ status: 'ok' });
      } else {
        console.log(`[Webhook] Successfully updated transaction ${txRef} to PAID status`);
      }

      // ── Mark item as sold ───────────────────────────────
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
          console.error(`[Webhook] Failed to mark item ${txRow.item_id} as sold:`, saleError);
        } else {
          console.log(`[Webhook] Item ${txRow.item_id} marked as sold`);
        }
      }

      // ── Fetch buyer, seller, and item details ──────────
      let buyer, seller, item;
      try {
        const { data: buyerData } = await supabaseAdmin
          .from('users')
          .select('id, name, email')
          .eq('id', txRow.buyer_id)
          .single();
        buyer = buyerData;

        const { data: sellerData } = await supabaseAdmin
          .from('users')
          .select('id, name, email')
          .eq('id', txRow.seller_id)
          .single();
        seller = sellerData;

        const { data: itemData } = await supabaseAdmin
          .from('posts')
          .select('id, title, text, price')
          .eq('id', txRow.item_id)
          .single();
        item = itemData;
      } catch (fetchError) {
        console.error('[Webhook] Error fetching user/item details:', fetchError);
      }

      const buyerName = buyer?.name || 'Valued Customer';
      const sellerName = seller?.name || 'Seller';
      const buyerEmail = buyer?.email;
      const sellerEmail = seller?.email;
      const itemTitle = item?.title || item?.text || 'an item';

      // ── Send buyer receipt email ─────────────────────────
      if (buyerEmail && ResendEmailService.isConfigured()) {
        try {
          const { subject, html } = emailTemplates.escrowPaymentReceipt(
            buyerName,
            itemTitle,
            amount,
            txRef
          );
          
          await ResendEmailService.sendEmail(
            buyerEmail,
            subject,
            html,
            'Escrow Payment Receipt'
          );
          console.log(`[Webhook] Buyer receipt email sent to ${buyerEmail}`);
        } catch (emailError) {
          console.error(`[Webhook] Failed to send buyer receipt email to ${buyerEmail}:`, emailError);
        }
      } else {
        console.warn('[Webhook] Cannot send buyer email - missing email or Resend not configured');
      }

      // ── Send seller order notification email ──────────────
      if (sellerEmail && ResendEmailService.isConfigured()) {
        try {
          const { subject, html } = emailTemplates.escrowOrderNotification(
            sellerName,
            buyerName,
            itemTitle,
            amount,
            txRef
          );
          
          await ResendEmailService.sendEmail(
            sellerEmail,
            subject,
            html,
            'New Order Notification'
          );
          console.log(`[Webhook] Order notification email sent to ${sellerEmail}`);
        } catch (emailError) {
          console.error(`[Webhook] Failed to send seller notification email to ${sellerEmail}:`, emailError);
        }
      } else {
        console.warn('[Webhook] Cannot send seller email - missing email or Resend not configured');
      }

      // ── Create in-app notification for seller ────────────
      try {
        await supabaseAdmin
          .from('notifications')
          .insert({
            user_id: txRow.seller_id,
            type: 'payment_successful',
            title: 'Payment Received! 💰',
            message: `${buyerName} has paid for "${itemTitle}". Arrange handover with the buyer.`,
            related_id: txRef,
            related_type: 'escrow_transaction',
            data: { buyerName, itemTitle, transactionId: txRef, amount },
          });
        console.log(`[Webhook] In-app notification created for seller ${txRow.seller_id}`);
      } catch (notificationError) {
        console.error('[Webhook] Failed to create in-app notification:', notificationError);
      }

      console.log(`[Webhook] Transaction ${txRef} processing completed successfully`);
    } else {
      console.log(`[Webhook] Event not handled: ${event}`);
    }

    // Always return 200 to acknowledge receipt (prevents Flutterwave retries)
    console.log('[Webhook] Responding with HTTP 200 OK');
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('[Webhook] Critical error during webhook processing:', error);
    console.error('[Webhook] Error stack:', error instanceof Error ? error.stack : 'No stack trace available');
    // Return 200 even on errors to prevent infinite retries
    console.log('[Webhook] Responding with HTTP 200 OK despite error (to prevent retries)');
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}
