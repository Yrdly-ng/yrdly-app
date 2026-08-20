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

      // ── escrow.ongoing ───────────────────────────────────────────────────
      // Fires when buyer funds the escrow. Our /api/payluk/pay-escrow route
      // already handles this transition synchronously (updates to PAID on
      // success). Receiving this webhook is redundant — ack without action.
      case 'escrow.ongoing': {
        console.log(`[PaylukWebhook] escrow.ongoing for ${data.id} — already handled synchronously via pay-escrow route, skipping`);
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

async function handleEscrowCompleted(data: PaylukEscrowData) {
  // Look up by payluk_tx_ref — same discipline as /api/payluk/pay-escrow.
  const { data: tx, error } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status, buyer_id, seller_id, item_id, item_type')
    .eq('payluk_tx_ref', data.id)
    .maybeSingle();

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.completed: no local transaction for payluk_tx_ref=${data.id}`);
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
  const { data: tx, error } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status, buyer_id, seller_id, item_id, item_type')
    .eq('payluk_tx_ref', data.id)
    .maybeSingle();

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.claimed: no local transaction for payluk_tx_ref=${data.id}`);
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
  const { data: tx, error } = await supabaseAdmin
    .from('escrow_transactions')
    .select('id, status, buyer_id, seller_id, item_id, item_type')
    .eq('payluk_tx_ref', data.id)
    .maybeSingle();

  if (error || !tx) {
    console.warn(`[PaylukWebhook] escrow.disputed: no local transaction for payluk_tx_ref=${data.id}`);
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
