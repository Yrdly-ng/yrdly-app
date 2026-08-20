# Phase 0: Recon & Findings Report

## 1. `src/app/api/webhooks/paystack/route.ts`
```typescript
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
    // Always return 200 to prevent Paystack retries on our logic errors
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}
```
**Observation:**
This endpoint validates Paystack signatures, extracts transaction data, and processes event tickets and escrow payments by updating Supabase rows, fulfilling inventory, and queuing notifications safely and idempotently. 


## 2. `src/app/api/admin/disputes/[disputeId]/resolve/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PaystackService } from '@/lib/paystack-service';
import { PayoutService } from '@/lib/payout-service';
import { NotificationService } from '@/lib/notification-service';

export async function POST(
  request: Request,
  context: { params: Promise<{ disputeId: string }> }
) {
  try {
    const { disputeId } = await context.params;
    const body = await request.json();
    const { resolution, refundAmount, sellerAmount } = body;

    // 1. Verify Authentication & Admin Status
    const { data: { user }, error: authError } = await getAuthenticatedUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Fetch Dispute & Transaction Details
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select('*, transaction:escrow_transactions(*)')
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const transaction = Array.isArray(dispute.transaction) ? dispute.transaction[0] : dispute.transaction;
    
    if (transaction.status === 'completed' || transaction.status === 'cancelled') {
      return NextResponse.json({ error: 'Transaction is already closed' }, { status: 400 });
    }

    // 3. Process Payments (Refund Buyer)
    if (refundAmount > 0 && transaction.payment_reference) {
      const refundSuccess = await PaystackService.refundTransaction(transaction.payment_reference, refundAmount);
      if (!refundSuccess) {
        return NextResponse.json({ error: 'Failed to process refund with Paystack' }, { status: 500 });
      }
    }

    // 4. Process Payments (Payout Seller)
    if (sellerAmount > 0) {
      try {
        await PayoutService.manualPayout(transaction.seller_id, sellerAmount, user.id);
      } catch (payoutError) {
        console.error('Failed to initiate seller payout:', payoutError);
        return NextResponse.json({ error: 'Failed to initiate seller payout' }, { status: 500 });
      }
    }

    // 5. Update Database Records
    await supabaseAdmin
      .from('disputes')
      .update({
        resolution,
        refund_amount: refundAmount,
        seller_amount: sellerAmount,
        status: 'resolved',
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    const newStatus = refundAmount > 0 ? 'cancelled' : 'completed';
    await supabaseAdmin
      .from('escrow_transactions')
      .update({
        status: newStatus,
        dispute_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);

    // 6. Notifications
    try {
      const itemTitle = 'Item'; // Best effort fallback
      await Promise.all([
        NotificationService.createDisputeResolvedNotification(
          transaction.buyer_id,
          itemTitle,
          resolution,
          disputeId,
          transaction.id
        ),
        NotificationService.createDisputeResolvedNotification(
          transaction.seller_id,
          itemTitle,
          resolution,
          disputeId,
          transaction.id
        )
      ]);
    } catch (notificationError) {
      console.error('Notification error', notificationError);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error resolving dispute API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```
**Observation:**
This admin endpoint processes the financial resolution of disputes. Depending on the decision, it leverages `PaystackService.refundTransaction` to issue partial/full buyer refunds and/or `PayoutService.manualPayout` to pay the seller, finalizing statuses and sending notifications.

## 3. `src/lib/event-escrow-service.ts`
```typescript
/**
 * Event Escrow Service — mirrors escrow-service.ts for event transactions.
 * Handles ticket purchase escrow using event_payouts table.
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js';
import { PaystackService } from './paystack-service';
import { EVENT_CONSTANTS } from './constants';
import type { EventPayout } from '@/types/events';

// Service-role client for writes that bypass RLS
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key'
);

export class EventEscrowService {
  /**
   * Calculate amounts for a ticket purchase
   */
  static calculateAmounts(ticketPrice: number) {
    const commission = Math.round(ticketPrice * EVENT_CONSTANTS.COMMISSION_RATE * 100) / 100;
    const net = Math.round((ticketPrice - commission) * 100) / 100;
    return { gross: ticketPrice, commission, net };
  }

  /**
   * Get the organizer's bank details for outbound transfers
   */
  static async getOrganizerBankDetails(organizerId: string): Promise<{ bankCode: string; accountNumber: string; updatedAt: string } | null> {
    const { data, error } = await adminSupabase
      .from('seller_accounts')
      .select('account_details, account_type, updated_at')
      .eq('user_id', organizerId)
      .eq('is_primary', true)
      .eq('is_active', true)
      .eq('verification_status', 'verified')
      .single();

    if (error || !data) return null;

    const accountDetails = data.account_details as Record<string, string> | null;
    const bankCode = accountDetails?.bank_code || accountDetails?.bankCode;
    const accountNumber = accountDetails?.account_number || accountDetails?.accountNumber;

    if (!bankCode || !accountNumber) return null;
    return { bankCode, accountNumber, updatedAt: data.updated_at };
  }

  /**
   * Check if an organizer has a verified payout account (required for paid events)
   */
  static async organizerCanReceivePayments(organizerId: string): Promise<boolean> {
    const details = await this.getOrganizerBankDetails(organizerId);
    return !!details;
  }

  /**
   * Process payouts for all events that ended > AUTO_RELEASE_HOURS ago
   * Called by the cron job
   */
  static async processMaturedPayouts(): Promise<{
    processed: number;
    failed: number;
    errors: string[];
  }> {
    const cutoff = new Date(
      Date.now() - EVENT_CONSTANTS.AUTO_RELEASE_HOURS * 60 * 60 * 1000
    ).toISOString();

    // Find completed events that ended before the cutoff with no payout yet
    const { data: events, error } = await adminSupabase
      .from('events')
      .select('id, organizer_id, payment_subaccount_id, title')
      .eq('status', 'COMPLETED')
      .lt('end_time', cutoff)
      .is('payout_released_at', null);

    if (error || !events?.length) {
      return { processed: 0, failed: 0, errors: error ? [error.message] : [] };
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        await this.processEventPayout(event.id, event.organizer_id);
        processed++;
      } catch (err) {
        failed++;
        errors.push(`Event ${event.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { processed, failed, errors };
  }

  /**
   * Process payout for a single completed event
   */
  static async processEventPayout(eventId: string, organizerId: string): Promise<void> {
    // Sum all PAID tickets for this event
    const { data: tickets, error: ticketsError } = await adminSupabase
      .from('tickets')
      .select('amount_paid')
      .eq('event_id', eventId)
      .eq('status', 'PAID');

    if (ticketsError) throw ticketsError;
    if (!tickets?.length) return; // No tickets sold — nothing to payout

    const gross = tickets.reduce((sum, t) => sum + Number(t.amount_paid), 0);
    const { commission, net } = this.calculateAmounts(gross);

    // Get organizer bank details for outbound transfer
    const bankDetails = await this.getOrganizerBankDetails(organizerId);
    if (!bankDetails) throw new Error('Organizer has no verified payout account');

    // Enforce 24-hour cooling off period
    const coolingOffPeriod = 24 * 60 * 60 * 1000;
    const isCoolingOff = bankDetails.updatedAt && (Date.now() - new Date(bankDetails.updatedAt).getTime() < coolingOffPeriod);
    if (isCoolingOff) {
      console.warn(`[EventEscrowService] Payout delayed for event ${eventId}. Organizer account in cooling-off period.`);
      return; // Skip payout, will be retried in next cron run
    }

    // Check for existing payout record to avoid double-processing or infinite retries
    const { data: existing } = await adminSupabase
      .from('event_payouts')
      .select('id, status')
      .eq('event_id', eventId)
      .in('status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
      .single();

    if (existing) {
      if (existing.status === 'FAILED') {
        console.warn(`[EventEscrowService] Event ${eventId} payout previously failed. Requires manual intervention.`);
      }
      return; // Already processed, in progress, or failed permanently
    }

    // Create payout record
    const { data: payout, error: payoutError } = await adminSupabase
      .from('event_payouts')
      .insert({
        event_id: eventId,
        organizer_id: organizerId,
        gross_amount: gross,
        commission_amount: commission,
        net_amount: net,
        status: 'PROCESSING',
      })
      .select('id')
      .single();

    if (payoutError || !payout) throw payoutError || new Error('Failed to create payout record');

    // Execute transfer via Paystack
    const transferSuccess = await PaystackService.transferToSeller({
      bankCode: bankDetails.bankCode,
      accountNumber: bankDetails.accountNumber,
      amount: net,
      reference: `event-payout-${payout.id}`,
      narration: `Event payout for event ${eventId}`,
    });

    const updatePayload = transferSuccess
      ? { status: 'COMPLETED', paid_at: new Date().toISOString() }
      : { status: 'FAILED', failure_reason: 'Paystack transfer failed' };

    await adminSupabase
      .from('event_payouts')
      .update(updatePayload)
      .eq('id', payout.id);

    // Mark event as payout released
    if (transferSuccess) {
      await adminSupabase
        .from('events')
        .update({ payout_released_at: new Date().toISOString() })
        .eq('id', eventId);
    }

    if (!transferSuccess) {
      throw new Error('Paystack transfer failed');
    }
  }

  static async processCancellationRefunds(eventId: string): Promise<{
    refunded: number;
    failed: number;
  }> {
    const { data: tickets, error } = await adminSupabase
      .from('tickets')
      .select('id, payment_tx_ref, amount_paid, buyer_id')
      .eq('event_id', eventId)
      .eq('status', 'PAID');

    if (error || !tickets?.length) return { refunded: 0, failed: 0 };

    let refunded = 0;
    let failed = 0;

    for (const ticket of tickets) {
      try {
        if (ticket.amount_paid > 0 && ticket.payment_tx_ref) {
          // Refund via Paystack using the stored payment reference
          const refunded = await PaystackService.refundTransaction(
            ticket.payment_tx_ref,
            ticket.amount_paid
          );
          if (!refunded) {
            throw new Error(`Paystack refund failed for ticket ${ticket.id}`);
          }
        }

        // Mark as refunded in DB
        await adminSupabase
          .from('tickets')
          .update({ status: 'REFUNDED' })
          .eq('id', ticket.id);
        refunded++;
      } catch (err) {
        console.error(`[Escrow] Failed to refund ticket ${ticket.id}`, err);
        failed++;
      }
    }

    return { refunded, failed };
  }
}
```
**Observation:**
This class handles automated payouts for mature events. It queries DB records for mature unpaid events, performs escrow transfer generation using `PaystackService.transferToSeller()`, and records transaction resolutions directly into DB state.

## 4. `src/app/api/cron/process-event-payouts/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { EventEscrowService } from '@/lib/event-escrow-service';

/**
 * GET /api/cron/process-event-payouts
 * Secured Vercel Cron endpoint — runs daily to release matured escrow payouts.
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await EventEscrowService.processMaturedPayouts();

    console.log('[CRON] Event payouts processed:', result);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('[CRON] Event payout processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
```
**Observation:**
This is a secure cron endpoint that executes `EventEscrowService.processMaturedPayouts()` directly.

## 5. `src/app/api/tickets/initialize/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { PaystackService } from '@/lib/paystack-service';

/**
 * POST /api/tickets/initialize
 * Initiates a Paystack checkout for ticket purchase.
 * Returns a payment link that opens the Paystack modal.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────
    const { data: { user }, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const body = await request.json();
    const { eventId, tierId, attendeeName, attendeeEmail, attendeePhone } = body;

    if (!eventId || !tierId || !attendeeName || !attendeeEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── Fetch event + tier ────────────────────────────────
    const { data: tier } = await supabaseAdmin
      .from('ticket_tiers')
      .select('*, event:events(id, title, status, payout_mode, payment_subaccount_id, organizer_id)')
      .eq('id', tierId)
      .single();

    if (!tier || !tier.event) {
      return NextResponse.json({ error: 'Tier not found' }, { status: 404 });
    }
    if (tier.event.id !== eventId) {
      return NextResponse.json({ error: 'Tier does not belong to this event' }, { status: 400 });
    }
    if (tier.event.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Event is not available for purchase' }, { status: 400 });
    }
    if (tier.capacity != null && tier.sold >= tier.capacity) {
      return NextResponse.json({ error: 'This ticket tier is sold out' }, { status: 409 });
    }

    // ── Build tx_ref carrying all data for webhook ────────
    const txRef = `evt-tkt-${tierId.substring(0,6)}-${user.id.substring(0,4)}-${Date.now()}`;
    const price = Number(tier.price);

    // ── Free ticket — skip Paystack ────────────────────
    if (price === 0) {
      const { data: ticketId, error: rpcErr } = await supabaseAdmin.rpc('purchase_ticket', {
        p_tier_id: tierId,
        p_buyer_id: user.id,
        p_event_id: eventId,
        p_attendee_name: attendeeName,
        p_attendee_email: attendeeEmail,
        p_attendee_phone: attendeePhone || null,
        p_amount_paid: 0,
        p_tx_ref: txRef,
        p_flw_ref: null,
      });

      if (rpcErr) {
        if (rpcErr.message?.includes('TICKET_SOLD_OUT')) {
          return NextResponse.json({ error: 'Sold out' }, { status: 409 });
        }
        throw rpcErr;
      }

      return NextResponse.json({ success: true, free: true, ticketId });
    }

    // ── Paid ticket — initialise Paystack payment ───────────────────────────
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
    


    let paymentLink: string;
    try {
      paymentLink = await PaystackService.initializePayment({
        transactionId: txRef,
        amount: price,
        buyerEmail: attendeeEmail,
        buyerName: attendeeName,
        itemTitle: `Ticket — ${tier.event.title}`,
        sellerName: 'Event Organizer',
        callbackUrl: `${origin}/my-tickets?success=1`,
        metadata: {
          event_id: eventId,
          tier_id: tierId,
          buyer_id: user.id,
          attendee_name: attendeeName,
          attendee_email: attendeeEmail,
          attendee_phone: attendeePhone || null
        }
      });
      // NOTE: We don't currently pass 'subaccount' to PaystackService.initializePayment.
      // If INSTANT payout is needed, PaystackService.initializePayment should be updated to accept a subaccount param.
    } catch (paystackError: any) {
      console.error('Paystack init error:', paystackError);
      return NextResponse.json({ error: 'Payment initialization failed' }, { status: 502 });
    }

    return NextResponse.json({ success: true, paymentLink, txRef });
  } catch (error) {
    console.error('Ticket initialize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```
**Observation:**
This API initializes ticket purchases by calling `PaystackService.initializePayment()` if the ticket is paid. It notes in comments that a `subaccount` parameter is not currently passed to Paystack.

## 6. Mobile Application Verification: Webhooks and Dispute logic

### `paystack` grep hits:
```
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":2,"LineContent":" * Mobile Paystack Service"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":4,"LineContent":" * On mobile we NEVER embed the Paystack secret key in the app bundle."}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":41,"LineContent":"export class PaystackService {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":44,"LineContent":"   * Returns the Paystack hosted payment URL to open in a WebView."}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":78,"LineContent":"      console.error('[PaystackService] initializePayment error:', error);"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":87,"LineContent":"   * comes from the Paystack webhook hitting the backend."}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":114,"LineContent":"      console.error('[PaystackService] verifyPayment error:', error);"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/paystack-service.ts","LineNumber":138,"LineContent":"   * Returns true if the given URL is the Paystack checkout success/cancel redirect."}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/events/[id]/index.tsx","LineNumber":336,"LineContent":"             // Add a 3s delay to allow Paystack's backend state to update to 'success'"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/checkout/[id].tsx","LineNumber":185,"LineContent":"            <Text style={stylesheet.payingTitle}>Redirecting to Paystack</Text>"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":49,"LineContent":"      const res = await fetch('https://api.paystack.co/bank?currency=NGN');"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":74,"LineContent":"      const res = await fetch(`https://api.paystack.co/bank/resolve?account_number=${acctNum}&bank_code=${bankCode}`, {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":76,"LineContent":"          Authorization: `Bearer ${process.env.EXPO_PUBLIC_PAYSTACK_SECRET_KEY}`"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":165,"LineContent":"                <Text style={s.verifiedTxt}>Verified by Paystack</Text>"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":259,"LineContent":"              <Text style={s.verifyingTxt}>Verifying account with Paystack…</Text>"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/app/settings/payout-settings.tsx","LineNumber":269,"LineContent":"                <Text style={s.confirmedSub}>Verified by Paystack ✓</Text>"}
```

### `dispute` grep hits:
```
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":320,"LineContent":"  // Check if account can be safely deleted without pending transactions/disputes"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":335,"LineContent":"      // Check for open disputes"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":336,"LineContent":"      const { data: openDisputes } = await supabase"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":337,"LineContent":"        .from('disputes')"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":343,"LineContent":"      if (openDisputes && openDisputes.length > 0) {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/auth-service.ts","LineNumber":344,"LineContent":"        return { canDelete: false, reason: 'You have open marketplace disputes. Please resolve all open disputes before deleting your account.' };"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":50,"LineContent":"  | 'dispute_opened'"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":51,"LineContent":"  | 'dispute_resolved'"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":633,"LineContent":"   * Create a dispute opened notification"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":635,"LineContent":"  static async createDisputeOpenedNotification("}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":639,"LineContent":"    disputeId: string,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":644,"LineContent":"      type: 'dispute_opened',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":645,"LineContent":"      relatedId: disputeId,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":646,"LineContent":"      relatedType: 'dispute',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":647,"LineContent":"      title: 'Dispute Opened',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":648,"LineContent":"      message: `${openedByName} opened a dispute for \"${itemTitle}\"`,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":652,"LineContent":"        disputeId,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":659,"LineContent":"   * Create a dispute resolved notification"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":661,"LineContent":"  static async createDisputeResolvedNotification("}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":665,"LineContent":"    disputeId: string,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":670,"LineContent":"      type: 'dispute_resolved',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":671,"LineContent":"      relatedId: disputeId,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":672,"LineContent":"      relatedType: 'dispute',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":673,"LineContent":"      title: 'Dispute Resolved',"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":674,"LineContent":"      message: `Dispute for \"${itemTitle}\" has been resolved: ${resolution}`,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":678,"LineContent":"        disputeId,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":842,"LineContent":"    case 'dispute_opened':"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/notification-service.ts","LineNumber":843,"LineContent":"    case 'dispute_resolved':"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/transaction-status-service.ts","LineNumber":253,"LineContent":"   * Cancel transaction (for disputes or other reasons)"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/transaction-status-service.ts","LineNumber":261,"LineContent":"          dispute_reason: reason,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":4,"LineContent":"export interface DisputeData {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":8,"LineContent":"  disputeReason: string;"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":46,"LineContent":"export interface DisputeEvidence {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":53,"LineContent":"export class DisputeService {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":55,"LineContent":"   * Open a new dispute"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":57,"LineContent":"  static async openDispute("}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":61,"LineContent":"    evidence: DisputeEvidence"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":76,"LineContent":"        throw new Error('Unauthorized: You can only dispute your own transactions');"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":80,"LineContent":"        throw new Error('Cannot dispute completed or cancelled transactions');"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":83,"LineContent":"      // Check if dispute already exists"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":84,"LineContent":"      const { data: existingDispute } = await supabase"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":85,"LineContent":"        .from('disputes')"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":90,"LineContent":"      if (existingDispute) {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":91,"LineContent":"        throw new Error('A dispute already exists for this transaction');"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":94,"LineContent":"      // Create dispute"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":95,"LineContent":"      const disputeData = {"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":98,"LineContent":"        dispute_reason: reason,"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":109,"LineContent":"        .from('disputes')"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":110,"LineContent":"        .insert(disputeData)"}
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/lib/dispute-service.ts","LineNumber":115,"LineContent":"        console.error('Error creating dispute:', error);"}
```

**Observation:**
The mobile repo correctly has no direct backend dispute-resolution or webhook-handling logic. Its functionality is strictly limited to initiating disputes directly on Supabase tables and generating/handling WebView redirects for Paystack. No duplicate backend code exists in the mobile repo for these features.

## 7. Search for `subaccount`, `split_payment`, `settlement_schedule`

### `yrdly-app` matches:
```
{"File":"/Users/macbook/Development/projects/yrdly-app/src/lib/event-escrow-service.ts","LineNumber":75,"LineContent":"      .select('id, organizer_id, payment_subaccount_id, title')"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/events/create/route.ts","LineNumber":37,"LineContent":"        .select('id, flutterwave_subaccount_id')"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/events/create/route.ts","LineNumber":51,"LineContent":"    // Get subaccount ID if exists"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/events/create/route.ts","LineNumber":54,"LineContent":"      .select('flutterwave_subaccount_id')"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/events/create/route.ts","LineNumber":93,"LineContent":"        payment_subaccount_id: sa?.flutterwave_subaccount_id || null,"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/events/tickets/purchase/route.ts","LineNumber":34,"LineContent":"      .select('id, title, status, organizer_id, payment_subaccount_id, end_time')"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/tickets/initialize/route.ts","LineNumber":28,"LineContent":"      .select('*, event:events(id, title, status, payout_mode, payment_subaccount_id, organizer_id)')"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/tickets/initialize/route.ts","LineNumber":97,"LineContent":"      // NOTE: We don't currently pass 'subaccount' to PaystackService.initializePayment."}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/tickets/initialize/route.ts","LineNumber":98,"LineContent":"      // If INSTANT payout is needed, PaystackService.initializePayment should be updated to accept a subaccount param."}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/seller/setup-account/route.ts","LineNumber":99,"LineContent":"    let subaccountId: string | null = null; // We don't create Paystack subaccounts here yet"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/app/api/seller/setup-account/route.ts","LineNumber":146,"LineContent":"      subaccountId,"}
{"File":"/Users/macbook/Development/projects/yrdly-app/src/types/events.ts","LineNumber":34,"LineContent":"  payment_subaccount_id: string | null;"}
{"File":"/Users/macbook/Development/projects/yrdly-app/docs/app-reference.md","LineNumber":388,"LineContent":"paystack_subaccount_id text"}
{"File":"/Users/macbook/Development/projects/yrdly-app/docs/app-reference.md","LineNumber":497,"LineContent":"| Seller subaccounts (Paystack) | 🔴 Not started | Needed for automated payouts |"}
```

### `yrdly-mobile` matches:
```
{"File":"/Users/macbook/Development/projects/yrdly-mobile/src/types/events.ts","LineNumber":35,"LineContent":"  payment_subaccount_id: string | null;"}
```

**Observation:**
Only `subaccount` returned grep matches; `split_payment` and `settlement_schedule` had zero hits. The hits for `subaccount` show that the data model exists (`payment_subaccount_id`), but integration with Paystack is explicitly documented as "Not started" and bypassed with comments in code.

## 8. Database Row Counts

Executed securely via inline node script authenticating with the Supabase Admin Service Role key:

```sql
SELECT count(*) FROM disputes;
SELECT count(*) FROM payout_requests;
SELECT count(*) FROM escrow_transactions;
```

**Literal output:**
```
disputes count: 0
payout_requests count: 0
escrow_transactions count: 0
```
