import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from '@/lib/payments/payluk-service';
import { getPaylukCustomerId } from '@/lib/payments/payluk-onboarding';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';
import { EventFinanceError } from './event-finance-error';
import { paylukEventEnvironment, paylukEventFinanceEnabled, paylukEventWithdrawalsEnabled } from './payluk-event-finance-config';

function check(error: { message: string } | null) {
  if (error) throw new Error(`Event finance operation failed: ${error.message}`);
}
const kobo = (value: unknown) => Math.round(Number(value) * 100);
class WithdrawalReviewRequired extends Error {}

/** Payluk's seller claim opens one day after its funded delivery window. */
export function paylukEventClaimAvailableAt(escrow: { paidAt: unknown; maxDelivery: unknown; deliveryTimeline: unknown }): number | null {
  const raw = escrow.paidAt;
  const numeric = typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)) ? Number(raw) : null;
  const paidAt = numeric === null ? (typeof raw === 'string' ? Date.parse(raw) : NaN) : numeric < 1e12 ? numeric * 1000 : numeric;
  const units: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
  const unit = typeof escrow.deliveryTimeline === 'string' ? units[escrow.deliveryTimeline] : undefined;
  const count = Number(escrow.maxDelivery);
  if (!Number.isFinite(paidAt) || paidAt <= 0 || !unit || !Number.isInteger(count) || count < 1 || count > 365) return null;
  const availableAt = paidAt + count * unit + 86_400_000;
  return Number.isFinite(new Date(availableAt).getTime()) ? availableAt : null;
}

async function payoutAccount(owner: string) {
  const result = await supabaseAdmin.from('seller_accounts').select('account_details,updated_at').eq('user_id', owner)
    .eq('is_primary', true).eq('is_active', true).eq('verification_status', 'verified').maybeSingle();
  check(result.error);
  const details = result.data?.account_details;
  if (!details) return null;
  const bankCode = details.bank_code || details.bankCode;
  const accountNumber = details.account_number || details.accountNumber;
  const accountName = details.account_name || details.accountName;
  if (!bankCode || !/^\d{10}$/.test(accountNumber || '') || !accountName) return null;
  return { bankCode, accountNumber, accountName, bankName: details.bank_name || details.bankName || 'Verified bank', lastFour: accountNumber.slice(-4) };
}

