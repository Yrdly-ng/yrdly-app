import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaystackService, PaystackRequestError, getPaystackEventMode, paystackKeyMode, paystackSandboxUserAllowed } from '@/lib/payments/paystack-service';
import { paymentReferenceFilter } from '@/lib/payments/payment-state';
import { flagPayment } from '@/lib/payments/payment-reconciliation';
import { TicketCheckoutError, type TicketCheckoutInput } from './ticket-checkout';
import { ResendEmailService } from '@/lib/email/resend-service';
import { sendPushNotification } from '@/lib/notifications/server-push-notification';
import { reconcilePaystackFinancialWebhook } from './paystack-event-finance';

async function loadOrder(reference: string, expectedBuyerId?: string) {
  const { data: tx, error } = await supabaseAdmin.from('escrow_transactions').select('*')
    .eq('item_type', 'ticket').eq('payment_provider', 'paystack')
    .or(paymentReferenceFilter(reference, ['id', 'payment_reference'])).maybeSingle();
  if (error) throw error;
  if (!tx || (expectedBuyerId && tx.buyer_id !== expectedBuyerId)) throw new TicketCheckoutError('Checkout not found', 404);
  const { data: order, error: orderError } = await supabaseAdmin.from('paystack_ticket_orders').select('*')
    .eq('transaction_id', tx.id).single();
  if (orderError) throw orderError;
  if (order.domain !== paystackKeyMode() || (order.domain === 'test' && getPaystackEventMode() !== 'test')) {
    throw new TicketCheckoutError('This checkout belongs to a different payment environment.', 409);
  }
  if (order.domain === 'test' && (!paystackSandboxUserAllowed(tx.buyer_id) || !paystackSandboxUserAllowed(tx.seller_id))) {
    throw new TicketCheckoutError('This sandbox checkout is restricted to approved testers.', 403);
  }
  return { tx, order };
}

export async function createPaystackTicketCheckout(input: TicketCheckoutInput, callbackUrl: string) {
  const domain = getPaystackEventMode();
  if (!domain) throw new TicketCheckoutError('Paystack ticket checkout is not enabled.', 503);
  if (domain === 'test') {
    const event = await supabaseAdmin.from('events').select('organizer_id').eq('id', input.event_id).single();
    if (event.error || !event.data || !paystackSandboxUserAllowed(input.buyer_id) || !paystackSandboxUserAllowed(event.data.organizer_id)) {
      throw new TicketCheckoutError('Sandbox ticket payments are restricted to approved testers.', 403);
    }
  }
  const callback = new URL(callbackUrl);
  const app = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng');
  if (callback.origin !== app.origin || (callback.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callback.hostname))) {
    throw new TicketCheckoutError('Payment return address is not configured.', 503);
  }
  const { data: result, error } = await supabaseAdmin.rpc('reserve_paystack_ticket_checkout', { p_payload: input, p_domain: domain });
  if (error || !result?.transaction) throw new TicketCheckoutError(error?.message || 'Could not reserve tickets.');
  const { tx, order } = await loadOrder(result.transaction.id, input.buyer_id);
  const response = (authorizationUrl: string) => ({
    success: true as const, provider: 'paystack' as const, transactionId: tx.id,
    tx_ref: tx.payment_reference, authorizationUrl, totalAmount: Number(tx.total_amount), sandbox: domain === 'test',
  });
  if (order.state === 'paid') {
    const ticket = await verifyPaystackTicketCheckout(tx.id, input.buyer_id);
    return { success: true as const, provider: 'paystack' as const, alreadyPaid: true as const, ticket_id: ticket.id, tx_ref: tx.payment_reference };
  }
  if (order.state === 'pending' && order.authorization_url) return response(order.authorization_url);
  if (order.state !== 'reserved') throw new TicketCheckoutError('Payment setup is still being checked. Please retry shortly.');
  const { data: claimed, error: claimError } = await supabaseAdmin.from('paystack_ticket_orders')
    .update({ state: 'initializing', updated_at: new Date().toISOString() }).eq('transaction_id', tx.id).eq('state', 'reserved').select('transaction_id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new TicketCheckoutError('Checkout is already being prepared. Please retry shortly.');
  try {
    const initialized = await PaystackService.initializeTransaction({
      email: input.attendee_email, amountKobo: Math.round(Number(tx.total_amount) * 100), reference: tx.payment_reference,
      callbackUrl: callback.toString(), metadata: { yrdly_transaction_id: tx.id, event_id: input.event_id, buyer_id: input.buyer_id },
    });
    const checkout = new URL(initialized.authorization_url);
    if (initialized.reference !== tx.payment_reference || checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.paystack.com' || checkout.username || checkout.password) {
      throw new Error('Unexpected provider checkout response');
    }
    const { data: saved, error: saveError } = await supabaseAdmin.from('paystack_ticket_orders').update({
      state: 'pending', authorization_url: checkout.toString(), access_code: initialized.access_code, updated_at: new Date().toISOString(),
    }).eq('transaction_id', tx.id).eq('state', 'initializing').select('transaction_id').maybeSingle();
    if (saveError || !saved) throw new Error('Checkout changed while payment was being prepared');
    return response(checkout.toString());
  } catch (failure) {
    if (failure instanceof PaystackRequestError && !failure.uncertain && failure.rejection === 'invalid_attendee_email') {
      // This RPC locks the order and releases its seats atomically; a paid or
      // concurrently fulfilled order cannot be closed or made retryable here.
      const { error: closeError } = await supabaseAdmin.rpc('close_paystack_ticket_checkout', { p_transaction_id: tx.id });
      if (!closeError) throw new TicketCheckoutError('Use a valid attendee email address', 400);
    }
    // Never initialize a new reference after an uncertain provider response.
    await flagPayment('paystack', tx.payment_reference, tx.id, 'ticket_initialization_requires_reconciliation');
    throw new TicketCheckoutError('Payment setup is being checked. No replacement payment was started.', 502);
  }
}

