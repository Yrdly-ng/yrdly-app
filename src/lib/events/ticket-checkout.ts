import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from '@/lib/payments/payluk-service';
import { getPaylukCustomerId } from '@/lib/payments/payluk-onboarding';
import { TicketService } from '@/lib/events/ticket-service';
import { getPaystackEventMode } from '@/lib/payments/paystack-service';
import { createPaystackTicketCheckout, cancelPaystackTicketCheckout, verifyPaystackTicketCheckout } from '@/lib/events/paystack-ticket-service';
import { flagPayment } from '@/lib/payments/payment-reconciliation';
import { paylukAmountsMatch, paylukEscrowPrincipal } from '../payments/payment-state';

export class TicketCheckoutError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export interface TicketCheckoutInput {
  event_id: string;
  tier_id: string;
  buyer_id: string;
  quantity: number;
  attendee_name: string;
  attendee_email: string;
  attendee_phone: string | null;
}

/** The caller is authenticated before invoking this service-only operation. */
export async function cancelTicketCheckout(transactionId: string, expectedBuyerId?: string) {
  const { data: tx, error } = await supabaseAdmin.from('escrow_transactions').select('*')
    .eq('id', transactionId).eq('item_type', 'ticket').maybeSingle();
  if (error) throw error;
  if (!tx || (expectedBuyerId && tx.buyer_id !== expectedBuyerId)) throw new TicketCheckoutError('Checkout not found', 404);
  if (tx.payment_provider === 'paystack') return cancelPaystackTicketCheckout(tx.id, expectedBuyerId);
  if (tx.payment_provider !== 'payluk') throw new TicketCheckoutError('Unsupported checkout provider.');
  if (tx.status === 'cancelled') return;
  if (tx.status !== 'pending') throw new TicketCheckoutError('Payment is processing or needs review; the reservation is still held.');
  if (!tx.payluk_escrow_id && !tx.payluk_tx_ref) {
    const { error: releaseError } = await supabaseAdmin.rpc('release_ticket_checkout', { p_transaction_id: tx.id });
    if (releaseError) throw new TicketCheckoutError('Checkout setup is in progress; retry shortly.');
    return;
  }
  if (!tx.payluk_escrow_id || !tx.payluk_tx_ref) throw new TicketCheckoutError('Checkout needs reconciliation.');
  const { data: claimed, error: claimError } = await supabaseAdmin.from('escrow_transactions')
    .update({ status: 'reconciling', updated_at: new Date().toISOString() })
    .eq('id', tx.id).eq('status', 'pending').select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new TicketCheckoutError('Checkout changed; retry shortly.');
  let deletionSubmitted = false;
  try {
    const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (['ONGOING','COMPLETED','CLAIMED'].includes(remote.status)) {
      await TicketService.verifyAndProcessTicket(tx.id, tx.buyer_id);
      throw new TicketCheckoutError('This order has been paid; use support for a refund.');
    }
    if (remote.state !== 'AWAITING_PAYMENT' || remote.status !== 'PENDING' || !paylukAmountsMatch(tx, remote)) {
      throw new Error('Provider checkout state requires review');
    }
    const seller = await getPaylukCustomerId(tx.seller_id);
    deletionSubmitted = true;
    await PaylukService.deleteEscrow(seller, tx.payluk_tx_ref);
    const { error: releaseError } = await supabaseAdmin.rpc('release_ticket_checkout', {
      p_transaction_id: tx.id, p_deleted_escrow_id: tx.payluk_escrow_id,
    });
    if (releaseError) throw releaseError;
  } catch (failure) {
    if (!(failure instanceof TicketCheckoutError)) {
      if (!deletionSubmitted) {
        // No financial mutation was sent. A failed read can be retried safely.
        const { error: restoreError } = await supabaseAdmin.from('escrow_transactions')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', tx.id).eq('status', 'reconciling');
        if (restoreError) await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'ticket_cancellation_read_failed');
      } else await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'ticket_cancellation_uncertain');
    }
    throw failure;
  }
}

