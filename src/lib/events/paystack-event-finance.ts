import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaystackService, paystackKeyMode, getPaystackEventMode, paystackSandboxUserAllowed } from '@/lib/payments/paystack-service';

export class EventFinanceError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}

function check(error: { message: string } | null) {
  if (error) throw new Error(`Event ledger operation failed: ${error.message}`);
}

function sandboxFinance() {
  if (getPaystackEventMode() !== 'test' || paystackKeyMode() !== 'test') {
    throw new EventFinanceError('Paystack event withdrawals and refunds are currently available in sandbox only.', 503);
  }
}

export async function getEventEarnings(eventId: string, organizerId: string) {
  const { data: event, error } = await supabaseAdmin.from('events').select('id,organizer_id,end_time,status').eq('id', eventId).single();
  if (error || !event) throw new EventFinanceError('Event not found.', 404);
  if (event.organizer_id !== organizerId) throw new EventFinanceError('Only the organiser can view event earnings.', 403);
  let domain: 'test' | 'live';
  try { domain = paystackKeyMode(); }
  catch {
    return { enabled: false, provider: 'paystack', domain: null, totals: { grossKobo: 0, commissionKobo: 0, providerFeeKobo: 0, heldKobo: 0, availableKobo: 0, withdrawnKobo: 0 }, entries: [], withdrawals: [], eligibleAt: null, financialHold: false, sandboxOnly: true };
  }
  if (domain === 'test' && !paystackSandboxUserAllowed(organizerId)) throw new EventFinanceError('Sandbox earnings are restricted to approved testers.', 403);
  const [earnings, transfers] = await Promise.all([
    supabaseAdmin.from('paystack_event_earnings').select('*').eq('event_id', eventId).eq('domain', domain),
    supabaseAdmin.from('paystack_event_withdrawals').select('*').eq('event_id', eventId).eq('domain', domain).order('requested_at', { ascending: false }),
  ]);
  [earnings, transfers].forEach(result => check(result.error));
  const entries = earnings.data || [];
  const withdrawals = transfers.data || [];
  const eligibleAt = event.end_time ? new Date(Date.parse(event.end_time) + 86_400_000).toISOString() : null;
  const aggregate = await supabaseAdmin.rpc('get_paystack_event_totals', { p_event_id: eventId, p_domain: domain });
  check(aggregate.error);
  return { enabled: true, provider: 'paystack', domain, totals: aggregate.data as { grossKobo: number; commissionKobo: number; providerFeeKobo: number; heldKobo: number; availableKobo: number; withdrawnKobo: number }, entries, withdrawals, eligibleAt, financialHold: aggregate.data.financialHold as boolean, sandboxOnly: true };
}

export async function requestEventWithdrawal(eventId: string, organizerId: string, input: {
  bankCode: string; accountNumber: string; confirm: boolean; expectedAmountKobo: number;
}) {
  sandboxFinance();
  if (input.confirm !== true || !Number.isSafeInteger(input.expectedAmountKobo)) throw new EventFinanceError('Confirm the bank details and withdrawal amount.', 400);
  const summary = await getEventEarnings(eventId, organizerId);
  if (summary.totals.availableKobo !== input.expectedAmountKobo || input.expectedAmountKobo < 10000) throw new EventFinanceError('The available balance changed or is below ₦100. Refresh and try again.');
  const [account, banks] = await Promise.all([PaystackService.resolveAccount(input.accountNumber, input.bankCode), PaystackService.listBanks()]);
  const bank = banks.find(item => item.code === input.bankCode && item.active && item.currency === 'NGN');
  if (!bank || account.account_number !== input.accountNumber || !account.account_name) throw new EventFinanceError('Bank details could not be verified.', 400);
  const recipient = await PaystackService.createTransferRecipient({ accountNumber: input.accountNumber, bankCode: input.bankCode, name: account.account_name });
  const { data: intent, error } = await supabaseAdmin.rpc('reserve_paystack_event_withdrawal', {
    p_event_id: eventId, p_organizer_id: organizerId, p_domain: 'test', p_expected_kobo: input.expectedAmountKobo,
    p_recipient: recipient.recipient_code, p_bank_name: bank.name, p_account_name: account.account_name, p_last_four: input.accountNumber.slice(-4),
  });
  if (error || !intent) throw new EventFinanceError('The withdrawal could not be reserved. Refresh the event balance.');
  const claim = await supabaseAdmin.from('paystack_event_withdrawals').update({ status: 'submitting' }).eq('id', intent.id).eq('status', 'reserved').select('id');
  check(claim.error);
  if (claim.data?.length !== 1) throw new EventFinanceError('This withdrawal is already being processed.');
  try {
    // Exactly one submission, with the reference durably stored before the API call.
    await PaystackService.initiateTransfer({ amountKobo: Number(intent.amount_kobo), recipient: intent.recipient_code, reference: intent.reference, reason: 'YRDLY sandbox event withdrawal' });
    await reconcileEventWithdrawal(intent.reference);
  } catch {
    // Keep the money reserved on every uncertain response. Webhook/manual refresh reconciles.
    const update = await supabaseAdmin.from('paystack_event_withdrawals').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', intent.id).eq('status', 'submitting');
    check(update.error);
  }
  const result = await supabaseAdmin.from('paystack_event_withdrawals').select('*').eq('id', intent.id).single();
  check(result.error);
  return result.data;
}

