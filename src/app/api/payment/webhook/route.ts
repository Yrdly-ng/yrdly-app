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
      .select('id, buyer_id, item_id, status')
      .or(`id.eq.${reference},payluk_escrow_id.eq.${reference},payluk_tx_ref.eq.${reference}`)
      .maybeSingle();

    if (txError || !tx) {
      console.error('[Webhook] Transaction not found for reference:', reference);
      return NextResponse.json({ received: true });
    }

    if (tx.status === EscrowStatus.PAID) {
      console.log('[Webhook] Already PAID (idempotent):', reference);
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
      .eq('status', EscrowStatus.PENDING)
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

    console.log('[Webhook] ✅ Transaction marked PAID via webhook:', reference);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
