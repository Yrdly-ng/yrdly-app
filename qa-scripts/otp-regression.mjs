// Exercises the deployed guards without sending SMS or calling OTP verification.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient } from './qa-common.mjs';

const { env } = await readQaEnv();
const seed = await readOutput();
const admin = createAdminClient(env);
const actors = {};
const results = [];
const challengeId = `YRDLY-QA-${randomUUID()}`;
const phone = '2347000000099';
const raceIds = [seed.users.seller, seed.users.non_admin];
const raceChallenges = raceIds.map(() => `YRDLY-QA-${randomUUID()}`);
let raceProfiles;
function ok(result) { if (result.error) throw new Error(`QA database failure (${result.error.code})`); return result.data; }
async function invoke(slug, role, body, method = 'POST') {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/${slug}-phone-otp`, {
    method, headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${actors[role].token}` } : {}) },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  return r.status;
}
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS OTP Edge: ${name}`); }
try {
  for (const role of ['buyer', 'non_admin']) {
    const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const auth = ok(await client.auth.signInWithPassword({ email: env[`QA_${role.toUpperCase()}_EMAIL`], password: env[`QA_${role.toUpperCase()}_PASSWORD`] }));
    assert.equal(auth.user.id, seed.users[role]);
    actors[role] = { client, token: auth.session.access_token };
  }
  for (const operation of ['send', 'verify']) {
    await check(`${operation} denies anonymous caller`, async () => assert.equal(await invoke(operation, null, {}), 401));
    await check(`${operation} rejects non-POST`, async () => assert.equal(await invoke(operation, null, null, 'GET'), 405));
    await check(`${operation} rejects malformed JSON`, async () => assert.equal(await invoke(operation, 'buyer', '{'), 400));
    await check(`${operation} bounds request body`, async () => assert.equal(await invoke(operation, 'buyer', ' '.repeat(2049)), 400));
  }
  await check('send rejects non-string phone', async () => assert.equal(await invoke('send', 'buyer', { phone: 123 }), 400));
  await check('verify rejects non-six-digit code', async () => assert.equal(await invoke('verify', 'buyer', { pinId: challengeId, pin: '123' }), 400));
  ok(await admin.from('phone_verification_challenges').insert({ pin_id: challengeId, user_id: seed.users.non_admin, phone }));
  await check('another account cannot use the challenge', async () => assert.equal(await invoke('verify', 'buyer', { pinId: challengeId, pin: '000000' }), 400));
  ok(await admin.from('phone_verification_challenges').update({ user_id: seed.users.buyer, expires_at: new Date(Date.now() - 1000).toISOString() }).eq('pin_id', challengeId));
  await check('expired challenge denied before provider call', async () => assert.equal(await invoke('verify', 'buyer', { pinId: challengeId, pin: '000000' }), 400));
  ok(await admin.from('phone_verification_challenges').update({ expires_at: new Date(Date.now() + 600000).toISOString(), attempts: 3 }).eq('pin_id', challengeId));
  await check('exhausted challenge denied before provider call', async () => assert.equal(await invoke('verify', 'buyer', { pinId: challengeId, pin: '000000' }), 400));
  ok(await admin.from('phone_verification_challenges').update({ attempts: 0, consumed_at: new Date().toISOString() }).eq('pin_id', challengeId));
  await check('consumed challenge denied before provider call', async () => assert.equal(await invoke('verify', 'buyer', { pinId: challengeId, pin: '000000' }), 400));
  await check('challenge rows are private', async () => assert.equal((await actors.buyer.client.from('phone_verification_challenges').select('*')).error?.code, '42501'));
  await check('completion RPC is backend-only', async () => assert.equal((await actors.buyer.client.rpc('complete_phone_verification', { p_pin_id: challengeId, p_user_id: seed.users.buyer, p_phone: phone })).error?.code, '42501'));
  await check('attempt RPC is backend-only', async () => assert.equal((await actors.buyer.client.rpc('claim_phone_verification_attempt', { p_pin_id: challengeId, p_user_id: seed.users.buyer })).error?.code, '42501'));
  // Exhaust a different fixture's send allowance directly; no provider call occurs.
  for (let i = 0; i < 3; i++) ok(await admin.rpc('consume_rate_limit', { p_user_id: seed.users.non_admin, p_endpoint: 'phone-otp-send', p_max_requests: 3, p_window_seconds: 900 }));
  await check('persistent send limit denies a subsequent instance', async () => assert.equal(await invoke('send', 'non_admin', { phone }), 429));
  // These are synthetic QA profiles, not proof of SMS delivery. Preserve both.
  for (const id of raceIds) {
    const auth = ok(await admin.auth.admin.getUserById(id));
    assert.equal(auth.user.user_metadata.qa_prefix, 'YRDLY-QA');
  }
  const profiles = ok(await admin.from('users').select('id,phone,phone_verified').in('id', raceIds));
  assert.equal(profiles.length, 2);
  assert.ok(profiles.every(profile => !profile.phone && !profile.phone_verified), 'Race fixtures must have no verified phone');
  raceProfiles = profiles;
  const racePhone = '2347000000097';
  ok(await admin.from('phone_verification_challenges').insert(raceIds.map((id, i) => ({ pin_id: raceChallenges[i], user_id: id, phone: racePhone, attempts: 1 }))));
  let winner;
  await check('concurrent accounts cannot verify the same phone', async () => {
    const outcomes = await Promise.all(raceIds.map((id, i) => admin.rpc('complete_phone_verification', { p_pin_id: raceChallenges[i], p_user_id: id, p_phone: racePhone })));
    assert.equal(outcomes.filter(result => result.data === true && !result.error).length, 1);
    assert.equal(outcomes.filter(result => result.error?.code === '23505').length, 1);
    winner = outcomes.findIndex(result => result.data === true);
    const verified = ok(await admin.from('users').select('id').eq('phone', racePhone).eq('phone_verified', true));
    assert.equal(verified.length, 1);
    assert.equal(verified[0].id, raceIds[winner]);
  });
  await check('concurrent completion consumes a challenge once', async () => {
    ok(await admin.from('phone_verification_challenges').update({ consumed_at: null }).eq('pin_id', raceChallenges[winner]));
    const outcomes = await Promise.all([0, 1].map(() => admin.rpc('complete_phone_verification', { p_pin_id: raceChallenges[winner], p_user_id: raceIds[winner], p_phone: racePhone })));
    for (const outcome of outcomes) ok(outcome);
    assert.deepEqual(outcomes.map(result => result.data).sort(), [false, true]);
  });
} finally {
  if (raceProfiles) for (const profile of raceProfiles) ok(await admin.from('users').update({ phone: profile.phone, phone_verified: profile.phone_verified }).eq('id', profile.id));
  ok(await admin.from('phone_verification_challenges').delete().in('pin_id', raceChallenges));
  await admin.from('phone_verification_challenges').delete().eq('pin_id', challengeId);
  await admin.from('rate_limits').delete().eq('user_id', seed.users.non_admin).eq('endpoint', 'phone-otp-send');
  await admin.from('rate_limits').delete().eq('user_id', seed.users.buyer).eq('endpoint', 'phone-otp-verify');
  await writeFile('.qa-artifacts/otp-regression.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
}