export async function getPaylukEventEarnings(eventId: string, owner: string) {
  const environment = paylukEventEnvironment();
  if (!environment) throw new EventFinanceError('Event finance configuration is unavailable.', 503);
  const event = await supabaseAdmin.from('events').select('id,organizer_id,end_time,status').eq('id', eventId).single();
  if (event.error || !event.data) throw new EventFinanceError('Event not found.', 404);
  if (event.data.organizer_id !== owner) throw new EventFinanceError('Only the organiser can view event earnings.', 403);
  const [orders, tickets, payments, allocations, requests, bank] = await Promise.all([
    supabaseAdmin.from('escrow_transactions').select('id,amount,commission,seller_amount,status,metadata,payluk_tx_ref,payluk_escrow_id').eq('item_type', 'ticket').eq('payment_provider', 'payluk').eq('seller_id', owner).contains('metadata', { event_id: eventId, payluk_environment: environment }),
    supabaseAdmin.from('tickets').select('id,payment_tx_ref,status,refund_status').eq('event_id', eventId).eq('payment_provider', 'payluk'),
    supabaseAdmin.from('payluk_event_withdrawals').select('id,reference,status,amount_kobo,actual_debit_kobo,requested_at,updated_at').eq('event_id', eventId).eq('domain', environment).order('requested_at', { ascending: false }),
    supabaseAdmin.from('payluk_event_allocations').select('transaction_id,withdrawal_id,payluk_event_withdrawals!inner(event_id)').eq('payluk_event_withdrawals.event_id', eventId),
    supabaseAdmin.from('payluk_event_refund_requests').select('ticket_id').eq('event_id', eventId),
    payoutAccount(owner),
  ]);
  [orders,tickets,payments,allocations,requests].forEach(r => check(r.error));
  const eligibleAt = event.data.end_time ? new Date(Date.parse(event.data.end_time) + 86400000).toISOString() : null;
  const mature = !!eligibleAt && Date.parse(eligibleAt) <= Date.now() && event.data.status !== 'CANCELLED';
  const currentOrderIds = new Set((orders.data || []).map(order => order.id));
  const currentTickets = (tickets.data || []).filter(ticket => currentOrderIds.has(ticket.payment_tx_ref));
  const withdrawals = payments.data || [];
  const allocated = new Set((allocations.data || []).map(a => a.transaction_id));
  const financialHold = (requests.data || []).some(r => currentTickets.some(t => t.id === r.ticket_id && t.status !== 'REFUNDED')) || currentTickets.some(t => t.refund_status && t.status !== 'REFUNDED') || (orders.data || []).some(t => t.status === 'disputed');
  const entries = (orders.data || []).filter(t => t.metadata?.payluk_environment === environment && ['paid','completed','disputed'].includes(t.status)).map(t => ({
    transaction_id: t.id, gross_kobo: kobo(t.amount), commission_kobo: kobo(t.commission),
    provider_fee_kobo: Math.max(0,kobo(Number(t.amount)-Number(t.commission)-Number(t.seller_amount))), proceeds_kobo: kobo(t.seller_amount),
    eligible: t.metadata?.payluk_environment === environment && t.metadata?.payluk_fee_mode === 'native_commission_v1' &&
      ['paid','completed'].includes(t.status) && !!t.payluk_tx_ref && !!t.payluk_escrow_id &&
      Date.parse(t.metadata?.event_release_not_before || '') <= Date.now() &&
      Number.isSafeInteger(Number(t.metadata?.quantity)) && Number(t.metadata?.quantity) > 0 &&
      currentTickets.filter(ticket => ticket.payment_tx_ref === t.id && ['PAID','USED'].includes(ticket.status)).length === Number(t.metadata.quantity) &&
      !currentTickets.some(ticket => ticket.payment_tx_ref === t.id && (ticket.refund_status || !['PAID','USED'].includes(ticket.status))),
  }));
  const availableKobo = mature && !financialHold ? entries.filter(e => e.eligible && !allocated.has(e.transaction_id)).reduce((n,e)=>n+e.proceeds_kobo,0) : 0;
  const withdrawnKobo = withdrawals.filter(w=>w.status==='success').reduce((n,w)=>n+Number(w.actual_debit_kobo || w.amount_kobo),0);
  const totals = { grossKobo: entries.reduce((n,e)=>n+e.gross_kobo,0), commissionKobo: entries.reduce((n,e)=>n+e.commission_kobo,0), providerFeeKobo: entries.reduce((n,e)=>n+e.provider_fee_kobo,0), availableKobo, withdrawnKobo,
    heldKobo: Math.max(0,entries.reduce((n,e)=>n+e.proceeds_kobo,0)-availableKobo-withdrawnKobo) };
  return { enabled: true, provider: 'payluk', domain: environment, sandboxOnly: environment === 'test', totals, entries, withdrawals, eligibleAt, financialHold,
    payoutAccount: bank ? { bankName: bank.bankName, accountName: bank.accountName, lastFour: bank.lastFour } : null,
    withdrawalsEnabled: paylukEventWithdrawalsEnabled() && !!bank, disabledReason: !paylukEventWithdrawalsEnabled() ? 'Event withdrawals are not available yet.' : !bank ? 'Add a verified payout account in Settings.' : null };
}