export async function verifyPaystackTicketCheckout(reference: string, expectedBuyerId?: string) {
  const { tx, order } = await loadOrder(reference, expectedBuyerId);
  const verified = await PaystackService.verifyTransaction(tx.payment_reference);
  if (verified.status !== 'success') throw new TicketCheckoutError('Payment has not been confirmed yet.');
  if (verified.reference !== tx.payment_reference || verified.domain !== order.domain || verified.currency !== 'NGN' ||
      !Number.isSafeInteger(verified.amount) || verified.amount !== Math.round(Number(tx.total_amount) * 100) ||
      !Number.isSafeInteger(verified.fees) || Number(verified.fees) < 0 ||
      !verified.paid_at || !Number.isFinite(Date.parse(verified.paid_at)) ||
      verified.metadata?.yrdly_transaction_id !== tx.id ||
      (typeof verified.id === 'number' && !Number.isSafeInteger(verified.id))) {
    await flagPayment('paystack', tx.payment_reference, tx.id, 'ticket_verification_mismatch');
    throw new TicketCheckoutError('This payment needs review. Your tickets have not been issued.');
  }
  const quantity = Number(tx.metadata?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) throw new TicketCheckoutError('Order quantity needs review.');
  const tickets = Array.from({ length: quantity }, (_, index) => {
    const code = `YRD-${randomBytes(18).toString('hex').toUpperCase()}`;
    return { index, ticket_code: code, qr_data: JSON.stringify({ ticket_code: code, event_id: tx.metadata.event_id, tier_id: tx.item_id, tx_ref: tx.id }) };
  });
  const { data: issued, error } = await supabaseAdmin.rpc('fulfill_paystack_ticket_checkout', {
    p_transaction_id: tx.id, p_verified: verified, p_tickets: tickets,
  });
  if (error) {
    await flagPayment('paystack', tx.payment_reference, tx.id, 'ticket_fulfillment_requires_reconciliation');
    throw new TicketCheckoutError('Your payment is being reconciled. Please check your tickets shortly.', 502);
  }
  if (issued?.refund_required) throw new TicketCheckoutError('Payment arrived after this reservation closed. A refund review has been recorded; please contact support.');
  if (!issued?.tickets?.[0]) throw new TicketCheckoutError('Ticket issuance needs review.', 502);
  // Delivery failures must never reverse a paid order. The durable outbox is
  // retried by the reconciliation endpoint; the in-app notice already exists.
  after(async () => {
    try { await deliverPaystackTickets(tx.id); } catch { /* The outbox retries delivery. */ }
  });
  return { ...issued.tickets[0], quantity, transaction_id: tx.id };
}

