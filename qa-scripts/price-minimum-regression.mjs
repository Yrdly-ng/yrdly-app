// Isolated QA fixtures only. No provider requests or paid records are changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readQaEnv, readOutput, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
const seed = await readOutput(), admin = createAdminClient(env), results = [];
const business = randomUUID(), post = randomUUID(), giveaway = randomUUID(), catalog = randomUUID();
const event = randomUUID(), tier = randomUUID(), freeTier = randomUUID(), service = randomUUID(), quote = randomUUID();
const booking = randomUUID();
const ok = r => { if (r.error) throw Error(`QA database operation failed (${r.error.code}): ${r.error.message}`); return r.data; };
const denied = r => assert.equal(r.error?.code, '23514');
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
const listing = { id: post, user_id: seed.users.seller, author_name: QA_PREFIX, text: QA_PREFIX, title: QA_PREFIX, category: 'For Sale', moderation_status: 'approved', is_sold: false };
const serviceInput = { id: service, business_id: business, name: QA_PREFIX, duration_minutes: 60, is_active: true };
await mkdir('.qa-artifacts', { recursive: true });
try {
  for (const role of ['seller','buyer','organizer']) assert.equal(ok(await admin.auth.admin.getUserById(seed.users[role])).user.user_metadata.qa_prefix, QA_PREFIX);
  ok(await admin.from('businesses').insert({ id: business, owner_id: seed.users.seller, name: `${QA_PREFIX} price policy`, category: 'Other', location: { state: 'Lagos' }, is_active: true, moderation_status: 'approved' }));
  await check('new marketplace prices below 1200 and missing prices are rejected', async () => {
    denied(await admin.from('posts').insert({ ...listing, price: 1199.99 }));
    denied(await admin.from('posts').insert(listing));
    ok(await admin.from('posts').insert({ ...listing, price: 1200 }));
  });
  await check('marketplace edits cannot lower a paid price; free giveaways remain', async () => {
    denied(await admin.from('posts').update({ price: 950 }).eq('id', post));
    ok(await admin.from('posts').insert({ ...listing, id: giveaway, category: 'Giveaway', price: 0 }));
    denied(await admin.from('posts').update({ category: 'For Sale' }).eq('id', giveaway));
  });
  await check('catalog price floor applies to insert and update', async () => {
    const input = { id: catalog, business_id: business, title: QA_PREFIX, quantity: 2, inventory_count: 2, in_stock: true };
    denied(await admin.from('catalog_items').insert({ ...input, price: 1199.99 }));
    ok(await admin.from('catalog_items').insert({ ...input, price: 1200 }));
    denied(await admin.from('catalog_items').update({ price: 0 }).eq('id', catalog));
  });
  ok(await admin.from('events').insert({ id: event, organizer_id: seed.users.organizer, title: QA_PREFIX, start_time: new Date(Date.now()+86400000).toISOString(), end_time: new Date(Date.now()+2*86400000).toISOString(), status: 'PUBLISHED', moderation_status: 'approved' }));
  await check('paid tiers require 1200 while free tiers remain', async () => {
    denied(await admin.from('ticket_tiers').insert({ id: tier, event_id: event, name: QA_PREFIX, price: 1199.99, capacity: 5 }));
    ok(await admin.from('ticket_tiers').insert([{ id: tier, event_id: event, name: QA_PREFIX, price: 1200, capacity: 5 }, { id: freeTier, event_id: event, name: QA_PREFIX, price: 0, capacity: 5 }]));
    denied(await admin.from('ticket_tiers').update({ price: 1000 }).eq('id', tier));
  });
  await check('service minimum preserves free and quote-only services', async () => {
    denied(await admin.from('service_offerings').insert({ ...serviceInput, price: 1199.99 }));
    ok(await admin.from('service_offerings').insert({ ...serviceInput, price: null }));
    ok(await admin.from('service_offerings').update({ price: 0 }).eq('id', service));
    ok(await admin.from('service_offerings').update({ price: 1200 }).eq('id', service));
  });
  await check('fixed and percentage deposits must independently reach 1200', async () => {
    denied(await admin.from('service_offerings').update({ deposit_required: true, deposit_amount: 1000 }).eq('id', service));
    denied(await admin.from('service_offerings').update({ deposit_required: true, deposit_amount: null, deposit_percent: 50 }).eq('id', service));
    ok(await admin.from('service_offerings').update({ deposit_required: true, deposit_amount: 1200 }).eq('id', service));
  });
  await check('full payment ignores an unused smaller deposit setting', async () => {
    ok(await admin.from('service_offerings').update({ requires_full_payment: true, deposit_amount: 1000 }).eq('id', service));
    denied(await admin.from('service_offerings').update({ requires_full_payment: false }).eq('id', service));
  });
  await check('quote estimates reject below-minimum and sub-kobo amounts', async () => {
    ok(await admin.from('quote_requests').insert({ id: quote, customer_id: seed.users.buyer, business_id: business, category: 'Other', title: QA_PREFIX, description: QA_PREFIX }));
    denied(await admin.from('quote_requests').update({ estimated_price: 1199.99 }).eq('id', quote));
    denied(await admin.from('quote_requests').update({ estimated_price: 1200.001 }).eq('id', quote));
    ok(await admin.from('quote_requests').update({ estimated_price: 1200, status: 'estimated' }).eq('id', quote));
  });
  await check('checkout rejects stale client prices without consuming catalog stock', async () => {
    const payload = { item_id: catalog, item_type: 'catalog_item', buyer_id: seed.users.buyer, seller_id: seed.users.seller, amount: 1000, commission: 30, total_amount: 1030, seller_amount: 1000, delivery_details: {} };
    denied(await admin.rpc('create_checkout_reservation', { p_payload: payload }));
    assert.equal(ok(await admin.from('catalog_items').select('quantity').eq('id', catalog).single()).quantity, 2);
    const tx = ok(await admin.rpc('create_checkout_reservation', { p_payload: { ...payload, amount: 1200, commission: 36, total_amount: 1236, seller_amount: 1200 } }));
    ok(await admin.rpc('abandon_checkout_reservation', { p_transaction_id: tx }));
    assert.equal(ok(await admin.from('catalog_items').select('quantity').eq('id', catalog).single()).quantity, 2);
  });
  await check('booking checkout accepts the exact minimum using full-payment priority', async () => {
    ok(await admin.from('bookings').insert({ id: booking, business_id: business, service_id: service, customer_id: seed.users.buyer, appointment_time: new Date(Date.now()+86400000).toISOString(), end_time: new Date(Date.now()+90000000).toISOString(), status: 'requested' }));
    const reserved = ok(await admin.rpc('reserve_booking_checkout', { p_booking_id: booking, p_buyer_id: seed.users.buyer, p_type: 'full' }));
    assert.equal(Number(reserved.transaction.amount), 1200);
    assert.equal(Number(reserved.transaction.total_amount), 1236);
  });
  await check('paid ticket reservation accepts 1200 and keeps organizer-paid commission', async () => {
    const reserved = ok(await admin.rpc('reserve_ticket_checkout', { p_payload: { event_id: event, tier_id: tier, buyer_id: seed.users.buyer, quantity: 1 } }));
    assert.equal(Number(reserved.transaction.amount), 1200);
    assert.equal(Number(reserved.transaction.total_amount), 1200);
    assert.equal(Number(reserved.transaction.seller_amount), 1164);
  });
} finally {
  // Only newly created IDs, with no provider requests. Delete in FK order.
  ok(await admin.from('booking_payments').delete().eq('booking_id', booking));
  ok(await admin.from('escrow_transactions').delete().in('item_id', [catalog,post,tier,booking]));
  ok(await admin.from('bookings').delete().eq('id', booking));
  ok(await admin.from('quote_requests').delete().eq('id', quote));
  ok(await admin.from('service_offerings').delete().eq('id', service));
  ok(await admin.from('ticket_tiers').delete().eq('event_id', event));
  ok(await admin.from('events').delete().eq('id', event));
  ok(await admin.from('catalog_items').delete().eq('id', catalog));
  ok(await admin.from('posts').delete().in('id', [post,giveaway]));
  ok(await admin.from('businesses').delete().eq('id', business));
  await writeFile('.qa-artifacts/price-minimum-regression.json', JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
}
