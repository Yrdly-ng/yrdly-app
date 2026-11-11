import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/supabase-admin';
import { PaylukService } from '@/lib/payments/payluk-service';
import { paylukEventClaimAvailableAt } from '@/lib/events/payluk-event-finance';
import { paylukAmountsMatch } from '@/lib/payments/payment-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// QA-only diagnostics. Never ship this route to production main, add
// unrelated records, accept caller-selected IDs, or perform financial writes.
const QA_PROJECT = 'jxgpvvehajxegeeozlnl';
const EVENT_ID = 'd1083e8a-544e-47e2-b585-5777a56afef7';
const ORDER_ID = 'cd0ab635-df12-470d-aeca-c1e5bdfee07b';

const reject = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

function authorized(request: NextRequest): boolean {
  const env = process.env;
  if (env.QA_ENVIRONMENT !== 'staging' ||
      env.QA_EXPECTED_PROJECT_REF !== QA_PROJECT ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${QA_PROJECT}.supabase.co` ||
      env.PAYLUK_BASE_URL !== 'https://staging.api.payluk.ng' ||
      !env.PAYLUK_SECRET_KEY?.startsWith('sk_test_') ||
      !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const expected = env.QA_EVENT_PAYOUT_PROBE_TOKEN;
  const authorization = request.headers.get('authorization');
  if (!expected || expected.length < 40 || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && timingSafeEqual(a,b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return reject();
  try {
    const [event, order, ticket, withdrawals, flags, bank] = await Promise.all([
      supabaseAdmin.from('events').select('id,organizer_id,title,status,end_time,payout_released_at').eq('id', EVENT_ID).single(),
      supabaseAdmin.from('escrow_transactions').select('id,item_type,payment_provider,status,amount,commission,seller_amount,payluk_tx_ref,payluk_escrow_id,metadata,paid_at,completed_at').eq('id', ORDER_ID).single(),
      supabaseAdmin.from('tickets').select('id,status,refund_status,payment_provider,settlement_mode').eq('event_id', EVENT_ID).eq('payment_tx_ref', ORDER_ID),
      supabaseAdmin.from('payluk_event_withdrawals').select('id,status,provider_reference').eq('event_id', EVENT_ID),
      supabaseAdmin.from('payment_reconciliation_flags').select('reason,status').eq('transaction_id', ORDER_ID),
      supabaseAdmin.from('seller_accounts').select('id,verification_status,is_primary,is_active').eq('is_primary',true).eq('is_active',true).eq('verification_status','verified'),
    ]);
    if ([event,order,ticket,withdrawals,flags,bank].some(x=>x.error)) throw new Error('QA staging database read failed');
    if (!event.data || !order.data || order.data.item_type!=='ticket' ||
        order.data.payment_provider!=='payluk' ||
        order.data.metadata?.event_id!==EVENT_ID ||
        order.data.metadata?.payluk_environment!=='test' ||
        order.data.metadata?.payluk_fee_mode!=='native_commission_v1' ||
        !order.data.payluk_tx_ref || !order.data.payluk_escrow_id) throw new Error('Exact funded QA fixture mismatch');
    const escrow = await PaylukService.verifyEscrow(order.data.payluk_tx_ref);
    const providerAvailableAt = paylukEventClaimAvailableAt(escrow);
    const eventAvailableAt = Date.parse(event.data.end_time) + 86400000;
    const savedAvailableAt = Date.parse(order.data.metadata?.event_release_not_before || '');
    const sameEscrow = escrow.id === order.data.payluk_escrow_id && escrow.environment === 'test';
    const sameAmounts = paylukAmountsMatch(order.data, escrow);
    const feeMatches = Number.isFinite(Number(escrow.fee)) && Math.round((Number(order.data.amount) - Number(escrow.fee))*100)===Math.round(Number(order.data.seller_amount)*100);
    const paymentMatches = sameEscrow && sameAmounts && feeMatches;
    const paidTickets = (ticket.data || []).filter(t=>t.status==='PAID' && !t.refund_status && t.payment_provider==='payluk' && t.settlement_mode==='held').length;
    const openFlags = (flags.data || []).filter(x=>x.status!=='resolved').map(x=>x.reason);
    return NextResponse.json({
      checkedAt:new Date().toISOString(),environment:'test',readOnly:true, financialActionsSubmitted:false,
      fixture:{title:event.data.title,eventStatus:event.data.status,orderStatus:order.data.status,
        recordedGrossNaira:Number(order.data.amount),recordedCommissionNaira:Number(order.data.commission),
        recordedNetNaira:Number(order.data.seller_amount),recordedTicketCount:paidTickets,
        existingWithdrawalCount:withdrawals.data?.length||0,existingWithdrawals:(withdrawals.data||[]).map(x=>({status:x.status,hasProviderReference:!!x.provider_reference})),
        verifiedBankAccountForOrganizer:(bank.data||[]).length>0,
        existingPayoutReleasedAt:event.data.payout_released_at,unresolvedReconciliationReasons:openFlags},
      payluk:{status:escrow.status,state:escrow.state,feeNaira:Number(escrow.fee),
        paidAt:escrow.paidAt,deliveryDays:escrow.maxDelivery,deliveryUnit:escrow.deliveryTimeline,
        providerAvailableAt:providerAvailableAt==null?null:new Date(providerAvailableAt).toISOString(),
        providerClaimWindowReached:providerAvailableAt!=null && providerAvailableAt<=Date.now(),
        identityMatches:sameEscrow,amountMatches:sameAmounts,proceedsMatch:feeMatches,
        disputePresent:Array.isArray(escrow.dispute)&&escrow.dispute.length>0},
      hold:{eventAvailableAt:new Date(eventAvailableAt).toISOString(),
        savedAvailableAt:Number.isFinite(savedAvailableAt)?new Date(savedAvailableAt).toISOString():null,
        holdExpired:eventAvailableAt<=Date.now() && savedAvailableAt<=Date.now()},
      payoutGuardReady:paymentMatches && paidTickets===1 && !(withdrawals.data||[]).length &&
        escrow.state==='OPENED' && escrow.status==='ONGOING' && 
        providerAvailableAt!=null && providerAvailableAt<=Date.now() && !escrow.dispute?.length &&
        event.data.status!=='CANCELLED' && eventAvailableAt<=Date.now() && savedAvailableAt<=Date.now()
    },{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    // Never expose provider envelopes, tokens or user data to the caller.
    console.error('[QA Payluk payout probe] Failed safely',error instanceof Error?error.name:'Unknown');
    return NextResponse.json({error:'Sandbox provider check failed; no financial action was attempted.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
