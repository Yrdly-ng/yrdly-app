import { applyEscrowPayment } from '@/lib/escrow-payment';
import { ESCROW_ALLOWED_FROM, paymentReferenceFilter } from '@/lib/payment-state';
import { flagPayment } from '@/lib/payment-reconciliation';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPaylukWebhookSignature } from '@/lib/payluk-webhook';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { NotificationService } from '@/lib/server-notification-service';
import { TicketService } from '@/lib/ticket-service';
import { PaylukService } from '@/lib/payluk-service';
import { handlePaylukWebhookEvent as handleBookingPaymentEvent } from '@/lib/booking-payments';
import { PayoutService } from '@/lib/payout-service';
import { sendPushNotification } from '@/lib/server-push-notification';

// ── Signature verification ───────────────────────────────────────────────────
//
// Per https://docs.payluk.ng/concepts/webhooks.md (fetched 2026-08-20):
//   Header:    x-payluk-signature
//   Algorithm: HMAC-SHA512
//   Signed:    exact raw bytes of the request body
//   Key:       PAYLUK_SECRET_KEY (sk_test_… or sk_live_… depending on environment)
//
// Must use timingSafeEqual to prevent timing attacks.
// Must operate on the raw body — re-serializing parsed JSON may reorder keys
// and invalidate the signature.

const PAYLUK_SECRET_KEY = process.env.PAYLUK_SECRET_KEY;

// ── Payload types ────────────────────────────────────────────────────────────

interface PaylukEscrowData {
  id: string;               // Payluk escrow ID — matches payluk_tx_ref in our DB
  amount: number;
  purpose: string;
  status: string;
  state: string;
  paymentToken: string;
  sellerId: string;
  buyerId: string;
  paidAt: string | null;
  completedAt: string | null;
  dispute: unknown[] | null;
  environment: string;
  merchantId: string;
  // split only present on escrow.split
  split?: { sellerAmount: number; buyerAmount: number; pool: number; resolvedAt: string };
}

interface PaylukWebhookPayload {
  event: string;
  data: PaylukEscrowData;
  timestamp: string;
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Read raw body bytes — must not re-serialize for signature check.
  const rawBody = Buffer.from(await request.arrayBuffer());
  const receivedSig = request.headers.get('x-payluk-signature');