export async function reconcileEventWithdrawal(reference: string) {
  const row = await supabaseAdmin.from('paystack_event_withdrawals').select('*').eq('reference', reference).maybeSingle();
  check(row.error);
  if (!row.data) return;
  if (row.data.domain !== paystackKeyMode()) throw new Error('Withdrawal environment mismatch.');
  const transfer = await PaystackService.verifyTransfer(reference);
  const recipient = typeof transfer.recipient === 'string' ? transfer.recipient : transfer.recipient?.recipient_code;
  if (transfer.reference !== reference || transfer.domain !== row.data.domain || transfer.currency !== 'NGN' || !recipient || !Number.isSafeInteger(transfer.amount)) throw new Error('Transfer verification mismatch.');
  const status = ['pending', 'otp', 'success', 'failed', 'reversed'].includes(transfer.status) ? transfer.status : 'pending';
  const result = await supabaseAdmin.rpc('reconcile_paystack_event_withdrawal', {
    p_reference: reference, p_status: status, p_amount: transfer.amount, p_recipient: recipient, p_transfer_code: transfer.transfer_code,
  });
  check(result.error);
}

export async function requestTicketRefund(ticketId: string, organizerId: string) {
  sandboxFinance();
  const { data: intent, error } = await supabaseAdmin.rpc('reserve_paystack_ticket_refund', { p_ticket_id: ticketId, p_organizer_id: organizerId });
  if (error || !intent) throw new EventFinanceError('This ticket cannot be refunded automatically. Check its status or contact support.');
  if (intent.status !== 'reserved') return intent;
  const order = await supabaseAdmin.from('escrow_transactions').select('payment_reference,payment_provider').eq('id', intent.transaction_id).single();
  check(order.error);
  const earning = await supabaseAdmin.from('paystack_event_earnings').select('domain').eq('transaction_id', intent.transaction_id).single();
  check(earning.error);
  if (order.data?.payment_provider !== 'paystack' || !order.data.payment_reference || earning.data?.domain !== paystackKeyMode()) throw new Error('Refund order environment mismatch.');
  const claim = await supabaseAdmin.from('paystack_ticket_refunds').update({ status: 'submitting' }).eq('id', intent.id).eq('status', 'reserved').select('id');
  check(claim.error);
  if (claim.data?.length !== 1) return intent;
  try {
    const refund = await PaystackService.refundTransaction({ transaction: order.data.payment_reference, amountKobo: Number(intent.amount_kobo), merchantNote: `YRDLY ticket refund ${intent.id}` });
    const stored = await supabaseAdmin.from('paystack_ticket_refunds').update({ provider_refund_id: String(refund.id), status: 'pending' }).eq('id', intent.id).eq('status', 'submitting');
    check(stored.error);
    await reconcileTicketRefund(String(refund.id));
  } catch {
    const result = await supabaseAdmin.from('paystack_ticket_refunds').update({ status: 'review' }).eq('id', intent.id).eq('status', 'submitting');
    check(result.error);
  }
  const result = await supabaseAdmin.from('paystack_ticket_refunds').select('*').eq('id', intent.id).single();
  check(result.error);
  return result.data;
}

export async function reconcileTicketRefund(providerId: string) {
  const row = await supabaseAdmin.from('paystack_ticket_refunds').select('*').eq('provider_refund_id', providerId).maybeSingle();
  check(row.error);
  if (!row.data) return; // Unknown/uncertain creation remains held for support, never recreated.
  const [refund, order, earning] = await Promise.all([
    PaystackService.getRefund(providerId),
    supabaseAdmin.from('paystack_ticket_orders').select('provider_transaction_id').eq('transaction_id', row.data.transaction_id).single(),
    supabaseAdmin.from('paystack_event_earnings').select('domain').eq('transaction_id', row.data.transaction_id).single(),
  ]);
  check(order.error); check(earning.error);
  const transactionId = typeof refund.transaction === 'object' ? refund.transaction.id : refund.transaction;
  if (String(refund.id) !== providerId || refund.currency !== 'NGN' || String(transactionId) !== order.data?.provider_transaction_id || refund.domain !== earning.data?.domain || earning.data?.domain !== paystackKeyMode()) throw new Error('Refund verification mismatch.');
  const result = await supabaseAdmin.rpc('reconcile_paystack_ticket_refund', { p_refund_id: row.data.id, p_provider_id: providerId, p_status: refund.status, p_amount: refund.amount });
  check(result.error);
}

