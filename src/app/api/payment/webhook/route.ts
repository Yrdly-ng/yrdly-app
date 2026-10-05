import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { verifyPaylukWebhookSignature } from '@/lib/payluk-webhook';

/**
 * POST /api/payment/webhook
 * Server-side safety net: marks escrow transactions PAID when Payluk
 * fires payment.success events, regardless of client-side callback state.
 * Register in Payluk dashboard → Webhooks → URL: https://app.yrdly.ng/api/payment/webhook
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-payluk-signature') ?? '';

    const secret = process.env.PAYLUK_SECRET_KEY || process.env.PAYLUK_WEBHOOK_SECRET;
    if (!secret) return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
    if (!verifyPaylukWebhookSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    console.log('[Webhook] Payluk event received:', event?.event, event?.data?.reference || event?.data?.id);

    const isSuccess =
      event?.event === 'escrow.ongoing' ||
      event?.event === 'payment.escrow.success' ||
      event?.event === 'payment.deposit.success' ||
      event?.event === 'payment.success' ||
      event?.data?.status === 'success' ||
      event?.data?.status === 'paid' ||
      event?.data?.state === 'OPENED';

    if (!isSuccess) {
      console.log('[Webhook] Ignoring non-success event:', event?.event);
      return NextResponse.json({ received: true });
    }

    const reference: string =
      event?.data?.reference ||
      event?.data?.paymentToken ||
      event?.data?.id ||
      event?.data?.txRef ||
      event?.data?.transactionRef ||
      event?.reference;

    if (!reference) {
      console.error('[Webhook] No reference in Payluk payload:', event);
      return NextResponse.json({ error: 'No reference' }, { status: 400 });
    }

    const { data: tx, error: txError } = await supabaseAdmin
      .from('escrow_transactions')
      .select('id, buyer_id, seller_id, item_id, status')
      .or(`id.eq.${reference},payluk_escrow_id.eq.${reference},payluk_tx_ref.eq.${reference}`)
      .maybeSingle();

    if (txError || !tx) {
      console.error('[Webhook] Transaction not found for reference:', reference);
      return NextResponse.json({ received: true });
    }

    if (![EscrowStatus.PENDING, 'creating_escrow'].includes(tx.status as any)) {
      console.log('[Webhook] Transaction is no longer awaiting payment (idempotent):', reference, tx.status);
      return NextResponse.json({ received: true });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: EscrowStatus.PAID,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', [EscrowStatus.PENDING, 'creating_escrow'])
      .select('id');

    if (updateError) {
      console.error('[Webhook] DB update failed:', reference, updateError);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }
    if (!updated?.length) return NextResponse.json({ received: true });

    if (tx.item_id) {
      await supabaseAdmin
        .from('posts')
        .update({
          is_sold: true,
          sold_to_user_id: tx.buyer_id,
          sold_at: new Date().toISOString(),
          transaction_id: tx.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tx.item_id);
    }

    try {
      const [{ data: buyer }, { data: item }] = await Promise.all([
        supabaseAdmin.from('users').select('name').eq('id', tx.buyer_id).maybeSingle(),
        tx.item_id
          ? supabaseAdmin.from('posts').select('title, text').eq('id', tx.item_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const buyerName = buyer?.name || 'A buyer';
      const itemTitle = item?.title || item?.text || 'your item';
      const message = `${buyerName} has paid for "${itemTitle}". Arrange handover with the buyer.`;
      const { data: notification, error: notificationError } = await supabaseAdmin.rpc('create_notification', {
        p_user_id: tx.seller_id,
        p_type: 'payment_successful',
        p_title: 'Payment Received! 💰',
        p_message: message,
        p_sender_id: null,
        p_related_id: tx.id,
        p_related_type: 'escrow_transaction',
        p_data: { buyerName, itemTitle, transactionId: tx.id },
      });
      let shouldPush = true;
      if (notificationError) {
        console.error('[Webhook] Seller notification RPC failed:', notificationError.message);
        const { error: insertError } = await supabaseAdmin.from('notifications').insert({
          user_id: tx.seller_id,
          type: 'payment_successful',
          title: 'Payment Received! 💰',
          message,
          related_id: tx.id,
          related_type: 'escrow_transaction',
          data: { buyerName, itemTitle, transactionId: tx.id },
        });
        if (insertError) throw insertError;
      } else if (notification && typeof notification === 'object') {
        shouldPush = (notification as any).should_push ?? true;
      }
      if (shouldPush) {
        const { error: pushError } = await supabaseAdmin.functions.invoke('send-push-notification', {
          body: {
            userId: tx.seller_id,
            payload: { title: 'Payment Received! 💰', body: message, data: { transactionId: tx.id }, url: `/transactions/${tx.id}` },
            type: 'payment_successful',
          },
        });
        if (pushError) console.error('[Webhook] Seller push notification failed:', pushError.message);
      }
    } catch (notificationError) {
      console.error('[Webhook] Failed to notify seller about payment:', notificationError);
    }

    console.log('[Webhook] ✅ Transaction marked PAID via webhook:', reference);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
