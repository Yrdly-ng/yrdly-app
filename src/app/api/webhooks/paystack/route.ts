import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { ResendEmailService } from '@/lib/resend-service';
import { emailTemplates } from '@/lib/email-templates';
import { PaystackService } from '@/lib/paystack-service';
import { TicketService } from '@/lib/ticket-service';
import { sendPushNotification } from '@/lib/server-push-notification';

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

    if (!signature || !/^[a-f0-9]{128}$/i.test(signature) ||
        !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
      console.error('[Webhook] Invalid Paystack signature');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { event, data } = payload;

    console.log(`[Webhook] Received event: ${event}, status: ${data?.status}`);

    if (typeof event === 'string' && event.startsWith('refund.')) {
      await handleTicketRefundEvent(event, data);
      return NextResponse.json({ status: 'ok' });
    }

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
          const code = e instanceof Error ? e.message : '';
          if (!['sold_out_refunded', 'sold_out_refund_required', 'sold_out_payluk_refund_required'].includes(code)) {
            return NextResponse.json({ error: 'Ticket processing failed' }, { status: 500 });
          }
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
        return NextResponse.json({ error: 'Transaction update failed' }, { status: 500 });
      } else if (!updateData || updateData.length === 0) {
        console.log(`[Webhook] Transaction ${txRef} already processed (race condition avoided)`);
        return NextResponse.json({ status: 'ok' });
      }

      // ── Mark item as sold ─────────────────────────────
      if (txRow.item_id) {
        if (txRow.item_type === 'catalog_item') {
          try {
            const { data: catItem } = await supabaseAdmin
              .from('catalog_items')
              .select('id, quantity, in_stock')
              .eq('id', txRow.item_id)
              .maybeSingle();

            if (catItem) {
              const currentQty = typeof catItem.quantity === 'number' ? catItem.quantity : 1;
              const newQty = Math.max(0, currentQty - 1);
              const inStock = newQty > 0;

              await supabaseAdmin
                .from('catalog_items')
                .update({
                  quantity: newQty,
                  in_stock: inStock,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', txRow.item_id);
            } else {
              await supabaseAdmin
                .from('catalog_items')
                .update({
                  in_stock: false,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', txRow.item_id);
            }
          } catch (e) {
            console.error('[Webhook] Error updating catalog stock:', e);
          }
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
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

async function handleTicketRefundEvent(event: string, data: any): Promise<void> {
  const refundStatus = event.slice('refund.'.length);
  if (!['pending', 'processing', 'needs-attention', 'failed', 'processed'].includes(refundStatus)) return;
  const paymentReference = data?.transaction_reference;
  if (typeof paymentReference !== 'string') throw new Error('Refund webhook has no transaction reference');
  const allowedPrevious = refundStatus === 'pending'
    ? ['initiating', 'pending']
    : refundStatus === 'processing'
      ? ['initiating', 'pending', 'processing']
      : ['initiating', 'pending', 'processing', 'needs-attention', 'failed'];

  const { data: tickets, error: lookupError } = await supabaseAdmin.from('tickets')
    .select('id, buyer_id, amount_paid')
    .eq('payment_provider_ref', paymentReference).eq('status', 'PAID')
    .in('refund_status', allowedPrevious);
  if (lookupError) throw lookupError;
  if (!tickets?.length) return;

  const expectedKobo = Math.round(tickets.reduce((sum, ticket) => sum + Number(ticket.amount_paid), 0) * 100);
  if (Number(data.amount) !== expectedKobo) {
    throw new Error(`Refund amount mismatch for ${paymentReference}`);
  }

  const { error: updateError } = await supabaseAdmin.from('tickets')
    .update({
      refund_status: refundStatus,
      ...(refundStatus === 'processed' ? { status: 'REFUNDED', updated_at: new Date().toISOString() } : {}),
    })
    .in('id', tickets.map(ticket => ticket.id))
    .eq('status', 'PAID')
    .in('refund_status', allowedPrevious);
  if (updateError) throw updateError;

  if (['processed', 'failed', 'needs-attention'].includes(refundStatus)) {
    const title = refundStatus === 'processed' ? 'Ticket refund processed' : 'Ticket refund needs attention';
    const message = refundStatus === 'processed'
      ? 'Paystack has processed your ticket refund. The credit may still take time to reach your payment method.'
      : 'Your ticket refund needs support review. Please contact Yrdly support with your payment reference.';
    for (const ticket of tickets) {
      const notification = {
        user_id: ticket.buyer_id, type: 'event_cancelled', title, message,
        related_id: ticket.id, related_type: 'ticket',
        data: { ticketId: ticket.id, paymentReference, refundStatus },
      };
      const { error } = await supabaseAdmin.from('notifications').insert(notification);
      if (error) throw error;
      await sendPushNotification(supabaseAdmin, ticket.buyer_id, {
        title: notification.title,
        body: notification.message,
        data: notification.data,
        url: '/my-events',
      }, notification.type);
    }
  }
}