export async function reconcilePaylukEventWithdrawal(reference: string, owner: string) {
  const result = await supabaseAdmin.from('payluk_event_withdrawals').select('*').eq('reference', reference).eq('organizer_id', owner).maybeSingle();
  check(result.error);
  const row = result.data;
  if (!row || !row.provider_reference || !['submitting','pending'].includes(row.status)) return;
  if (!paylukEventFinanceEnabled() || row.domain !== paylukEventEnvironment()) throw new EventFinanceError('Event withdrawal reconciliation is unavailable.', 503);
  const remote = await PaylukService.getWithdrawalDetails(await getPaylukCustomerId(owner), row.provider_reference);
  const debit = remote.debit == null ? null : kobo(remote.debit);
  const status = remote.outcome === 'success' && debit != null && debit > 0 && debit === Number(row.expected_debit_kobo) && debit <= Number(row.amount_kobo) ? 'success' : remote.outcome === 'pending' ? 'pending' : 'review';
  const saved = await supabaseAdmin.from('payluk_event_withdrawals').update({ status, actual_debit_kobo: status==='success' ? debit : null, updated_at:new Date().toISOString() }).eq('id',row.id).in('status',['submitting','pending']);
  check(saved.error);
}

export async function requestPaylukEventWithdrawal(eventId: string, owner: string, input: { confirm?: boolean; expectedAmountKobo?: number }) {
  if (!paylukEventWithdrawalsEnabled()) throw new EventFinanceError('Event withdrawals are not enabled for this deployment.',503);
  const summary = await getPaylukEventEarnings(eventId,owner);
  if (input.confirm !== true || !Number.isSafeInteger(input.expectedAmountKobo) || input.expectedAmountKobo !== summary.totals.availableKobo || input.expectedAmountKobo! < 100000) throw new EventFinanceError('Refresh and confirm the available event balance (minimum ₦1,000).');
  const bank = await payoutAccount(owner);
  if (!bank) throw new EventFinanceError('Add a verified payout account in Settings.');
  const reserved = await supabaseAdmin.rpc('reserve_payluk_event_withdrawal',{ p_event_id:eventId,p_owner:owner,p_expected:input.expectedAmountKobo,p_bank_name:bank.bankName,p_account_name:bank.accountName,p_last_four:bank.lastFour,p_domain:summary.domain });
  if (reserved.error || !reserved.data) throw new EventFinanceError('The balance changed or has a refund/dispute hold. Refresh before retrying.');
  const intent = reserved.data;
  const snapshot = await supabaseAdmin.from('payluk_event_withdrawals').update({ bank_fingerprint: bankFingerprint(bank) }).eq('id', intent.id).eq('status', 'reserved').select('id');
  check(snapshot.error);
  if (snapshot.data?.length !== 1) throw new EventFinanceError('Withdrawal reservation changed.');
  return intent;
}

function bankFingerprint(bank: { bankCode: string; accountNumber: string; accountName: string }) {
  return createHash('sha256').update(JSON.stringify([bank.bankCode, bank.accountNumber, bank.accountName])).digest('hex');
}

