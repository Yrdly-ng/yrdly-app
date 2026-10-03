import { supabaseAdmin } from './supabase-admin';
import { PaylukService } from './payluk-service';
import { getPaylukCustomerId } from './payluk-onboarding';

export function computeDepositAmount(service: { price?: number | null; deposit_amount?: number | null; deposit_percent?: number | null }): number | null {
  if (service.deposit_amount) return Number(service.deposit_amount);
  if (service.deposit_percent && service.price) {
    return Math.round(Number(service.price) * Number(service.deposit_percent) / 100);
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

export async function createCheckoutForBooking(opts: BookingCheckoutOptions): Promise<{
  reference: string;
  url: string;
  paylukPaymentToken: string;
  buyerPaylukId: string;
}> {
  if (!Number.isFinite(opts.amount) || opts.amount < 1000 || Math.round(opts.amount * 100) !== opts.amount * 100) {
    throw new Error('Payluk booking payments must be at least ₦1,000 with at most two decimal places.');
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('booking_payments')
    .select('payluk_reference, payluk_checkout_url, payluk_payment_token, amount, type')
    .eq('booking_id', opts.bookingId)
    .eq('status', 'deposit_pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.payluk_checkout_url && existing.payluk_payment_token &&
      Number(existing.amount) === opts.amount && existing.type === opts.type) {
    return {
      reference: existing.payluk_reference,
      url: existing.payluk_checkout_url,
      paylukPaymentToken: existing.payluk_payment_token,
      buyerPaylukId: await getPaylukCustomerId(opts.buyerId),
    };
  }
  if (existing) {
    throw new Error('A different booking checkout is already pending. Contact support to replace it.');
  }

  const [buyerPaylukId, sellerPaylukId] = await Promise.all([
    getPaylukCustomerId(opts.buyerId),
    getPaylukCustomerId(opts.sellerId),
  ]);
  await PaylukService.updateCustomerPermissions(buyerPaylukId, { canBuy: true });
  await PaylukService.updateCustomerPermissions(sellerPaylukId, { canSell: true });

  const daysUntilAppointment = Math.ceil((new Date(opts.appointmentTime).getTime() - Date.now()) / 86_400_000);
  const escrow = await PaylukService.createEscrow(sellerPaylukId, {
    amount: opts.amount,
    purpose: opts.purpose,
    whoPays: 'seller',
    maxDelivery: Math.max(1, Math.min(daysUntilAppointment + 1, 365)),
    deliveryTimeline: 'days',
    totalQuantity: 1,
  });

  const reference = `bk_${opts.bookingId}_${opts.type}_${Date.now()}`;
  const paylukHost = process.env.PAYLUK_SECRET_KEY?.startsWith('sk_live_')
    ? 'https://payluk.ng'
    : 'https://staging.api.payluk.ng';
  const url = `${paylukHost}/escrow/${escrow.paymentToken}`;

  const { error: insertError } = await supabaseAdmin.from('booking_payments').insert({
    booking_id: opts.bookingId,
    amount: opts.amount,
    type: opts.type,
    status: 'deposit_pending',
    provider: 'payluk',
    payluk_reference: reference,
    payluk_escrow_id: escrow.id,
    payluk_payment_token: escrow.paymentToken,
    payluk_checkout_url: url,
    escrow_hold: true,
  });
  if (insertError) {
    await PaylukService.deleteEscrow(sellerPaylukId, escrow.paymentToken).catch(error => {
      console.error('[BookingCheckout] Could not remove orphaned Payluk escrow:', error);
    });
    throw insertError;
  }

  const { error: bookingError } = await supabaseAdmin.from('bookings')
    .update({ payment_status: 'deposit_pending' })
    .eq('id', opts.bookingId);
  if (bookingError) throw bookingError;

  return { reference, url, paylukPaymentToken: escrow.paymentToken, buyerPaylukId };
}

/** Process only signed escrow lifecycle events for booking payments. */
export async function handlePaylukWebhookEvent(payload: any): Promise<void> {
  const event = payload?.event;
  if (!['escrow.ongoing', 'escrow.completed', 'escrow.claimed', 'escrow.refunded', 'escrow.cancelled'].includes(event)) return;

  const escrowId = payload?.data?.id;
  if (typeof escrowId !== 'string') throw new Error('Payluk booking event has no escrow ID');

  const { data: payment, error: lookupError } = await supabaseAdmin
    .from('booking_payments')
    .select('id, booking_id, amount, type, status')
    .eq('payluk_escrow_id', escrowId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!payment) return;

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
