import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';
import crypto from 'crypto';

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

    if (signature !== secretHash) {
      console.error('[Webhook] Invalid signature. Expected:', secretHash.substring(0, 10) + '***', 'Received:', signature?.substring(0, 10) + '***');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    const payload = await request.json();
    const { event, data } = payload;

    console.log(`[Webhook] Received event: ${event}, status: ${data?.status}`);

    // ── Handle charge.completed ───────────────────────────
    if (event === 'charge.completed' && data?.status === 'successful') {
      const txRef = data.tx_ref;       // Our escrow transaction ID
      const flwRef = data.flw_ref;     // Flutterwave's reference
      const amount = parseFloat(data.amount);

      if (!txRef) {
        console.error('Webhook missing tx_ref');
        return NextResponse.json({ status: 'ok' }); // Ack to prevent retries
      }

      // ── Check current transaction state (idempotent) ────
      const { data: txRow, error: fetchError } = await supabaseAdmin
        .from('escrow_transactions')
        .select('id, status, item_id, buyer_id, seller_id')
        .eq('id', txRef)
        .single();

      if (fetchError || !txRow) {
        console.error(`[Webhook] Transaction not found for tx_ref: ${txRef}`, fetchError);
        return NextResponse.json({ status: 'ok' }); // Ack anyway to prevent retries
      }

      console.log(`[Webhook] Found transaction ${txRef} with status: ${txRow.status}`);

      // Already paid or beyond — skip
      if (txRow.status !== EscrowStatus.PENDING) {
        console.log(`[Webhook] Transaction ${txRef} already ${txRow.status}, skipping (idempotent)`);
        return NextResponse.json({ status: 'ok' });
      }

      // ── Update to PAID ──────────────────────────────────
      const { error: updateError } = await supabaseAdmin
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.PAID,
          payment_reference: flwRef,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', txRef);

      if (updateError) {
        console.error(`[Webhook] Failed to update escrow transaction ${txRef}:`, updateError);
      } else {
        console.log(`[Webhook] Successfully updated transaction ${txRef} to PAID status`);
      }

      // ── Mark item as sold ───────────────────────────────
      if (txRow.item_id) {
        const { error: saleError } = await supabaseAdmin
          .from('posts')
          .update({ is_sold: true, updated_at: new Date().toISOString() })
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