/** Advance at most one escrow per invocation. Unknown bank submissions are reconciliation-only. */
export async function advancePaylukEventWithdrawal(reference: string, owner: string, eventId?: string) {
  if (!paylukEventWithdrawalsEnabled()) throw new EventFinanceError('Event withdrawals are disabled.', 503);
  const original = await supabaseAdmin.from('payluk_event_withdrawals').select('*').eq('reference', reference).eq('organizer_id', owner).maybeSingle();
  check(original.error);
  if (!original.data || (eventId && original.data.event_id !== eventId)) throw new EventFinanceError('Withdrawal not found.', 404);
  const environment = paylukEventEnvironment();
  if (!environment || original.data.domain !== environment) throw new EventFinanceError('Withdrawal environment does not match this deployment.', 409);
  const token = randomUUID();
  const leased = await supabaseAdmin.rpc('lease_payluk_event_withdrawal', { p_reference: reference, p_owner: owner, p_token: token, p_domain: environment });
  check(leased.error);
  const intent = leased.data;
  if (!intent) return original.data;
  const save = async (values: Record<string, unknown>) => {
    const result = await supabaseAdmin.from('payluk_event_withdrawals').update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', intent.id).eq('processing_token', token).gt('processing_until', new Date().toISOString()).select('id');
    check(result.error);
    if (result.data?.length !== 1) throw new Error('Worker lease expired.');
  };
  const checkpoint = async (transaction: string, status: string) => {
    const result = await supabaseAdmin.rpc('checkpoint_payluk_event_release', { p_withdrawal: intent.id, p_token: token, p_transaction: transaction, p_status: status });
    check(result.error);
    if (result.data !== true) throw new Error('Release checkpoint changed.');
  };
  try {
    // A known transfer is only read, even if the event/bank later changes.
    if (intent.provider_reference) {
      await reconcilePaylukEventWithdrawal(reference, owner);
      return intent;
    }
    if (intent.transfer_started_at) { await save({ status: 'review' }); return intent; }
    const summary = await getPaylukEventEarnings(intent.event_id, owner);
    if (!summary.eligibleAt || Date.parse(summary.eligibleAt) > Date.now() || summary.financialHold) throw new WithdrawalReviewRequired('Event maturity or financial hold changed.');
    const ev = await supabaseAdmin.from('events').select('status').eq('id', intent.event_id).single();
    check(ev.error);
    if (ev.data?.status === 'CANCELLED') throw new WithdrawalReviewRequired('Event cancelled.');
    const bank = await payoutAccount(owner);
    if (!bank || !intent.bank_fingerprint || bankFingerprint(bank) !== intent.bank_fingerprint) throw new WithdrawalReviewRequired('Payout account changed.');
    const allocations = await supabaseAdmin.from('payluk_event_allocations').select('*').eq('withdrawal_id', intent.id).order('transaction_id');
    check(allocations.error);
    const rows = allocations.data || [];
    if (!rows.length || rows.some(a => a.release_status === 'review' || !summary.entries.some(e => e.transaction_id === a.transaction_id && e.eligible && e.proceeds_kobo === Number(a.amount_kobo))) ||
      rows.reduce((sum, a) => sum + Number(a.amount_kobo), 0) !== Number(intent.amount_kobo)) throw new WithdrawalReviewRequired('Reserved order changed.');
    const customer = await getPaylukCustomerId(owner);
    const allocation = rows.find(a => a.release_status !== 'released');
    if (allocation) {
      const order = await supabaseAdmin.from('escrow_transactions').select('*').eq('id', allocation.transaction_id).single();
      check(order.error);
      const tx = order.data;
      let escrow = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
      const matches = () => escrow.id === tx.payluk_escrow_id && (escrow as unknown as { environment: string }).environment === environment && paylukAmountsMatch(tx, escrow) && kobo(Number(tx.amount) - Number(escrow.fee)) === Number(allocation.amount_kobo);
      if (!matches()) throw new WithdrawalReviewRequired('Provider settlement mismatch.');
      if (escrow.status === 'ONGOING') {
        // A previous unknown claim must never be reissued. Verify it, then retain for review if still open.
        if (allocation.release_status === 'claiming') { await checkpoint(tx.id, 'review'); throw new WithdrawalReviewRequired('Claim outcome requires review.'); }
        if (escrow.state !== 'OPENED') throw new WithdrawalReviewRequired('Provider escrow is not open.');
        const claimAt = paylukEventClaimAvailableAt(escrow);
        if (claimAt === null) throw new WithdrawalReviewRequired('Provider claim window is unavailable.');
        // Payment can arrive after checkout creation and delivery days round up.
        // Wait for the provider window without recording an attempted release.
        if (claimAt > Date.now()) {
          await save({ next_attempt_at: new Date(claimAt).toISOString() });
          return intent;
        }
        await checkpoint(tx.id, 'claiming');
        await PaylukService.claimFunds(customer, tx.payluk_tx_ref);
        escrow = await PaylukService.verifyEscrow(tx.payluk_tx_ref);
      }
      if (!matches() || escrow.state !== 'CLOSED' || !['COMPLETED', 'CLAIMED'].includes(escrow.status)) throw new WithdrawalReviewRequired('Escrow release is not confirmed.');
      await checkpoint(tx.id, 'released');
      return intent;
    }
    // Persist before any bank intent request. A crash/timeout here cannot create another intent.
    await save({ transfer_started_at: new Date().toISOString() });
    const outcome = await PaylukService.withdrawToBank({ sellerPaylukCustomerId: customer, amount: Number(intent.amount_kobo) / 100,
      yrdlyAvailableBalance: Number(intent.amount_kobo) / 100, bankCode: bank.bankCode, bankName: bank.bankName,
      accountNumber: bank.accountNumber, accountName: bank.accountName, reference: intent.reference,
      onIntentReady: async (providerReference, quote) => {
        const current = await getPaylukEventEarnings(intent.event_id, owner);
        const currentBank = await payoutAccount(owner);
        const currentEvent = await supabaseAdmin.from('events').select('status').eq('id', intent.event_id).single(); check(currentEvent.error);
        if (!current.eligibleAt || Date.parse(current.eligibleAt) > Date.now() || current.financialHold || currentEvent.data?.status === 'CANCELLED' ||
          !currentBank || bankFingerprint(currentBank) !== intent.bank_fingerprint || kobo(quote.amount + quote.fee) > Number(intent.amount_kobo)) throw new WithdrawalReviewRequired('Withdrawal authorization changed.');
        await save({ provider_reference: providerReference, expected_debit_kobo: kobo(quote.amount + quote.fee), status: 'pending' });
      } });
    if (outcome.outcome === 'failed') await save({ status: 'review' });
    // Reconciliation runs in the next bounded invocation, never by submitting another transfer.
  } catch (error) {
    // Transient read failures and lost claim responses retain their checkpoint for reconciliation.
    // Definitive eligibility failures leave the automatic queue while keeping every allocation reserved.
    if (error instanceof WithdrawalReviewRequired || intent.transfer_started_at) await save({ status: 'review' });
  } finally {
    const unlocked = await supabaseAdmin.from('payluk_event_withdrawals').update({ processing_token: null, processing_until: null })
      .eq('id', intent.id).eq('processing_token', token);
    check(unlocked.error);
  }
  const saved = await supabaseAdmin.from('payluk_event_withdrawals').select('*').eq('id', intent.id).single(); check(saved.error);
  return saved.data;
}