/** Expiry never frees a seat until its unpaid provider link is deleted. */
async function expireOneCheckout(tierId: string) {
  const { data, error } = await supabaseAdmin.from('ticket_checkout_reservations').select('transaction_id')
    .eq('tier_id', tierId).gt('remaining', 0).lte('expires_at', new Date().toISOString())
    .order('expires_at').limit(1);
  if (error) throw error;
  if (data?.[0]) {
    try { await cancelTicketCheckout(data[0].transaction_id); }
    catch { /* Paid or uncertain reservations remain held for fulfillment/review. */ }
  }
}

export async function verifyTicketCheckout(reference: string, expectedBuyerId?: string) {
  if (!/^[A-Za-z0-9._=-]{1,100}$/.test(reference)) throw new TicketCheckoutError('Invalid payment reference.', 400);
  let query = supabaseAdmin.from('escrow_transactions').select('id, payment_provider, buyer_id')
    .eq('item_type', 'ticket');
  query = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(reference)
    ? query.or(`id.eq.${reference},payment_reference.eq.${reference}`)
    : query.eq('payment_reference', reference);
  const { data: transaction, error } = await query.maybeSingle();
  if (error) throw error;
  if (!transaction || (expectedBuyerId && transaction.buyer_id !== expectedBuyerId)) {
    throw new TicketCheckoutError('Checkout not found.', 404);
  }
  if (transaction.payment_provider === 'paystack') return verifyPaystackTicketCheckout(transaction.id, expectedBuyerId);
  if (transaction.payment_provider !== 'payluk') throw new TicketCheckoutError('Unsupported checkout provider.');
  return TicketService.verifyAndProcessTicket(transaction.id, expectedBuyerId);
}

