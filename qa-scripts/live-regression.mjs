import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient, ROOT } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
const seed = await readOutput();
const admin = createAdminClient(env);
const base = env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
if (new URL(base).hostname !== 'localhost') throw new Error('Live regression only targets localhost');
const actors = {};
const results = [];
const ids = { event: randomUUID(), tier: randomUUID(), post: randomUUID(), conversation: randomUUID(), message: randomUUID() };
const ok = (r) => { if (r.error) throw new Error(`Database operation failed (${r.error.code || 'unknown'})`); return r.data; };
const denied = r => assert.ok(r.error || !r.data?.length, 'Unauthorized operation changed a row');
async function check(name, run) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, passed: false, reason: e instanceof assert.AssertionError ? e.message : String(e.message).replace(/https?:\/\/\S+/g, '[URL]') }); console.log(`FAIL ${name}`); }
}
async function api(role, path, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${actors[role].token}` } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }) });
  return { status: response.status, body: await response.json() };
}
try {
  for (const role of ['buyer', 'seller', 'organizer', 'admin', 'non_admin']) {
    const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const data = ok(await client.auth.signInWithPassword({ email: env[`QA_${role.toUpperCase()}_EMAIL`], password: env[`QA_${role.toUpperCase()}_PASSWORD`] }));
    assert.equal(data.user.id, seed.users[role]);
    actors[role] = { client, token: data.session.access_token };
    results.push({ name: `real Auth login: ${role}`, passed: true });
  }
  const buyer = actors.buyer.client, seller = actors.seller.client;
  const anonymous = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await check('anonymous cannot read private profiles', async () => assert.equal(ok(await anonymous.from('users').select('id,email')).length, 0));
  await check('buyer cannot read another private profile', async () => assert.equal(ok(await buyer.from('users').select('id,email').eq('id', seed.users.seller)).length, 0));
  await check('buyer can read own private profile', async () => assert.equal(ok(await buyer.from('users').select('id,email').eq('id', seed.users.buyer)).length, 1));
  await check('anonymous public profiles omit email and phone', async () => { const rows = ok(await anonymous.from('public_profiles').select('*')); assert.ok(rows.length >= 5); assert.ok(rows.every(r => !('email' in r) && !('phone' in r) && !('payluk_customer_id' in r))); });
  const ownTrust = ok(await buyer.from('users').select('is_admin,role,verified_seller,phone_verified,rating').eq('id', seed.users.buyer).single());
  for (const [field, value] of Object.entries({ is_admin: !ownTrust.is_admin, role: ownTrust.role === 'admin' ? 'user' : 'admin', verified_seller: !ownTrust.verified_seller, phone_verified: !ownTrust.phone_verified, payluk_customer_id: 'qa-forged-customer', rating: ownTrust.rating === 5 ? 0 : 5 })) {
    await check(`profile trust field protected: ${field}`, async () => denied(await buyer.from('users').update({ [field]: value }).eq('id', seed.users.buyer).select('id')));
  }
  await check('own display name remains editable', async () => { assert.equal(ok(await buyer.from('users').update({ name: 'YRDLY-QA Buyer' }).eq('id', seed.users.buyer).select('id')).length, 1); });
  await check('buyer cannot forge escrow state', async () => denied(await buyer.from('escrow_transactions').update({ status: 'paid' }).eq('id', seed.transactions.completedSale).select('id')));
  for (const input of [{ p_ticket_input: 'QA-FORGED' }, { p_ticket_id: randomUUID() }]) {
    await check(`ordinary user blocked from legacy scan RPC: ${Object.keys(input)[0]}`, async () => {
      const r = await buyer.rpc('scan_ticket', { ...input, p_scanner_id: seed.users.organizer, p_event_id: seed.events.free });
      assert.equal(r.error?.code, '42501');
    });
  }
  await check('ordinary user blocked from notification forgery RPC', async () => { const r = await buyer.rpc('create_notification', { p_user_id: seed.users.seller, p_type: 'message', p_title: 'QA', p_message: 'QA' }); assert.equal(r.error?.code, '42501'); });
  await check('unauthenticated ticket checkout denied', async () => assert.equal((await api(null, '/api/events/tickets/purchase')).status, 401));
  await check('unauthenticated ticket scan denied', async () => assert.equal((await api(null, '/api/events/checkin')).status, 401));
  for (const quantity of ['not-a-number', 0, -1, 1.5, true, null, 6]) {
    await check(`ticket checkout rejects invalid quantity: ${JSON.stringify(quantity)}`, async () => assert.equal((await api('buyer', '/api/events/tickets/purchase', {
      event_id: seed.events.free, tier_id: seed.ticketTiers.free, attendee_name: 'YRDLY-QA Validation', attendee_email: env.QA_BUYER_EMAIL, quantity,
    })).status, 400));
  }
  await check('non-organizer ticket scan denied', async () => assert.equal((await api('buyer', '/api/events/checkin', { event_id: seed.events.free, ticket_code: 'QA-FORGED' })).status, 403));

  const sourceEvent = ok(await admin.from('events').select('*').eq('id', seed.events.free).single());
  ok(await admin.from('events').insert({ ...sourceEvent, id: ids.event, title: 'YRDLY-QA Live Regression', attendee_count: 0 }));
  ok(await admin.from('ticket_tiers').insert({ id: ids.tier, event_id: ids.event, name: 'YRDLY-QA Runtime Free', price: 0, capacity: 2, sold: 0, is_visible: true }));
  const sourcePost = ok(await admin.from('posts').select('*').eq('id', seed.listings.available).single());
  ok(await admin.from('posts').insert({ ...sourcePost, id: ids.post, liked_by: [], title: 'YRDLY-QA Live Regression' }));
  await check('public post author relation resolves after private profile lockdown', async () => { const row = ok(await buyer.from('posts').select('id,author:public_profiles!posts_user_id_fkey(name)').eq('id', ids.post).single()); assert.ok(row.author?.name); });
  await check('like actor cannot be forged', async () => assert.ok((await buyer.rpc('toggle_post_like', { p_post_id: ids.post, p_user_id: seed.users.seller })).error));
  await check('concurrent likes preserve both actors without duplicates', async () => {
    for (const r of await Promise.all([buyer.rpc('toggle_post_like', { p_post_id: ids.post, p_user_id: seed.users.buyer }), seller.rpc('toggle_post_like', { p_post_id: ids.post, p_user_id: seed.users.seller })])) ok(r);
    const row = ok(await admin.from('posts').select('liked_by').eq('id', ids.post).single()); assert.equal(row.liked_by.length, 2); assert.equal(new Set(row.liked_by).size, 2);
  });
  ok(await admin.from('conversations').insert({ id: ids.conversation, participant_ids: [seed.users.buyer, seed.users.seller], type: 'friend', created_by: seed.users.buyer }));
  await check('chat participant can send a message', async () => ok(await buyer.from('messages').insert({ id: ids.message, conversation_id: ids.conversation, sender_id: seed.users.buyer, text: 'YRDLY-QA message' })));
  await check('chat outsider cannot read messages', async () => assert.equal(ok(await actors.non_admin.client.from('messages').select('id').eq('conversation_id', ids.conversation)).length, 0));
  await check('chat outsider cannot send a message', async () => assert.ok((await actors.non_admin.client.from('messages').insert({ conversation_id: ids.conversation, sender_id: seed.users.non_admin, text: 'QA forged' })).error));
  await check('chat participant cannot forge sender', async () => assert.ok((await buyer.from('messages').insert({ conversation_id: ids.conversation, sender_id: seed.users.seller, text: 'QA forged' })).error));
  await check('chat membership cannot be changed by participant', async () => denied(await buyer.from('conversations').update({ participant_ids: [seed.users.buyer, seed.users.non_admin] }).eq('id', ids.conversation).select('id')));
  await check('sender can edit recent message', async () => assert.equal(ok(await buyer.from('messages').update({ text: 'YRDLY-QA edited' }).eq('id', ids.message).select('id')).length, 1));
  await check('recipient can mark own read receipt', async () => assert.equal(ok(await seller.from('messages').update({ read_by: [seed.users.seller] }).eq('id', ids.message).select('id')).length, 1));
  await check('recipient cannot edit sender text', async () => denied(await seller.from('messages').update({ text: 'QA forged edit' }).eq('id', ids.message).select('id')));
  const mediaPath = `chat/${ids.conversation}/${seed.users.buyer}-qa.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6foAAAAASUVORK5CYII=', 'base64');
  await check('chat member can upload private image', async () => ok(await buyer.storage.from('chat-images').upload(mediaPath, png, { contentType: 'image/png' })));
  await check('chat recipient can sign private image', async () => assert.ok(ok(await seller.storage.from('chat-images').createSignedUrl(mediaPath, 60)).signedUrl));
  await check('chat outsider cannot sign private image', async () => assert.ok((await actors.non_admin.client.storage.from('chat-images').createSignedUrl(mediaPath, 60)).error));
  await check('chat image cannot be fetched from public endpoint', async () => { const r = await fetch(buyer.storage.from('chat-images').getPublicUrl(mediaPath).data.publicUrl); assert.notEqual(r.status, 200); });
  const order = { event_id: ids.event, tier_id: ids.tier, attendee_name: 'YRDLY-QA Runtime', attendee_email: env.QA_BUYER_EMAIL, quantity: 1 };
  await check('free ticket purchase succeeds', async () => { const r = await api('buyer', '/api/events/tickets/purchase', order); assert.equal(r.status, 200); });
  const ticket = ok(await admin.from('tickets').select('*').eq('event_id', ids.event).eq('buyer_id', seed.users.buyer).single());
  await check('direct paid-ticket forgery denied', async () => assert.ok((await buyer.from('tickets').insert({ ...ticket, id: randomUUID(), ticket_code: `QA-FORGED-${randomUUID()}` })).error));
  await check('two simultaneous organiser scans admit exactly once', async () => { const responses = await Promise.all([api('organizer', '/api/events/checkin', { event_id: ids.event, ticket_code: ticket.ticket_code }), api('organizer', '/api/events/checkin', { event_id: ids.event, ticket_code: ticket.ticket_code })]); assert.equal(responses.filter(r => r.status === 200 && r.body.valid).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 1); });
  await check('last free ticket cannot be oversold by concurrent buyers', async () => { const responses = await Promise.all([api('seller', '/api/events/tickets/purchase', order), api('non_admin', '/api/events/tickets/purchase', order)]); assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 1); assert.equal(ok(await admin.from('ticket_tiers').select('sold').eq('id', ids.tier).single()).sold, 2); });
  await check('event attendee count matches issued live tickets', async () => assert.equal(ok(await admin.from('events').select('attendee_count').eq('id', ids.event).single()).attendee_count, 2));
  await admin.storage.from('chat-images').remove([mediaPath]);
} finally {
  for (const [table, column, id] of [['tickets', 'event_id', ids.event], ['ticket_tiers', 'event_id', ids.event], ['events', 'id', ids.event], ['messages', 'conversation_id', ids.conversation], ['conversations', 'id', ids.conversation], ['posts', 'id', ids.post]]) {
    const r = await admin.from(table).delete().eq(column, id);
    if (r.error) results.push({ name: `cleanup ${table}`, passed: false, reason: r.error.code });
  }
  await mkdir(`${ROOT}/.qa-artifacts`, { recursive: true });
  await writeFile(`${ROOT}/.qa-artifacts/live-regression.json`, JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), results }, null, 2));
  const failed = results.filter(r => !r.passed);
  console.log(`Live regression: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
