import { supabaseAdmin } from '../supabase/supabase-admin';
import { PaylukService } from '../payments/payluk-service';
import { getPaylukCustomerId } from '../payments/payluk-onboarding';
import { flagPayment } from '../payments/payment-reconciliation';
import { paylukAmountsMatch } from '../payments/payment-state';
import { applyEscrowPayment } from '../payments/escrow-payment';

export function computeDepositAmount(service: { price?: number | null; deposit_amount?: number | null; deposit_percent?: number | null }): number | null {
  if (service.deposit_amount) return Number(service.deposit_amount);
  if (service.deposit_percent && service.price) {
    return Math.round(Number(service.price) * Number(service.deposit_percent)) / 100;
  }
  return null;
}

interface BookingCheckoutOptions {
  bookingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  type: 'deposit' | 'full' | 'escrow';
  purpose: string;
  appointmentTime: string;
}

export class BookingCheckoutError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function createCheckoutForBooking(opts: BookingCheckoutOptions) {
  // The database locks the booking and computes the price/type from its service
  // or accepted quote. The caller's amount never determines the payment ledger.
  const { data: reservation, error } = await supabaseAdmin.rpc('reserve_booking_checkout', {
    p_booking_id: opts.bookingId, p_buyer_id: opts.buyerId, p_type: opts.type,
  });
  if (error || !reservation?.transaction) throw new BookingCheckoutError(error?.message || 'Could not reserve booking payment.');
  const tx = reservation.transaction;
  const response = (buyerPaylukId: string) => ({
    transactionId: tx.id, reference: tx.payment_reference, paylukPaymentToken: tx.payluk_tx_ref,
    paylukEscrowId: tx.payluk_escrow_id, buyerPaylukId,
    amount: Number(tx.amount), commission: Number(tx.commission), totalAmount: Number(tx.total_amount),
  });
  if (['paid','shipped','delivered','completed'].includes(tx.status)) return { alreadyPaid: true, ...response('') };
  if (tx.status === 'pending' && tx.payluk_tx_ref && tx.payluk_escrow_id) {
    const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (!paylukAmountsMatch(tx, remote)) {
      await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'booking_retry_amount_mismatch');
      throw new BookingCheckoutError('Booking checkout needs reconciliation.');
    }
    if (['ONGOING','COMPLETED','CLAIMED'].includes(remote.status)) {
      await applyEscrowPayment(tx.id, 'payluk', tx.payluk_escrow_id);
      return { alreadyPaid: true, ...response('') };
    }
    if (remote.state !== 'AWAITING_PAYMENT' || remote.status !== 'PENDING') throw new BookingCheckoutError('Booking checkout needs reconciliation.');
    return response(await getPaylukCustomerId(opts.buyerId));
  }
  if (tx.status !== 'pending' || tx.payluk_escrow_id || tx.payluk_tx_ref) {
    throw new BookingCheckoutError('Booking payment is processing or needs review. No new charge was started.');
  }
  const { data: claimed, error: claimError } = await supabaseAdmin.from('escrow_transactions')
    .update({ status: 'creating_escrow', creating_escrow_started_at: new Date().toISOString() })
    .eq('id', tx.id).eq('status', 'pending').is('payluk_escrow_id', null).select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new BookingCheckoutError('Booking checkout is already processing. Retry shortly.');
  let submitted = false;
  let escrowId: string | undefined;
  const deadline = AbortSignal.timeout(20_000);
  try {
    const buyer = await getPaylukCustomerId(opts.buyerId);
    const seller = await getPaylukCustomerId(tx.seller_id);
    await PaylukService.updateCustomerPermissions(buyer, { canBuy: true }, deadline);
    await PaylukService.updateCustomerPermissions(seller, { canSell: true }, deadline);
    const days = Math.ceil((new Date(opts.appointmentTime).getTime() - Date.now()) / 86_400_000) + 1;
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('Appointment is outside the supported escrow window');
    submitted = true;
    const escrow = await PaylukService.createEscrow(seller, {
      amount: Number(tx.amount), purpose: opts.purpose, whoPays: 'seller',
      maxDelivery: days, deliveryTimeline: 'days', totalQuantity: 1,
    }, deadline);
    escrowId = escrow.id;
    if (!Number.isFinite(escrow.fee) || escrow.fee < 0 || escrow.fee > Number(tx.amount)) throw new Error('Invalid provider fee');
    const { data: stored, error: storeError } = await supabaseAdmin.from('escrow_transactions').update({
      payluk_escrow_id: escrow.id, payluk_tx_ref: escrow.paymentToken,
      seller_amount: Math.round((Number(tx.amount) - escrow.fee) * 100) / 100,
      metadata: { ...tx.metadata, payluk_fee: escrow.fee },
    }).eq('id', tx.id).eq('status', 'creating_escrow').select('id').maybeSingle();
    if (storeError || !stored) throw new Error('Could not persist booking provider checkout');
    await PaylukService.addAdditionalFee(escrow.paymentToken, Number(tx.commission), deadline);
    const { data: ready, error: readyError } = await supabaseAdmin.from('escrow_transactions')
      .update({ status: 'pending' }).eq('id', tx.id).eq('status', 'creating_escrow').select('id').maybeSingle();
    if (readyError || !ready) throw new Error('Could not finalize booking provider checkout');
    tx.payluk_tx_ref = escrow.paymentToken; tx.payluk_escrow_id = escrow.id;
    return response(buyer);
  } catch (failure) {
    const { error: stateError } = await supabaseAdmin.from('escrow_transactions')
      .update({ status: submitted ? 'reconciling' : 'cancelled' }).eq('id', tx.id).eq('status', 'creating_escrow');
    if (submitted || stateError) await flagPayment('payluk', escrowId || tx.id, tx.id, 'booking_creation_uncertain');
    console.error('[BookingCheckout] Setup failed:', failure instanceof Error ? failure.message : 'Unknown outcome');
    throw new BookingCheckoutError(submitted ? 'Booking payment setup needs reconciliation. No replacement charge was started.' : 'Could not prepare payment accounts.', 502);
  }
}