export async function createTicketCheckout(input: TicketCheckoutInput, purpose: string, endTime: string, hostedCheckoutSupported = false) {
  const paystackMode = getPaystackEventMode();
  if (process.env.PAYSTACK_EVENT_CHECKOUT_ENABLED === 'true' && !paystackMode) {
    throw new TicketCheckoutError('Ticket payments are temporarily unavailable while payment configuration is checked.', 503);
  }
  if (paystackMode) {
    if (!hostedCheckoutSupported) throw new TicketCheckoutError('Update the app to purchase tickets securely.', 426);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng').origin;
    return createPaystackTicketCheckout(input, `${origin}/events/${input.event_id}?paystack_return=1`);
  }
  await expireOneCheckout(input.tier_id);
  const { data: reservation, error } = await supabaseAdmin.rpc('reserve_ticket_checkout', { p_payload: input });
  if (error || !reservation?.transaction) throw new TicketCheckoutError(error?.message || 'Could not reserve tickets.');
  const tx = reservation.transaction;
  const response = (buyerPaylukId: string) => ({
    success: true, transactionId: tx.id, tx_ref: tx.payment_reference, provider: 'payluk',
    paylukPaymentToken: tx.payluk_tx_ref, paylukEscrowId: tx.payluk_escrow_id,
    buyerPaylukId, totalAmount: Number(tx.total_amount),
  });
  if (['paid','shipped','delivered','completed'].includes(tx.status)) {
    const ticket = await TicketService.verifyAndProcessTicket(tx.id, input.buyer_id);
    return { success: true, alreadyPaid: true, ticket_id: ticket.id, tx_ref: tx.payment_reference };
  }
  if (tx.status === 'pending' && tx.payluk_tx_ref && tx.payluk_escrow_id) {
    const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (!paylukAmountsMatch(tx, remote)) {
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'ticket_retry_amount_mismatch');
      throw new TicketCheckoutError('Checkout needs reconciliation.');
    }
    if (['ONGOING','COMPLETED','CLAIMED'].includes(remote.status)) {
      const ticket = await TicketService.verifyAndProcessTicket(tx.id, input.buyer_id);
      return { success: true, alreadyPaid: true, ticket_id: ticket.id, tx_ref: tx.payment_reference };
    }
    if (remote.status !== 'PENDING' || remote.state !== 'AWAITING_PAYMENT') throw new TicketCheckoutError('Checkout needs reconciliation.');
    return response(await getPaylukCustomerId(input.buyer_id));
  }
  if (tx.status !== 'pending' || tx.payluk_escrow_id || tx.payluk_tx_ref) {
    if (tx.status === 'creating_escrow' && Date.now() - Date.parse(tx.creating_escrow_started_at) > 60_000) {
      await flagPayment('payluk', tx.id, tx.id, 'stale_ticket_creation');
    }
    throw new TicketCheckoutError('Checkout is processing or needs review. No new payment was started.');
  }
  const { data: claimed, error: claimError } = await supabaseAdmin.from('escrow_transactions')
    .update({ status: 'creating_escrow', creating_escrow_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', tx.id).eq('status', 'pending').is('payluk_escrow_id', null).select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new TicketCheckoutError('Checkout is already processing. Retry shortly.');
  let submitted = false;
  let escrowId: string | undefined;
  const deadline = AbortSignal.timeout(20_000);
  try {
    const buyer = await getPaylukCustomerId(input.buyer_id);
    const seller = await getPaylukCustomerId(tx.seller_id);
    await PaylukService.updateCustomerPermissions(buyer, { canBuy: true }, deadline);
    await PaylukService.updateCustomerPermissions(seller, { canSell: true }, deadline);
    const days = Math.ceil((new Date(endTime).getTime() - Date.now()) / 86_400_000);
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('Event is outside the supported escrow window');
    submitted = true;
    const principal = paylukEscrowPrincipal(tx);
    const escrow = await PaylukService.createEscrow(seller, {
      amount: principal, purpose, whoPays: 'seller',
      maxDelivery: days, deliveryTimeline: 'days', totalQuantity: 1,
    }, deadline);
    escrowId = escrow.id;
    if (!Number.isFinite(escrow.fee) || escrow.fee < 0 || escrow.fee > principal) throw new Error('Invalid provider fee');
    // Persist the token before another provider mutation can fail.
    const { data: stored, error: storeError } = await supabaseAdmin.from('escrow_transactions').update({
      payluk_escrow_id: escrow.id, payluk_tx_ref: escrow.paymentToken,
      seller_amount: Math.round((principal - escrow.fee) * 100) / 100,
      metadata: { ...tx.metadata, payluk_fee: escrow.fee },
    }).eq('id', tx.id).eq('status', 'creating_escrow').select('id').maybeSingle();
    if (storeError || !stored) throw new Error('Could not persist provider checkout');
    await PaylukService.addAdditionalFee(escrow.paymentToken, Number(tx.commission), deadline);
    const { data: ready, error: readyError } = await supabaseAdmin.from('escrow_transactions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', tx.id).eq('status', 'creating_escrow').select('id').maybeSingle();
    if (readyError || !ready) throw new Error('Could not finalize provider checkout');
    tx.payluk_tx_ref = escrow.paymentToken; tx.payluk_escrow_id = escrow.id;
    return response(buyer);
  } catch (failure) {
    if (submitted) {
      const { error: stateError } = await supabaseAdmin.from('escrow_transactions')
        .update({ status: 'reconciling', updated_at: new Date().toISOString() })
        .eq('id', tx.id).eq('status', 'creating_escrow');
      if (stateError) console.error('[TicketCheckout] Could not mark uncertain setup:', stateError.code);
      await flagPayment('payluk', escrowId || tx.id, tx.id, 'ticket_creation_uncertain');
    } else {
      const { error: releaseError } = await supabaseAdmin.rpc('release_ticket_checkout', { p_transaction_id: tx.id, p_before_provider: true });
      if (releaseError) throw releaseError;
    }
    console.error('[TicketCheckout] Setup failed:', failure instanceof Error ? failure.message : 'Unknown outcome');
    throw new TicketCheckoutError(submitted ? 'Payment setup needs reconciliation. No replacement charge was started.' : 'Could not prepare payment accounts.', 502);
  }
}