export async function cancelPaystackTicketCheckout(reference: string, expectedBuyerId?: string) {
  const { tx, order } = await loadOrder(reference, expectedBuyerId);
  if (order.state === 'closed') return;
  if (['paid', 'refund_required'].includes(order.state)) throw new TicketCheckoutError('This order has been paid. Please use the refund process.');
  // Closing only frees local seats. A later successful provider payment is
  // retained as refund_required by the atomic fulfillment function.
  const { error } = await supabaseAdmin.rpc('close_paystack_ticket_checkout', { p_transaction_id: tx.id });
  if (error) throw new TicketCheckoutError('Checkout changed. Please check the payment status before trying again.');
}

/** Signed payloads are saved before processing; failures remain retryable. */
export async function acceptPaystackEventWebhook(raw: string) {
  const payload = JSON.parse(raw);
  if (!payload || typeof payload.event !== 'string' || !payload.data || typeof payload.data !== 'object') throw new Error('Invalid webhook');
  const digest = createHash('sha256').update(raw).digest('hex');
  const { error } = await supabaseAdmin.from('paystack_event_webhooks').upsert({ digest, event_type: payload.event, payload }, { onConflict: 'digest', ignoreDuplicates: true });
  if (error) throw error;
  await processPaystackEventWebhook(digest);
}

export async function processPaystackEventWebhook(digest: string) {
  const { data: receipt, error } = await supabaseAdmin.from('paystack_event_webhooks').select('*').eq('digest', digest).single();
  if (error) throw error;
  if (receipt.processed_at) return;
  const { event, data } = receipt.payload;
  try {
    if (event === 'charge.success') {
      const reference = typeof data.reference === 'string' ? data.reference : '';
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(reference)) throw new Error('Invalid reference');
      const { data: tx, error: lookupError } = await supabaseAdmin.from('escrow_transactions').select('id').eq('payment_provider', 'paystack')
        .eq('item_type', 'ticket').eq('payment_reference', reference).maybeSingle();
      if (lookupError) throw lookupError;
      if (tx) {
        try { await verifyPaystackTicketCheckout(tx.id); }
        catch (failure) {
          const { data: order, error: orderError } = await supabaseAdmin.from('paystack_ticket_orders').select('state').eq('transaction_id', tx.id).single();
          if (orderError || order?.state !== 'refund_required') throw failure;
        }
      }
    } else if (/^(transfer\.|refund\.|charge\.dispute\.)/.test(event)) {
      await reconcilePaystackFinancialWebhook(event, data);
    }
    const { error: saveError } = await supabaseAdmin.from('paystack_event_webhooks').update({ processed_at: new Date().toISOString(), last_error: null }).eq('digest', digest);
    if (saveError) throw saveError;
  } catch (failure) {
    await supabaseAdmin.from('paystack_event_webhooks').update({ last_error: 'Processing requires retry or review', retry_at: new Date(Date.now() + 600_000).toISOString() }).eq('digest', digest);
    throw failure;
  }
}

/** Bounded service operation; never starts refunds or bank transfers. */
export async function reconcilePaystackTicketOrders() {
  const { data: webhooks, error } = await supabaseAdmin.from('paystack_event_webhooks').select('digest').is('processed_at', null).lte('retry_at', new Date().toISOString()).order('retry_at').limit(10);
  if (error) throw error;
  let processed = 0;
  for (const row of webhooks || []) {
    try { await processPaystackEventWebhook(row.digest); processed++; } catch { /* Persisted receipt remains pending. */ }
  }
  const { data: orders, error: orderError } = await supabaseAdmin.from('paystack_ticket_orders').select('transaction_id,state')
    .in('state', ['initializing', 'pending', 'closed']).order('updated_at').limit(10);
  if (orderError) throw orderError;
  for (const order of orders || []) {
    try { await verifyPaystackTicketCheckout(order.transaction_id); } catch { /* Unpaid and mismatched payments do not issue tickets. */ }
    const { data: reservation, error: reservationError } = await supabaseAdmin.from('ticket_checkout_reservations').select('expires_at,remaining').eq('transaction_id', order.transaction_id).single();
    if (reservationError) throw reservationError;
    if (reservation.remaining > 0 && Date.parse(reservation.expires_at) <= Date.now()) {
      try { await cancelPaystackTicketCheckout(order.transaction_id); } catch { /* A concurrent successful payment keeps its tickets. */ }
    }
    const { error: touched } = await supabaseAdmin.from('paystack_ticket_orders').update({ updated_at: new Date().toISOString() }).eq('transaction_id', order.transaction_id);
    if (touched) throw touched;
  }
  const { data: deliveries, error: deliveryError } = await supabaseAdmin.from('paystack_ticket_delivery').select('transaction_id').is('delivered_at', null).lte('retry_at', new Date().toISOString()).order('retry_at').limit(5);
  if (deliveryError) throw deliveryError;
  for (const row of deliveries || []) {
    try { await deliverPaystackTickets(row.transaction_id); } catch { /* Durable outbox remains pending. */ }
  }
  return { processed, checkedOrders: orders?.length || 0, checkedDeliveries: deliveries?.length || 0 };
}

