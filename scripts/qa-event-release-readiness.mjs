// Read-only acceptance probe. Never confirms delivery, claims, refunds, or transfers.
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sandboxKeyFromQaFile } from './qa-payluk-sandbox.mjs';

try {
  const content = fs.readFileSync(new URL('../.env.qa', import.meta.url), 'utf8');
  const env = dotenv.parse(content);
  if (env.NEXT_PUBLIC_SUPABASE_URL !== 'https://jxgpvvehajxegeeozlnl.supabase.co') throw new Error('Exact QA project required');
  const id = process.argv[2];
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('Provide a QA ticket order UUID');
  const key = sandboxKeyFromQaFile(content);
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: tx, error } = await db.from('escrow_transactions')
    .select('id,item_type,payment_provider,payluk_tx_ref,payluk_escrow_id,amount,commission,seller_amount,status,metadata').eq('id', id).single();
  if (error || tx?.item_type !== 'ticket' || tx.payment_provider !== 'payluk' || tx.metadata?.payluk_environment !== 'test' ||
      tx.metadata?.payluk_fee_mode !== 'native_commission_v1' || !tx.payluk_tx_ref || !tx.payluk_escrow_id) throw new Error('Native QA ticket order required');
  const read = async path => {
    const response = await fetch(`https://staging.api.payluk.ng/v1${path}`, {
      headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    if (!response.ok || body.status >= 400) throw new Error(`Provider read failed (${response.status})`);
    return body.data;
  };
  const escrow = await read(`/escrow/verify/${encodeURIComponent(tx.payluk_tx_ref)}`);
  if (escrow.id !== tx.payluk_escrow_id || Number(escrow.amount) !== Number(tx.amount) || escrow.whoPays !== 'seller' || Number(escrow.additionalFee || 0) !== 0 ||
      !Number.isFinite(Number(escrow.fee)) || Number(escrow.fee) < Number(tx.commission) || Number(escrow.fee) > Number(tx.amount)) throw new Error('Provider contract requires review');
  const numeric = typeof escrow.paidAt === 'number' || /^\d+(\.\d+)?$/.test(String(escrow.paidAt)) ? Number(escrow.paidAt) : null;
  const paid = numeric == null ? Date.parse(escrow.paidAt || '') : numeric < 1e12 ? numeric * 1000 : numeric;
  const unit = { minutes: 60000, hours: 3600000, days: 86400000 }[escrow.deliveryTimeline];
  const window = Number(escrow.maxDelivery);
  const savedHold = Date.parse(tx.metadata?.event_release_not_before || '');
  if (!unit || !Number.isInteger(window) || window < 1 || window > 365 || !Number.isFinite(paid) || !Number.isFinite(savedHold)) throw new Error('Provider timing requires review');
  const event = await db.from('events').select('end_time,status').eq('id', tx.metadata.event_id).single();
  const currentHold = Date.parse(event.data?.end_time || '') + 86400000;
  if (event.error || !Number.isFinite(currentHold)) throw new Error('Current event timing requires review');
  const availableAt = Math.max(paid + window * unit + 86400000, savedHold, currentHold);
  const expectedNet = Math.round((Number(escrow.amount) - Number(escrow.fee)) * 100) / 100;
  const ledger = await read('/merchant/transactions?type=commission&limit=50');
  const entries = Array.isArray(ledger) ? ledger : ledger?.data;
  if (!Array.isArray(entries)) throw new Error('Merchant ledger shape requires review');
  const commissions = entries.filter(row => JSON.stringify(row).includes(tx.payluk_tx_ref))
    .map(row => ({ reference: row.reference, amount: row.amount, status: row.status }));
  console.log(JSON.stringify({ environment: 'test', orderId: id, providerStatus: escrow.status, localStatus: tx.status,
    grossNaira: Number(tx.amount), providerFeeNaira: Number(escrow.fee), expectedCommissionNaira: Number(tx.commission),
    expectedOrganizerNetNaira: expectedNet, ledgerOrganizerNetNaira: Number(tx.seller_amount),
    organizerNetMatches: Math.round(Number(tx.seller_amount) * 100) === Math.round(expectedNet * 100),
    releaseNotBeforeUTC: new Date(availableAt).toISOString(),
    releaseNotBeforeLagos: new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Africa/Lagos' }).format(availableAt),
    timingSatisfied: availableAt <= Date.now() && event.data.status !== 'CANCELLED',
    matchingCommissionsInFirstPage: commissions,
    commissionSearchComplete: Array.isArray(ledger) || ledger.pagination?.isLastPage === true,
    checkedAt: new Date().toISOString(), financialActionSubmitted: false }));
} catch (error) {
  // Do not print provider payloads, identities, keys or sessions.
  console.error(JSON.stringify({ environment: 'test', readOnly: true, failure: error.message?.startsWith('Provider read failed') ? error.message : error.name }));
  process.exitCode = 1;
}
