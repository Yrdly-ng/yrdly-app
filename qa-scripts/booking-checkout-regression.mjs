// Concurrent QA database checks only. These fixtures never reach Payluk.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
assert.equal(projectRef, 'jxgpvvehajxegeeozlnl');
await mkdir('.qa-artifacts', { recursive: true });
const seed = await readOutput(), admin = createAdminClient(env);
const businessId = randomUUID(), serviceId = randomUUID(), bookingId = randomUUID();
const results = [];
const ok = r => { if (r.error) throw new Error(`QA database operation failed (${r.error.code}): ${r.error.message}`); return r.data; };
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
const reserve = (buyer = seed.users.buyer, type = 'full') => admin.rpc('reserve_booking_checkout', { p_booking_id: bookingId, p_buyer_id: buyer, p_type: type });
let tx;
try {
  const owner = ok(await admin.auth.admin.getUserById(seed.users.organizer)).user;
  assert.equal(owner.user_metadata.qa_prefix, QA_PREFIX);
  ok(await admin.from('businesses').insert({ id: businessId, owner_id: seed.users.organizer, name: `${QA_PREFIX} Booking Ledger`, category: 'Other', location: { state: 'Lagos' }, is_active: true, moderation_status: 'approved' }));
  ok(await admin.from('service_offerings').insert({ id: serviceId, business_id: businessId, name: `${QA_PREFIX} fractional service`, price: 1234.56, duration_minutes: 60, is_active: true, requires_full_payment: true, deposit_required: true, deposit_amount: 1000 }));
  ok(await admin.from('bookings').insert({ id: bookingId, customer_id: seed.users.buyer, business_id: businessId, service_id: serviceId, appointment_time: new Date(Date.now()+86400000).toISOString(), end_time: new Date(Date.now()+90000000).toISOString(), status: 'requested' }));
  await check('booking checkout rejects a different buyer and a deposit downgrade', async () => {
    assert.equal((await reserve(seed.users.seller)).error?.message, 'booking_not_found');
    assert.equal((await reserve(seed.users.buyer, 'deposit')).error?.message, 'booking_payment_type_mismatch');
  });
  await check('simultaneous booking checkouts create one immutable priced order', async () => {
    const responses = await Promise.all([reserve(), reserve()]); responses.forEach(ok);
    assert.equal(responses.filter(r => r.data.newly_created).length, 1);
    assert.equal(responses[0].data.transaction.id, responses[1].data.transaction.id);
    tx = responses[0].data.transaction;
    assert.equal(Number(tx.amount), 1234.56); assert.equal(Number(tx.commission), 37.04); assert.equal(Number(tx.total_amount), 1271.60);
    const payments = ok(await admin.from('booking_payments').select('*').eq('booking_id', bookingId));
    assert.equal(payments.length, 1); assert.equal(payments[0].escrow_transaction_id, tx.id);
  });
  await check('booking cancellation cannot leave an active payment link', async () => {
    assert.match((await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)).error?.message || '', /Cancel the unpaid checkout/);
    assert.match((await admin.from('bookings').update({ appointment_time: new Date(Date.now()+3*86400000).toISOString() }).eq('id', bookingId)).error?.message || '', /rescheduling this booking/);
  });
  await check('simultaneous booking provider setup has one winner', async () => {
    const responses = await Promise.all([0,1].map(() => admin.from('escrow_transactions').update({ status: 'creating_escrow' }).eq('id', tx.id).eq('status', 'pending').select('id')));
    responses.forEach(ok); assert.equal(responses.reduce((n,r) => n+r.data.length,0),1);
  });
  await check('uncertain booking setup remains reserved on retry', async () => {
    ok(await admin.from('escrow_transactions').update({ status: 'reconciling' }).eq('id', tx.id));
    const retry = ok(await reserve()); assert.equal(retry.transaction.id, tx.id); assert.equal(retry.transaction.status, 'reconciling');
  });
  await check('booking payment callbacks atomically synchronize both ledgers and replay safely', async () => {
    assert.equal(ok(await admin.rpc('apply_escrow_payment', { p_transaction_id: tx.id, p_provider: 'payluk', p_reference: 'qa-database-only' })), 'applied');
    assert.equal(ok(await admin.rpc('apply_escrow_payment', { p_transaction_id: tx.id, p_provider: 'payluk', p_reference: 'qa-database-only' })), 'replay');
    assert.equal(ok(await admin.from('bookings').select('payment_status').eq('id', bookingId).single()).payment_status, 'fully_paid');
    const p = ok(await admin.from('booking_payments').select('status,escrow_hold,paid_at').eq('booking_id', bookingId).single());
    assert.equal(p.status, 'fully_paid'); assert.equal(p.escrow_hold, true); assert.ok(p.paid_at);
  });
  await check('released booking proceeds enter the common seller earnings ledger', async () => {
    ok(await admin.from('escrow_transactions').update({ status: 'completed', seller_amount: 1209.87 }).eq('id', tx.id));
    assert.equal(ok(await admin.from('bookings').select('payment_status').eq('id', bookingId).single()).payment_status, 'escrow_released');
    const earned = ok(await admin.from('escrow_transactions').select('seller_amount').eq('id', tx.id).eq('status', 'completed').neq('item_type','ticket'));
    assert.equal(Number(earned[0].seller_amount), 1209.87);
    assert.equal(ok(await admin.from('booking_payments').select('escrow_hold').eq('booking_id', bookingId).single()).escrow_hold, false);
  });
  await check('refunded booking payment state remains consistent', async () => {
    ok(await admin.from('escrow_transactions').update({ status: 'cancelled' }).eq('id', tx.id));
    assert.equal(ok(await admin.from('bookings').select('payment_status').eq('id', bookingId).single()).payment_status, 'refunded');
    assert.equal(ok(await admin.from('booking_payments').select('status').eq('booking_id', bookingId).single()).status, 'refunded');
  });
  await check('anonymous callers cannot create booking payment orders', async () => {
    const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    assert.equal((await client.rpc('reserve_booking_checkout', { p_booking_id: bookingId, p_buyer_id: seed.users.buyer })).error?.code, '42501');
  });
} finally {
  // Only IDs created by this run; no provider-linked/funded fixture is touched.
  ok(await admin.from('booking_payments').delete().eq('booking_id', bookingId));
  ok(await admin.from('escrow_transactions').delete().eq('item_type','booking').eq('item_id', bookingId));
  ok(await admin.from('bookings').delete().eq('id', bookingId));
  ok(await admin.from('service_offerings').delete().eq('id', serviceId));
  ok(await admin.from('businesses').delete().eq('id', businessId));
  await writeFile('.qa-artifacts/booking-checkout-regression.json', JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
}