  if (!PAYLUK_SECRET_KEY) return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
  if (!verifyPaylukWebhookSignature(rawBody, receivedSig, PAYLUK_SECRET_KEY)) {
    console.warn('[PaylukWebhook] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: PaylukWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, data } = payload;
  console.log(`[PaylukWebhook] Received event: ${event} for escrow ${data?.id}`);

  // Acknowledge only after durable financial effects or reconciliation flags commit.

  try {
    switch (event) {

      // ── escrow.completed ─────────────────────────────────────────────────
      // Fires when buyer confirms delivery or final milestone is released.
      // Our confirmDelivery API call already handles this path synchronously,
      // but the webhook may also arrive — idempotent update is safe.
      case 'escrow.completed': {
        await handleEscrowCompleted(data);
        break;
      }

      // ── escrow.claimed ───────────────────────────────────────────────────
      // Fires when the seller claims funds directly through Payluk after the
      // delivery window has elapsed. This is the genuinely new case: our
      // backend was not the initiator, so only this webhook triggers the DB update.
      case 'escrow.claimed': {
        await handleEscrowClaimed(data);
        break;
      }

      // ── escrow.disputed ──────────────────────────────────────────────────
      // Fires when either party opens a dispute via Payluk's UI.
      // Update local state and notify buyer + seller + (implicitly) admin via
      // NotificationService.createDisputeOpenedNotification.
      case 'escrow.disputed': {
        await handleEscrowDisputed(data);
        break;
      }

      // ── escrow.ongoing / payment.escrow.success ──────────────────────────
      // Fires when buyer funds the escrow. Update local status to PAID,
      // mark item as sold (posts / catalog_items / tickets) and notify seller.
      case 'escrow.ongoing':
      case 'payment.escrow.success':
      case 'escrow.paid':
      case 'escrow.opened': {
        if (!['ONGOING','COMPLETED','CLAIMED'].includes((data.status || '').toUpperCase())) break;
        await handleEscrowOngoing(data);
        break;
      }

      case 'payment.success': {
        const payment = data as any;
        if (payment.transactionType !== 'escrow' || payment.status !== 'success') break;
        const id = payment.escrowDetails?.id;
        if (!id) { await flagPayment('payluk', payment.reference || payment.id, null, 'missing_escrow_reference'); break; }
        const verified = await PaylukService.verifyEscrow(id);
        if (['ONGOING','COMPLETED','CLAIMED'].includes((verified.status || '').toUpperCase())) await handleEscrowOngoing(verified);
        break;
      }

      // ── escrow.refunded / escrow.cancelled ──────────────────────────────
      // Fires when Payluk refunds/cancels the escrow (e.g. bank reversal,
      // seller rejection, or dispute outcome). Mark transaction as REFUNDED,
      // revert item availability, cancel tickets, and notify buyer & seller.
      case 'escrow.refunded':
      case 'escrow.cancelled': {
        await handleEscrowRefunded(data);
        break;
      }

      // ── All other events: log and ack ────────────────────────────────────
      // escrow.created, escrow.pending, escrow.investigating, escrow.split
      // Logging them preserves observability without blocking.
      default: {
        console.log(`[PaylukWebhook] Unhandled event type: ${event} for escrow ${data?.id} — acknowledged without action`);
        break;
      }
    }
    await handleBookingPaymentEvent(payload);
  } catch (err) {
    console.error(`[PaylukWebhook] Error processing event ${event}:`, err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function findTransactionByPaylukData(data: Pick<PaylukEscrowData, 'id' | 'paymentToken'>) {
  const targetId = data.id;
  const token = data.paymentToken;

  const columns = ['payluk_escrow_id', 'payluk_tx_ref', 'id', 'payment_reference'];
  const orClause = paymentReferenceFilter(targetId, columns) + (token ? `,${paymentReferenceFilter(token, columns)}` : '');

  return await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status, buyer_id, seller_id, item_id, item_type, amount, payment_provider, payluk_tx_ref, payluk_escrow_id, metadata')
    .or(orClause)
    .maybeSingle();
}

async function handleEscrowOngoing(data: Pick<PaylukEscrowData, 'id' | 'paymentToken'>) {
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    if (error) throw error;
    await flagPayment('payluk', data.id, null, 'unknown_success');
    return;
  }

  const applied = await applyEscrowPayment(tx.id,'payluk',data.id);
  // Ticket issuance is separately idempotent and must be retried after a crash.
  if ((tx.item_type === 'ticket' || tx.metadata?.event_id) &&
      (applied || ['paid','shipped','delivered','completed'].includes(tx.status))) {
    try { await TicketService.processTicketPaymentFromTransaction(tx); }
    catch (error) {
      await flagPayment('payluk',data.id,tx.id,'ticket_fulfillment_failed');
      throw error;
    }
  }
  if (!applied) return;

  // 3. Notify seller
  try {
    const { data: buyer } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', tx.buyer_id)
      .single();

    const buyerName = buyer?.name || 'A buyer';

    const message = `${buyerName} has paid for your item. Arrange handover with the buyer.`;
    const { data: notification, error: notificationError } = await supabaseAdmin.rpc('create_notification', {
      p_user_id: tx.seller_id,
      p_type: 'payment_successful',
      p_title: 'Payment Received! 💰',
      p_message: message,
      p_sender_id: null,
      p_related_id: tx.id,
      p_related_type: 'escrow_transaction',
      p_data: { buyerName, transactionId: tx.id },
    });
    let shouldPush = true;
    if (notificationError) {
      console.error(`[PaylukWebhook] Notification RPC failed for tx ${tx.id}:`, notificationError.message);
      const { error: insertError } = await supabaseAdmin.from('notifications').insert({
        user_id: tx.seller_id,
        type: 'payment_successful',
        title: 'Payment Received! 💰',
        message,
        related_id: tx.id,
        related_type: 'escrow_transaction',
        data: { buyerName, transactionId: tx.id },
      });
      if (insertError) throw insertError;
    } else if (notification && typeof notification === 'object') {
      shouldPush = (notification as any).should_push ?? true;
    }
    if (shouldPush) {
      const { error: pushError } = await supabaseAdmin.functions.invoke('send-push-notification', {
        body: {
          userId: tx.seller_id,
          payload: {
            title: 'Payment Received! 💰',
            body: message,
            data: { buyerName, transactionId: tx.id },
            url: `/transactions/${tx.id}`,
          },
          type: 'payment_successful',
        },
      });
      if (pushError) console.error(`[PaylukWebhook] Push notification failed for tx ${tx.id}:`, pushError.message);
    }
  } catch (notifErr) {
    console.error(`[PaylukWebhook] Error sending seller notification for tx ${tx.id}:`, notifErr);
  }
}

async function handleEscrowCompleted(data: PaylukEscrowData) {
  let { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    if (error) throw error;
    await flagPayment('payluk',data.id,null,'unknown_completion');
    return;
  }

  // Idempotent: if already COMPLETED, skip.
  if (tx.status === EscrowStatus.COMPLETED) {
    console.log(`[PaylukWebhook] escrow.completed: tx ${tx.id} already COMPLETED, skipping`);
    return;
  }

  const { data: transitioned, error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .in('status', [...ESCROW_ALLOWED_FROM.completed]).select('id');

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.completed: failed to update tx ${tx.id}:`, updateError.message);
    throw updateError;
  } else {
    console.log(`[PaylukWebhook] escrow.completed: tx ${tx.id} → COMPLETED`);
  }
  if (!transitioned?.length) { await flagPayment('payluk',data.id,tx.id,'invalid_transition'); return; }
  await tryMarketplacePayout(tx);
}

async function tryMarketplacePayout(tx: { id: string; seller_id: string; item_type: string | null }) {
  if (tx.item_type === 'ticket') return;
  try {
    await PayoutService.initiateAutoPayout(tx.id);
  } catch (error) {
    console.error(`[PaylukWebhook] Automatic payout needs attention for ${tx.id}:`, error);
    const { data: payout } = await supabaseAdmin.from('payout_requests')
      .select('id').eq('transaction_id', tx.id).maybeSingle();
    if (payout) return;
    const notification = {
      user_id: tx.seller_id,
      type: 'payout_failed',
      title: 'Payout needs attention',
      message: 'Your escrow was released, but the bank payout needs attention. Check your payout settings or contact support.',
      related_id: tx.id,
      related_type: 'escrow_transaction',
      data: { transactionId: tx.id },
    };
    const { error: notificationError } = await supabaseAdmin.from('notifications').insert(notification);
    if (notificationError) throw notificationError;
    await sendPushNotification(supabaseAdmin, tx.seller_id, {
      title: notification.title,
      body: notification.message,
      data: notification.data,
      url: `/transactions/${tx.id}`,
    }, notification.type);
  }
}

async function handleEscrowClaimed(data: PaylukEscrowData) {
  // Seller claimed funds directly via Payluk — our backend was not the initiator.
  // This webhook is the only source of truth for this transition.
  let { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    if (error) throw error;
    await flagPayment('payluk',data.id,null,'unknown_claim');
    return;
  }

  if (tx.status === EscrowStatus.COMPLETED) {
    console.log(`[PaylukWebhook] escrow.claimed: tx ${tx.id} already COMPLETED, skipping`);
    return;
  }

  const { data: transitioned, error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .in('status', [...ESCROW_ALLOWED_FROM.completed]).select('id');

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.claimed: failed to update tx ${tx.id}:`, updateError.message);
    throw updateError;
  }

  console.log(`[PaylukWebhook] escrow.claimed: tx ${tx.id} → COMPLETED (seller-initiated claim)`);
  if (!transitioned?.length) { await flagPayment('payluk',data.id,tx.id,'invalid_transition'); return; }
  await tryMarketplacePayout(tx);

  // Notify the seller that their funds have been released.
  try {
    await supabaseAdmin.rpc('create_notification', {
      p_user_id: tx.seller_id,
      p_type: 'payment_successful',
      p_title: 'Funds Released 💸',
      p_message: `Your funds for escrow ${data.id} have been released to your wallet.`,
      p_sender_id: null,
      p_related_id: tx.id,
      p_related_type: 'escrow_transaction',
      p_data: { paylukEscrowId: data.id, transactionId: tx.id },
    });
  } catch (notifErr) {
    // Non-fatal — log but don't surface
    console.error(`[PaylukWebhook] escrow.claimed: failed to notify seller ${tx.seller_id}:`, notifErr);
  }
}

async function handleEscrowDisputed(data: PaylukEscrowData) {
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    if (error) throw error;
    await flagPayment('payluk',data.id,null,'unknown_dispute');
    return;
  }

  // Update the transaction status to DISPUTED.
  const { data: transitioned, error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.DISPUTED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id).in('status', [...ESCROW_ALLOWED_FROM.disputed]).select('id');

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.disputed: failed to update tx ${tx.id}:`, updateError.message);
    throw updateError;
  } else {
    console.log(`[PaylukWebhook] escrow.disputed: tx ${tx.id} → DISPUTED`);
  }

  if (!transitioned?.length) { await flagPayment('payluk',data.id,tx.id,'invalid_transition'); return; }
  // Fetch item title for the notification message.
  let itemTitle = 'an item';
  try {
    if (tx.item_id) {
      const table = tx.item_type === 'catalog_item' ? 'catalog_items' : 'posts';
      const { data: itemRow } = await supabaseAdmin
        .from(table)
        .select('title')
        .eq('id', tx.item_id)
        .maybeSingle();
      if (itemRow?.title) itemTitle = itemRow.title;
    }
  } catch {
    // Non-fatal — use fallback title
  }

  // Notify buyer and seller using the existing NotificationService method.
  // disputeId uses the Payluk escrow ID since we don't have a separate local dispute record.
  const disputeId = data.id;
  const openedByName = 'A party'; // Payluk doesn't tell us who opened it in this payload

  const notifyUsers = [tx.buyer_id, tx.seller_id].filter(Boolean) as string[];
  await Promise.allSettled(
    notifyUsers.map((userId) =>
      NotificationService.createDisputeOpenedNotification(
        userId,
        openedByName,
        itemTitle,
        disputeId,
        tx.id
      ).catch((err) =>
        console.error(`[PaylukWebhook] escrow.disputed: failed to notify ${userId}:`, err)
      )
    )
  );
}

async function handleEscrowRefunded(data: PaylukEscrowData) {
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    if (error) throw error;
    await flagPayment('payluk',data.id,null,'unknown_refund');
    return;
  }

  const { data: applied, error: refundError } = await supabaseAdmin.rpc('apply_escrow_refund', {
    p_transaction_id: tx.id, p_provider_reference: data.id, p_refund_amount: Number(data.amount ?? tx.amount),
  });
  if (refundError) {
    await flagPayment('payluk', data.id, tx.id, 'refund_database_error');
    throw refundError;
  }
  if (!applied) return;

  // 3. Notify buyer
  try {
    if (tx.buyer_id) {
      await supabaseAdmin.rpc('create_notification', {
        p_user_id: tx.buyer_id,
        p_type: 'payment_refunded',
        p_title: 'Payment Refunded 💸',
        p_message: 'Your payment was refunded/reversed by Payluk.',
        p_sender_id: null,
        p_related_id: tx.id,
        p_related_type: 'escrow_transaction',
        p_data: { transactionId: tx.id },
      });
    }
  } catch (notifErr) {
    console.error(`[PaylukWebhook] Error sending refund notifications for tx ${tx.id}:`, notifErr);
  }
}
