import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';
import { PaystackService } from '@/lib/paystack-service';
import { TicketService } from '@/lib/ticket-service';

/**
 * POST /api/webhooks/paystack
 *
 * Server-authoritative webhook handler for Paystack payment events.
 * Paystack sends `charge.success` events here with the transaction details.
 * We verify the webhook signature using HMAC SHA512 and PAYSTACK_SECRET_KEY.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Verify webhook signature ──────────────────────────
    const signature = request.headers.get('x-paystack-signature');
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error('[Webhook] CRITICAL: PAYSTACK_SECRET_KEY is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const rawBody = await request.text();
    const expectedSignature = createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      console.error('[Webhook] Invalid Paystack signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { event, data } = payload;

    console.log(`[Webhook] Received event: ${event}, status: ${data?.status}`);

    // ── Handle charge.success ─────────────────────────────
    if (event === 'charge.success' && data?.status === 'success') {
      const txRef = data.reference as string; // Our transaction ID (set as Paystack reference)
      const amount = (data.amount as number) / 100; // Convert kobo → NGN

      if (!txRef) {
        console.error('[Webhook] Missing reference in payload');
        return NextResponse.json({ status: 'ok' });
      }

      // ── Server-side re-verification ───────────────────
      const verification = await PaystackService.verifyPayment(txRef);
      if (!verification.success || verification.status !== 'success') {
        console.error(`[Webhook] Transaction ${txRef} failed server-side verification`);
        return NextResponse.json({ status: 'ok' });
      }

      // ── Handle Event Tickets Webhook ──────────────────
      if (txRef.startsWith('evt-')) {
        console.log(`[Webhook] Processing event ticket transaction ${txRef}`);
        try {
          await TicketService.verifyAndProcessTicket(txRef);
          console.log(`[Webhook] Event ticket verify successful for ${txRef}`);
        } catch (e) {
          console.error('[Webhook] Failed to verify event ticket', e);
        }
        return NextResponse.json({ status: 'ok' });
      }

      // ── Check current transaction state (idempotent) ──
      const { data: txRow, error: fetchError } = await supabaseAdmin
        .from('escrow_transactions')
        .select('id, status, item_id, buyer_id, seller_id, total_amount, item_type')
        .eq('id', txRef)
        .single();

      if (fetchError || !txRow) {
        console.error(`[Webhook] Transaction not found for ref: ${txRef}`, fetchError);
        return NextResponse.json({ status: 'ok' });
      }

      // Verify amount matches to prevent crafted payloads
      if (Math.abs(amount - txRow.total_amount) > 1) {
        console.error(`[Webhook] Amount mismatch for ${txRef}. Expected ${txRow.total_amount}, got ${amount}`);
        return NextResponse.json({ status: 'ok' });
      }

      if (txRow.status !== EscrowStatus.PENDING) {
        console.log(`[Webhook] Transaction ${txRef} already ${txRow.status}, skipping`);
        return NextResponse.json({ status: 'ok' });
      }

      // ── Update to PAID ────────────────────────────────
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('escrow_transactions')
        .update({
          status: EscrowStatus.PAID,
          payment_reference: txRef,
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
      }

      // ── Mark item as sold ─────────────────────────────
      if (txRow.item_id) {
        if (txRow.item_type === 'catalog_item') {
          await supabaseAdmin
            .from('catalog_items')
            .update({
              in_stock: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', txRow.item_id);
        } else {
          await supabaseAdmin
            .from('posts')
            .update({
              is_sold: true,
              sold_to_user_id: txRow.buyer_id,
              sold_at: new Date().toISOString(),
              transaction_id: txRef,
              updated_at: new Date().toISOString(),
            })
            .eq('id', txRow.item_id);
        }
      }

      // ── Fetch buyer, seller, item for notifications ───
      let buyer, seller, item;
      try {
        const itemPromise = txRow.item_type === 'catalog_item'
          ? supabaseAdmin.from('catalog_items').select('id, title, description, price').eq('id', txRow.item_id).single()
          : supabaseAdmin.from('posts').select('id, title, text, price').eq('id', txRow.item_id).single();

        const [{ data: b }, { data: s }, { data: i }] = await Promise.all([
          supabaseAdmin.from('users').select('id, name, email').eq('id', txRow.buyer_id).single(),
          supabaseAdmin.from('users').select('id, name, email').eq('id', txRow.seller_id).single(),
          itemPromise,
        ]);
        buyer = b; seller = s; item = i;
      } catch (e) {
        console.error('[Webhook] Error fetching user/item details:', e);
      }

      const buyerName = buyer?.name || 'Valued Customer';
      const sellerName = seller?.name || 'Seller';
      const itemTitle = item?.title || (item as any)?.text || (item as any)?.description || 'an item';

      // ── Send emails ───────────────────────────────────
      if (buyer?.email && ResendEmailService.isConfigured()) {
        try {
          const { subject, html } = emailTemplates.escrowPaymentReceipt(buyerName, itemTitle, amount, txRef);
          await ResendEmailService.sendEmail(buyer.email, subject, html, 'Escrow Payment Receipt');
        } catch (e) {
          console.error('[Webhook] Failed to send buyer receipt email:', e);
        }
      }

      if (seller?.email && ResendEmailService.isConfigured()) {
        try {
          const { subject, html } = emailTemplates.escrowOrderNotification(sellerName, buyerName, itemTitle, amount, txRef);
          await ResendEmailService.sendEmail(seller.email, subject, html, 'New Order Notification');
        } catch (e) {
          console.error('[Webhook] Failed to send seller notification email:', e);
        }
      }

      // ── In-app and Push notification for seller ────────────────
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
          console.error('[Webhook] Error creating notification via RPC:', notifError);
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
      } catch (e) {
        console.error('[Webhook] Failed to send push/in-app notification:', e);
      }

      console.log(`[Webhook] Transaction ${txRef} processing completed successfully`);
    } else {
      console.log(`[Webhook] Event not handled: ${event}`);
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('[Webhook] Critical error:', error instanceof Error ? error.stack : error);
    // Always return 200 to prevent Paystack retries on our logic errors
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}