export async function verifyBookingCheckout(bookingId: string, buyerId: string) {
  const { data: tx, error } = await supabaseAdmin.from('escrow_transactions').select('*')
    .eq('item_type', 'booking').eq('item_id', bookingId).eq('buyer_id', buyerId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!tx) throw new BookingCheckoutError('Booking payment not found.', 404);
  if (['paid','shipped','delivered','completed'].includes(tx.status)) return { transactionId: tx.id, completed: tx.status === 'completed' };
  if (!tx.payluk_tx_ref) throw new BookingCheckoutError('Booking payment setup is incomplete.');
  const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
  if (!['ONGOING','COMPLETED','CLAIMED'].includes(remote.status)) throw new BookingCheckoutError('Booking payment has not completed.', 402);
  if (!paylukAmountsMatch(tx, remote)) {
    await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'booking_amount_mismatch');
    throw new BookingCheckoutError('Booking payment needs reconciliation.');
  }
  await applyEscrowPayment(tx.id, 'payluk', tx.payluk_escrow_id);
  return { transactionId: tx.id, completed: false };
}

export async function cancelBookingCheckout(transactionId: string, buyerId: string) {
  const { data: tx, error } = await supabaseAdmin.from('escrow_transactions').select('*')
    .eq('id', transactionId).eq('item_type', 'booking').eq('buyer_id', buyerId).maybeSingle();
  if (error) throw error;
  if (!tx) throw new BookingCheckoutError('Booking payment not found.', 404);
  if (tx.status === 'cancelled') return;
  if (tx.status !== 'pending') throw new BookingCheckoutError('Booking payment is processing or needs review.');
  if (!tx.payluk_escrow_id && !tx.payluk_tx_ref) {
    const { data: cancelled, error: cancelError } = await supabaseAdmin.from('escrow_transactions')
      .update({ status: 'cancelled' }).eq('id', tx.id).eq('status', 'pending').is('payluk_escrow_id', null).select('id').maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) throw new BookingCheckoutError('Booking checkout setup is already in progress.');
    return;
  }
  if (!tx.payluk_escrow_id || !tx.payluk_tx_ref) throw new BookingCheckoutError('Booking payment needs reconciliation.');
  const { data: claimed, error: claimError } = await supabaseAdmin.from('escrow_transactions')
    .update({ status: 'reconciling' }).eq('id', tx.id).eq('status', 'pending').select('id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new BookingCheckoutError('Booking checkout changed. Retry shortly.');
  let deletionSubmitted = false;
  try {
    const remote = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
    if (['ONGOING','COMPLETED','CLAIMED'].includes(remote.status)) {
      await verifyBookingCheckout(tx.item_id, buyerId);
      throw new BookingCheckoutError('This booking has been paid. Use support for a refund.');
    }
    if (remote.state !== 'AWAITING_PAYMENT' || remote.status !== 'PENDING' || !paylukAmountsMatch(tx, remote)) throw new Error('Provider checkout state needs review');
    const seller = await getPaylukCustomerId(tx.seller_id);
    deletionSubmitted = true;
    await PaylukService.deleteEscrow(seller, tx.payluk_tx_ref);
    const { data: cancelled, error: cancelError } = await supabaseAdmin.from('escrow_transactions')
      .update({ status: 'cancelled' }).eq('id', tx.id).eq('status', 'reconciling').select('id').maybeSingle();
    if (cancelError || !cancelled) throw new Error('Could not record provider checkout cancellation');
  } catch (failure) {
    if (!(failure instanceof BookingCheckoutError)) {
      if (deletionSubmitted) await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'booking_cancellation_uncertain');
      else {
        const { error: restoreError } = await supabaseAdmin.from('escrow_transactions')
          .update({ status: 'pending' }).eq('id', tx.id).eq('status', 'reconciling');
        if (restoreError) await flagPayment('payluk', tx.payluk_escrow_id, tx.id, 'booking_cancellation_read_failed');
      }
    }
    throw failure;
  }
}