/** Signature validation happens in the webhook route; verify resources before financial mutation. */
export async function reconcilePaystackFinancialWebhook(event: string, data: Record<string, unknown>) {
  if (paystackKeyMode() === 'test' && getPaystackEventMode() !== 'test') throw new Error('Sandbox database configuration is not confirmed.');
  if (event.startsWith('transfer.') && typeof data.reference === 'string') {
    await reconcileEventWithdrawal(data.reference);
  } else if (event.startsWith('refund.')) {
    if (data.id != null) {
      await reconcileTicketRefund(String(data.id));
      return;
    }
    // Paystack also sends refund events identified by transaction_reference.
    // Resolve only our stored refund ID, then fetch its authoritative state;
    // webhook status/amount alone must never mark a ticket refunded.
    const reference = data.transaction_reference;
    const amount = typeof data.amount === 'string' && /^\d+$/.test(data.amount) ? Number(data.amount) : data.amount;
    if (typeof reference !== 'string' || !/^[A-Za-z0-9._=-]{1,100}$/.test(reference) ||
        data.currency !== 'NGN' || data.domain !== paystackKeyMode() ||
        typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Refund webhook identity mismatch.');
    }
    const order = await supabaseAdmin.from('escrow_transactions').select('id').eq('payment_reference', reference)
      .eq('payment_provider', 'paystack').eq('item_type', 'ticket').maybeSingle();
    check(order.error);
    if (!order.data) return;
    const refunds = await supabaseAdmin.from('paystack_ticket_refunds').select('provider_refund_id')
      .eq('transaction_id', order.data.id).eq('amount_kobo', amount).not('provider_refund_id', 'is', null).limit(2);
    check(refunds.error);
    if (refunds.data?.length !== 1) throw new Error('Refund webhook requires reference reconciliation.');
    await reconcileTicketRefund(refunds.data[0].provider_refund_id!);
  } else if (event.startsWith('charge.dispute.')) {
    const transaction = data.transaction as { reference?: string } | undefined;
    if (!transaction?.reference) throw new Error('Dispute transaction reference missing.');
    const order = await supabaseAdmin.from('escrow_transactions').select('id').eq('payment_reference', transaction.reference).eq('payment_provider', 'paystack').maybeSingle();
    check(order.error);
    if (order.data) {
      // Do not automatically unlock on a resolution: payout recovery may still be owed.
      const result = await supabaseAdmin.rpc('hold_paystack_event_order', { p_transaction_id: order.data.id, p_reason: `${event}: dispute ${String(data.id || '')} requires operations review` });
      check(result.error);
    }
  }
}

/** Recovery reads existing provider resources; never submits a refund or transfer. */
export async function reconcilePaystackEventFinance() {
  if (!getPaystackEventMode()) return { checkedWithdrawals: 0, checkedRefunds: 0 };
  const [withdrawals, refunds] = await Promise.all([
    supabaseAdmin.from('paystack_event_withdrawals').select('reference').eq('domain', paystackKeyMode()).in('status', ['submitting', 'pending', 'otp']).order('updated_at').limit(10),
    supabaseAdmin.from('paystack_ticket_refunds').select('id,provider_refund_id').not('provider_refund_id', 'is', null).in('status', ['pending', 'processing', 'needs-attention']).order('updated_at').limit(10),
  ]);
  check(withdrawals.error); check(refunds.error);
  for (const withdrawal of withdrawals.data || []) {
    try { await reconcileEventWithdrawal(withdrawal.reference); } catch {
      check((await supabaseAdmin.from('paystack_event_withdrawals').update({ updated_at: new Date().toISOString() }).eq('reference', withdrawal.reference)).error);
    }
  }
  for (const refund of refunds.data || []) {
    try { await reconcileTicketRefund(refund.provider_refund_id!); } catch {
      check((await supabaseAdmin.from('paystack_ticket_refunds').update({ updated_at: new Date().toISOString() }).eq('id', refund.id)).error);
    }
  }
  return { checkedWithdrawals: withdrawals.data?.length || 0, checkedRefunds: refunds.data?.length || 0 };
}
