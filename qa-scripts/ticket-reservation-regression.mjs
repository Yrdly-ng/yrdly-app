// Real concurrent database requests; no provider calls or funded ledger changes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
assert.equal(projectRef, 'jxgpvvehajxegeeozlnl');
const seed = await readOutput();
const admin = createAdminClient(env);
const eventId = randomUUID(), tierId = randomUUID();
const results = [];
const check = (name, run) => run().then(() => { results.push({ name, passed: true }); console.log(`PASS ${name}`); });
const ok = result => { if (result.error) throw new Error(`QA operation failed (${result.error.code})`); return result.data; };
const input = buyer => ({ event_id: eventId, tier_id: tierId, buyer_id: buyer, quantity: 1, attendee_name: QA_PREFIX, attendee_email: 'ticket-qa@example.test' });
try {
  const owner = ok(await admin.auth.admin.getUserById(seed.users.organizer)).user;
  assert.equal(owner.user_metadata.qa_prefix, QA_PREFIX);
  ok(await admin.from('events').insert({ id: eventId, organizer_id: seed.users.organizer, title: `${QA_PREFIX} reservation concurrency`, start_time: new Date(Date.now()+86400000).toISOString(), end_time: new Date(Date.now()+2*86400000).toISOString(), status: 'PUBLISHED', moderation_status: 'approved' }));
  ok(await admin.from('ticket_tiers').insert({ id: tierId, event_id: eventId, name: `${QA_PREFIX} last paid seat`, price: 2500, capacity: 1 }));
  let winning;
  await check('concurrent buyers reserve the last paid seat exactly once', async () => {
    const responses = await Promise.all([seed.users.buyer,seed.users.seller].map(buyer => admin.rpc('reserve_ticket_checkout', { p_payload: input(buyer) })));
    assert.equal(responses.filter(r => !r.error).length, 1);
    assert.equal(responses.filter(r => r.error?.message === 'ticket_tier_sold_out').length, 1);
    winning = responses.find(r => !r.error).data.transaction;
    assert.equal(ok(await admin.from('ticket_checkout_reservations').select('remaining').eq('tier_id',tierId)).reduce((n,r)=>n+r.remaining,0),1);
  });
  await check('same buyer retries return the existing transaction', async () => {
    const again = ok(await admin.rpc('reserve_ticket_checkout', { p_payload: input(winning.buyer_id) }));
    assert.equal(again.newly_created,false); assert.equal(again.transaction.id,winning.id);
  });
  await check('unpaid cancellation permits a fresh reservation', async () => {
    ok(await admin.rpc('release_ticket_checkout',{p_transaction_id:winning.id}));
    const responses = await Promise.all([0,1].map(()=>admin.rpc('reserve_ticket_checkout',{p_payload:input(seed.users.buyer)})));
    responses.forEach(ok);
    assert.equal(responses[0].data.transaction.id,responses[1].data.transaction.id);
    assert.equal(responses.filter(r=>r.data.newly_created).length,1);
    winning=responses[0].data.transaction;
  });
  await check('simultaneous setup claims have one winner', async () => {
    const responses = await Promise.all([0,1].map(()=>admin.from('escrow_transactions')
      .update({status:'creating_escrow',creating_escrow_started_at:new Date().toISOString()})
      .eq('id',winning.id).eq('status','pending').is('payluk_escrow_id',null).select('id')));
    responses.forEach(ok);assert.equal(responses.reduce((n,r)=>n+r.data.length,0),1);
  });
  await check('ordinary cancellation cannot release in-flight provider setup', async () => {
    const r=await admin.rpc('release_ticket_checkout',{p_transaction_id:winning.id});
    assert.equal(r.error?.message,'ticket_checkout_setup_in_progress');
  });
  await check('unknown provider creation stays held for reconciliation', async () => {
    ok(await admin.from('escrow_transactions').update({status:'reconciling'}).eq('id',winning.id));
    const r=await admin.rpc('release_ticket_checkout',{p_transaction_id:winning.id});
    assert.equal(r.error?.message,'unknown_provider_creation_requires_review');
    assert.equal(ok(await admin.from('ticket_checkout_reservations').select('remaining').eq('transaction_id',winning.id).single()).remaining,1);
  });
  const publicClient=createClient(env.SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
  await check('anonymous caller cannot reserve paid seats', async () => {
    const r=await publicClient.rpc('reserve_ticket_checkout',{p_payload:input(seed.users.buyer)});assert.equal(r.error?.code,'42501');
  });
} finally {
  // These IDs were created here and never sent to Payluk. No existing order is touched.
  ok(await admin.from('escrow_transactions').delete().eq('item_type','ticket').eq('item_id',tierId));
  ok(await admin.from('ticket_tiers').delete().eq('id',tierId));
  ok(await admin.from('events').delete().eq('id',eventId));
  await writeFile('.qa-artifacts/ticket-reservation-regression.json',JSON.stringify({projectRef,checkedAt:new Date().toISOString(),results},null,2),{mode:0o600});
}
