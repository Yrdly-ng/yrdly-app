import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { EscrowStatus } from '@/types/escrow';
import { NotificationService } from '@/lib/notification-service';

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

function verifySignature(rawBody: Buffer, receivedSig: string | null): boolean {
  if (!PAYLUK_SECRET_KEY || !receivedSig) return false;
  const expected = crypto
    .createHmac('sha512', PAYLUK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig));
  } catch {
    // Buffer lengths differ → signature is definitely wrong
    return false;
  }
}

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

  if (!verifySignature(rawBody, receivedSig)) {
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

  // Always ack quickly — heavy work below, but never let Payluk retry on our logic errors.
  // We handle each event in-place (fast DB writes) so returning after processing is fine.

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
      // mark item as sold (posts / catalog_items) and notify seller.
      case 'escrow.ongoing':
      case 'payment.escrow.success': {
        await handleEscrowOngoing(data);
        break;
      }

      // ── All other events: log and ack ────────────────────────────────────
      // escrow.created, escrow.pending, escrow.investigating,
      // escrow.refunded, escrow.split — none require local state changes now.
      // Logging them preserves observability without blocking.
      default: {
        console.log(`[PaylukWebhook] Unhandled event type: ${event} for escrow ${data?.id} — acknowledged without action`);
        break;
      }
    }
  } catch (err) {
    // Log the error but still return 200 — we must not trigger Payluk retries
    // for errors that are our own logic failures rather than delivery failures.
    console.error(`[PaylukWebhook] Error processing event ${event}:`, err);
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function findTransactionByPaylukData(data: PaylukEscrowData) {
  const targetId = data.id;
  const token = data.paymentToken;

  const orClause = token
    ? `payluk_escrow_id.eq.${targetId},payluk_tx_ref.eq.${targetId},payluk_tx_ref.eq.${token},id.eq.${targetId}`
    : `payluk_escrow_id.eq.${targetId},payluk_tx_ref.eq.${targetId},id.eq.${targetId}`;

  return await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status, buyer_id, seller_id, item_id, item_type')
    .or(orClause)
    .maybeSingle();
}

async function handleEscrowOngoing(data: PaylukEscrowData) {
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.ongoing: no local transaction for escrow id=${data.id}`);
    return;
  }

  // Idempotent: if already PAID, SHIPPED, DELIVERED, or COMPLETED, skip.
  if (tx.status !== EscrowStatus.PENDING && tx.status !== ('creating_escrow' as any)) {
    console.log(`[PaylukWebhook] escrow.ongoing: tx ${tx.id} status is ${tx.status}, skipping`);
    return;
  }

  // 1. Mark transaction as PAID
  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.PAID,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id);

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.ongoing: failed to update tx ${tx.id}:`, updateError.message);
    return;
  }

  console.log(`[PaylukWebhook] escrow.ongoing: tx ${tx.id} → PAID`);

  // 2. Mark item as sold / update catalog stock
  if (tx.item_id) {
    if (tx.item_type === 'catalog_item') {
      try {
        const { data: catItem } = await supabaseAdmin
          .from('catalog_items')
          .select('id, quantity, in_stock')
          .eq('id', tx.item_id)
          .maybeSingle();

        if (catItem) {
          const currentQty = typeof catItem.quantity === 'number' ? catItem.quantity : 1;
          const newQty = Math.max(0, currentQty - 1);
          await supabaseAdmin
            .from('catalog_items')
            .update({
              quantity: newQty,
              in_stock: newQty > 0,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.item_id);
          console.log(`[PaylukWebhook] Decremented catalog_items stock for ${tx.item_id} (new qty: ${newQty})`);
        }
      } catch (catErr) {
        console.error(`[PaylukWebhook] Error updating catalog stock for ${tx.item_id}:`, catErr);
      }
    } else {
      const { error: saleError } = await supabaseAdmin
        .from('posts')
        .update({
          is_sold: true,
          sold_to_user_id: tx.buyer_id,
          sold_at: new Date().toISOString(),
          transaction_id: tx.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tx.item_id);

      if (saleError) {
        console.error(`[PaylukWebhook] Error marking post ${tx.item_id} as sold:`, saleError);
      } else {
        console.log(`[PaylukWebhook] Marked post ${tx.item_id} as sold to buyer ${tx.buyer_id}`);
      }
    }
  }

  // 3. Notify seller
  try {
    const { data: buyer } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', tx.buyer_id)
      .single();

    const buyerName = buyer?.name || 'A buyer';

    await supabaseAdmin.rpc('create_notification', {
      p_user_id: tx.seller_id,
      p_type: 'payment_successful',
      p_title: 'Payment Received! 💰',
      p_message: `${buyerName} has paid for your item. Arrange handover with the buyer.`,
      p_sender_id: null,
      p_related_id: tx.id,
      p_related_type: 'escrow_transaction',
      p_data: { buyerName, transactionId: tx.id },
    });
  } catch (notifErr) {
    console.error(`[PaylukWebhook] Error sending seller notification for tx ${tx.id}:`, notifErr);
  }
}

async function handleEscrowCompleted(data: PaylukEscrowData) {
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.completed: no local transaction for escrow id=${data.id}`);
    return;
  }

  // Idempotent: if already COMPLETED, skip.
  if (tx.status === EscrowStatus.COMPLETED) {
    console.log(`[PaylukWebhook] escrow.completed: tx ${tx.id} already COMPLETED, skipping`);
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .neq('status', EscrowStatus.COMPLETED); // optimistic-lock: skip if already done

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.completed: failed to update tx ${tx.id}:`, updateError.message);
  } else {
    console.log(`[PaylukWebhook] escrow.completed: tx ${tx.id} → COMPLETED`);
  }
}

async function handleEscrowClaimed(data: PaylukEscrowData) {
  // Seller claimed funds directly via Payluk — our backend was not the initiator.
  // This webhook is the only source of truth for this transition.
  const { data: tx, error } = await findTransactionByPaylukData(data);

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.claimed: no local transaction for escrow id=${data.id}`);
    return;
  }

  if (tx.status === EscrowStatus.COMPLETED) {
    console.log(`[PaylukWebhook] escrow.claimed: tx ${tx.id} already COMPLETED, skipping`);
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.COMPLETED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .neq('status', EscrowStatus.COMPLETED);

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.claimed: failed to update tx ${tx.id}:`, updateError.message);
    return;
  }

  console.log(`[PaylukWebhook] escrow.claimed: tx ${tx.id} → COMPLETED (seller-initiated claim)`);

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
    console.warn(`[PaylukWebhook] escrow.disputed: no local transaction for escrow id=${data.id}`);
    return;
  }

  // Update the transaction status to DISPUTED.
  const { error: updateError } = await supabaseAdmin
    .from('escrow_transactions')
    .update({
      status: EscrowStatus.DISPUTED,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tx.id);

  if (updateError) {
    console.error(`[PaylukWebhook] escrow.disputed: failed to update tx ${tx.id}:`, updateError.message);
    // Continue to notifications even if status update fails — do not swallow the event entirely.
  } else {
    console.log(`[PaylukWebhook] escrow.disputed: tx ${tx.id} → DISPUTED`);
  }

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
