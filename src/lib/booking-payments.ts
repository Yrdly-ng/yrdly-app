import { supabaseAdmin } from './supabase-admin';

// Booking deposit/escrow checkout + webhook helpers (server side uses supabaseAdmin for idempotency)
const PAYLUK_SECRET = process.env.PAYLUK_SECRET_KEY;
const PAYLUK_BASE = process.env.PAYLUK_BASE_URL || (PAYLUK_SECRET?.startsWith('sk_live_') ? 'https://api.payluk.ng' : 'https://staging.api.payluk.ng');

async function paylukPost(path: string, body: any, custId?: string) {
  if (!PAYLUK_SECRET) throw new Error('PAYLUK_SECRET_KEY missing');
  const h: any = { Authorization: `Bearer ${PAYLUK_SECRET}`, 'Content-Type': 'application/json' };
  if (custId) h['customer-id'] = custId;
  const res = await fetch(`${PAYLUK_BASE}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const j = await res.json().catch(()=>({ status: res.status, message: 'non-json'}));
  if (!res.ok) throw new Error(`Payluk ${path} ${res.status}: ${j.message||JSON.stringify(j)}`);
  return j;
}

export function computeDepositAmount(service: { price?: number|null; deposit_amount?: number|null; deposit_percent?: number|null }): number | null {
  if (service.deposit_amount) return Number(service.deposit_amount);
  if (service.deposit_percent && service.price) return Math.round(Number(service.price) * Number(service.deposit_percent) / 100);
  return null;
}

export async function createCheckoutForBooking(opts: { bookingId: string; amount: number; type: 'deposit'|'full'|'escrow'; customerPaylukId?: string; email?: string; }): Promise<{ reference: string; url?: string }> {
  const reference = `bk_${opts.bookingId}_${opts.type}_${Date.now()}`;
  const { error: insErr } = await supabaseAdmin.from('booking_payments').insert([{ booking_id: opts.bookingId, amount: opts.amount, type: opts.type, status: 'deposit_pending', provider: 'payluk', payluk_reference: reference, escrow_hold: opts.type==='escrow' }]);
  if (insErr) throw new Error(insErr.message);
  await supabaseAdmin.from('bookings').update({ payment_status: 'deposit_pending' }).eq('id', opts.bookingId);
  if (!PAYLUK_SECRET) return { reference };
  try {
    const r = await paylukPost('/v1/payment/intent', { amount: opts.amount, reference, currency: 'NGN', ...(opts.customerPaylukId?{ customerId: opts.customerPaylukId }:{}), ...(opts.email?{ email: opts.email }:{} ) }, opts.customerPaylukId).catch(()=>null);
    const url = r?.data?.checkout_url || r?.data?.authorization_url || r?.data?.url || null;
    if (url) await supabaseAdmin.from('booking_payments').update({ payluk_checkout_url: url }).eq('payluk_reference', reference);
    return { reference, url: url||undefined };
  } catch { return { reference } }
}

// Called by webhook (service role) - idempotent
export async function handlePaylukWebhookEvent(payload: any): Promise<void> {
  const ref: string | undefined = payload?.reference || payload?.data?.reference || payload?.payluk_reference;
  const status: string = String(payload?.status || payload?.data?.status || '').toLowerCase();
  const success = status === 'successful' || status === 'success' || status === 'paid' || payload?.event === 'payment.success';
  if (!ref) return;
  const { data: payment } = await supabaseAdmin.from('booking_payments').select('id, booking_id, type, status').eq('payluk_reference', ref).single();
  if (!payment) return; // unknown
  if (['deposit_paid','fully_paid','escrow_held'].includes((payment as any).status) && success) return;
  const newPaymentStatus = success ? (payment.type==='escrow' ? 'escrow_held' : payment.type==='deposit' ? 'deposit_paid' : 'fully_paid') : 'failed';
  await supabaseAdmin.from('booking_payments').update({ status: newPaymentStatus, paid_at: success? new Date().toISOString(): null }).eq('id', payment.id);
  await supabaseAdmin.from('bookings').update({ payment_status: newPaymentStatus }).eq('id', payment.booking_id);
}

export function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  // Payluk HMAC: hex sha256
  try {
    // dynamic import to avoid node dep in client
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    // also support base64 variant
    const expectedB64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return signature === expected || signature === expectedB64 || signature.includes(expected);
  } catch { return false; }
}