export async function advanceNextPaylukEventWithdrawal() {
  const environment = paylukEventEnvironment();
  if (!environment || !paylukEventFinanceEnabled()) return { processed: 0 };
  if (!paylukEventWithdrawalsEnabled()) {
    // Disabling new releases must not abandon a bank transfer already submitted.
    const pending = await supabaseAdmin.from('payluk_event_withdrawals').select('reference,organizer_id').eq('domain', environment)
      .in('status', ['submitting','pending']).not('provider_reference','is',null)
      .order('updated_at').limit(1).maybeSingle();
    check(pending.error);
    if (!pending.data) return { processed: 0 };
    await reconcilePaylukEventWithdrawal(pending.data.reference,pending.data.organizer_id);
    return { processed: 0, reconciled: 1 };
  }
  const next = await supabaseAdmin.from('payluk_event_withdrawals').select('reference,organizer_id').eq('domain', environment)
    .in('status', ['reserved', 'submitting', 'pending']).lte('next_attempt_at', new Date().toISOString()).order('next_attempt_at').limit(1).maybeSingle();
  check(next.error);
  if (!next.data) return { processed: 0 };
  await advancePaylukEventWithdrawal(next.data.reference, next.data.organizer_id);
  return { processed: 1 };
}

export async function requestPaylukTicketRefund(ticketId:string,owner:string,reason:string) {
  if (!paylukEventFinanceEnabled()) throw new EventFinanceError('Event refunds are not enabled for this deployment.',503);
  if(typeof reason!=='string'||reason.trim().length<5||reason.length>2000) throw new EventFinanceError('Provide a refund reason.',400);
  const result=await supabaseAdmin.rpc('request_payluk_event_refund',{p_ticket_id:ticketId,p_owner:owner,p_reason:reason.trim(),p_domain:paylukEventEnvironment()});
  if(result.error) throw new EventFinanceError('This refund needs support review because the ticket or payout status changed.');
  return {...result.data,status:'review',requiresSupport:true};
}
