import { supabaseAdmin } from './supabase-admin';
import { PaystackService } from './paystack-service';

/** Reserve a whole set of tickets before requesting one Paystack refund. */
export async function requestPaystackTicketRefund(
  paymentReference: string,
  tickets: Array<{ id: string; amount_paid: number }>
): Promise<void> {
  if (!paymentReference || !tickets.length) throw new Error('PAYMENT_REFERENCE_MISSING');
  const ticketIds = tickets.map(ticket => ticket.id);
  const amount = tickets.reduce((total, ticket) => total + Number(ticket.amount_paid), 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_REFUND_AMOUNT');

  const { data: reserved, error: reserveError } = await supabaseAdmin.from('tickets')
    .update({ refund_status: 'initiating', refund_requested_at: new Date().toISOString() })
    .in('id', ticketIds).eq('status', 'PAID').is('refund_status', null)
    .select('id');
  if (reserveError) throw reserveError;
  if (reserved?.length !== ticketIds.length) {
    if (reserved?.length) await supabaseAdmin.from('tickets')
      .update({ refund_status: null, refund_requested_at: null })
      .in('id', reserved.map(ticket => ticket.id)).eq('refund_status', 'initiating');
    throw new Error('REFUND_ALREADY_REQUESTED');
  }

  const accepted = await PaystackService.refundTransaction(paymentReference, amount);
  if (!accepted) {
    // A timeout can happen after Paystack accepts the refund. Preserve the lock
    // until the refund webhook or support reconciles the provider state.
    throw new Error('PAYSTACK_REFUND_UNCERTAIN');
  }

  const { error: finalizeError } = await supabaseAdmin.from('tickets')
    .update({ refund_status: 'pending' })
    .in('id', ticketIds).eq('refund_status', 'initiating');
  if (finalizeError) {
    console.error('[TicketRefund] Provider accepted refund but state needs reconciliation', { paymentReference, ticketIds, finalizeError });
    throw new Error('REFUND_RECORD_FAILED');
  }
}