/** Process only signed escrow lifecycle events for booking payments. */
export async function handlePaylukWebhookEvent(payload: any): Promise<void> {
  const event = payload?.event;
  if (!['escrow.ongoing', 'escrow.completed', 'escrow.claimed', 'escrow.refunded', 'escrow.cancelled'].includes(event)) return;

  const escrowId = payload?.data?.id;
  if (typeof escrowId !== 'string') throw new Error('Payluk booking event has no escrow ID');

  const { data: payment, error: lookupError } = await supabaseAdmin
    .from('booking_payments')
    .select('id, booking_id, amount, type, status, escrow_transaction_id')
    .eq('payluk_escrow_id', escrowId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!payment) return;
  // New checkouts are synchronized atomically by sync_booking_escrow. This
  // compatibility handler only processes the explicitly unlinked legacy rows.
  if (payment.escrow_transaction_id) return;

  if (Number(payload.data.amount) !== Number(payment.amount)) {
    throw new Error(`Payluk booking amount mismatch for escrow ${escrowId}`);
  }

  const nextStatus = event === 'escrow.ongoing'
    ? payment.type === 'escrow' ? 'escrow_held' : payment.type === 'deposit' ? 'deposit_paid' : 'fully_paid'
    : event === 'escrow.completed' || event === 'escrow.claimed'
      ? 'escrow_released'
      : 'refunded';

  const allowedPrevious = event === 'escrow.ongoing'
    ? ['deposit_pending']
    : event === 'escrow.completed' || event === 'escrow.claimed'
      ? ['deposit_pending', 'deposit_paid', 'fully_paid', 'escrow_held']
      : ['deposit_pending', 'deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released'];

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('booking_payments')
    .update({ status: nextStatus, paid_at: event === 'escrow.ongoing' ? new Date().toISOString() : undefined })
    .eq('id', payment.id)
    .in('status', allowedPrevious)
    .select('id');
  if (updateError) throw updateError;
  if (!updated?.length && payment.status !== nextStatus) return;

  const { error: bookingError } = await supabaseAdmin.from('bookings')
    .update({ payment_status: nextStatus })
    .eq('id', payment.booking_id);
  if (bookingError) throw bookingError;
}