export async function deliverPaystackTickets(transactionId: string) {
  const now = new Date().toISOString();
  const { data: claim, error: claimError } = await supabaseAdmin.from('paystack_ticket_delivery')
    .update({ locked_until: new Date(Date.now() + 120_000).toISOString(), retry_at: new Date(Date.now() + 600_000).toISOString() }).eq('transaction_id', transactionId)
    .is('delivered_at', null).or(`locked_until.is.null,locked_until.lt.${now}`).select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return;
  const { tx, order } = await loadOrder(transactionId);
  const [{ data: tickets, error: ticketsError }, { data: event, error: eventError }, { data: tier, error: tierError }] = await Promise.all([
    supabaseAdmin.from('tickets').select('id,ticket_code,qr_data').eq('payment_tx_ref', tx.id).order('purchase_ticket_index'),
    supabaseAdmin.from('events').select('id,title,start_time,location_address,state,organizer_id').eq('id', tx.metadata.event_id).single(),
    supabaseAdmin.from('ticket_tiers').select('name').eq('id', tx.item_id).single(),
  ]);
  if (ticketsError || eventError || tierError || !tickets?.length || !event || !tier) throw new Error('Delivery details unavailable');
  if (order.domain === 'test') event.title = `[Sandbox · no real payment] ${event.title}`;
  await sendPushNotification(supabaseAdmin, event.organizer_id, { title: 'Tickets sold', body: `${tx.metadata.attendee_name} bought ${tickets.length} ticket(s) for ${event.title}.`,
    data: { type: 'ticket_purchase', audience: 'organizer', eventId: event.id, ticketId: tickets[0].id, notificationId: claim.organizer_notification_id, deliveryKey: `paystack-ticket-sale:${tx.id}` } }, 'ticket_purchase');
  if (!ResendEmailService.isConfigured()) throw new Error('Ticket email is not configured');
  const start = new Date(event.start_time);
  for (const ticket of tickets) {
    const qr = await QRCode.toDataURL(ticket.qr_data, { width: 300, margin: 2 });
    await ResendEmailService.sendTicketConfirmationEmail(tx.metadata.attendee_name || 'Attendee', tx.metadata.attendee_email, event.title, tier.name, ticket.id, qr,
      start.toLocaleDateString('en-NG'), start.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }), event.location_address || event.state || 'See event details', ticket.ticket_code,
      `paystack-ticket:${ticket.id}`);
  }
  const { data: organizer, error: organizerError } = await supabaseAdmin.from('users').select('email,name').eq('id', event.organizer_id).single();
  if (organizerError) throw organizerError;
  if (organizer?.email) await ResendEmailService.sendTicketSaleNotificationEmail(organizer.email, organizer.name || 'Organiser', event.title,
    tx.metadata.attendee_name, tx.metadata.attendee_email, tier.name, Number(tx.total_amount), tickets[0].id, event.id,
    undefined, undefined, undefined, `paystack-ticket-sale:${tx.id}`);
  const { error: deliveryError } = await supabaseAdmin.from('paystack_ticket_delivery').update({ delivered_at: new Date().toISOString(), locked_until: null, attempts: claim.attempts + 1 }).eq('transaction_id', transactionId);
  if (deliveryError) throw deliveryError;
}
