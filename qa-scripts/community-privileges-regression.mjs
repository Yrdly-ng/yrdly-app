// Owned, free QA fixtures only. No provider calls; no production target accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
const seed = await readOutput(), admin = createAdminClient(env);
const communityId = randomUUID(), invitationId = randomUUID(), requestId = randomUUID();
const results = [], actors = {};
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const anonymous = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const ok = result => { if (result.error) throw new Error(`QA database operation failed (${result.error.code || 'unknown'})`); return result.data; };
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
const role = (client, userId) => client.rpc('is_community_mod_or_admin', { p_community_id: communityId, p_user_id: userId });

try {
  for (const name of ['buyer', 'seller', 'organizer', 'non_admin']) {
    const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const login = ok(await client.auth.signInWithPassword({ email: env[`QA_${name.toUpperCase()}_EMAIL`], password: env[`QA_${name.toUpperCase()}_PASSWORD`] }));
    assert.equal(login.user.id, seed.users[name]);
    assert.equal(login.user.user_metadata.qa_prefix, QA_PREFIX);
    actors[name] = client;
  }
  ok(await admin.from('communities').insert({ id: communityId, name: `${QA_PREFIX} Role privacy`, slug: `yrdly-qa-roles-${communityId}`, type: 'interest', privacy: 'invite', approval_status: 'approved' }));
  ok(await admin.from('community_memberships').insert([
    { community_id: communityId, user_id: seed.users.buyer, role: 'moderator', status: 'active' },
    { community_id: communityId, user_id: seed.users.seller, role: 'member', status: 'active' },
  ]));
  ok(await admin.from('community_join_requests').insert({ id: requestId, community_id: communityId, user_id: seed.users.organizer, status: 'pending' }));
  await check('anonymous cannot infer a private community moderator', async () => assert.equal(ok(await role(anonymous, seed.users.buyer)), false));
  await check('member cannot infer another private community moderator', async () => assert.equal(ok(await role(actors.seller, seed.users.buyer)), false));
  await check('moderator can check only their own role', async () => {
    assert.equal(ok(await role(actors.buyer, seed.users.buyer)), true);
    assert.equal(ok(await role(actors.buyer, seed.users.seller)), false);
  });
  await check('member and moderator membership reads preserve RLS without recursion', async () => {
    assert.equal(ok(await actors.seller.from('community_memberships').select('id').eq('community_id', communityId)).length, 1);
    assert.equal(ok(await actors.buyer.from('community_memberships').select('id').eq('community_id', communityId)).length, 2);
  });
  await check('ordinary member cannot approve a pending community request', async () => {
    assert.ok((await actors.seller.rpc('approve_community_join_request', { p_community_id: communityId, p_user_id: seed.users.organizer })).error);
    assert.equal(ok(await admin.from('community_join_requests').select('status').eq('id', requestId).single()).status, 'pending');
  });
  await check('moderator approval works with trigger RPC grants removed', async () => {
    ok(await actors.buyer.rpc('approve_community_join_request', { p_community_id: communityId, p_user_id: seed.users.organizer }));
    assert.equal(ok(await admin.from('community_memberships').select('role').eq('community_id', communityId).eq('user_id', seed.users.organizer).single()).role, 'member');
    assert.equal(ok(await admin.from('communities').select('member_count').eq('id', communityId).single()).member_count, 3);
  });
  await check('moderator invitation and recipient acceptance preserve authorization', async () => {
    ok(await actors.buyer.from('community_invites').insert({ id: invitationId, community_id: communityId, invited_by: seed.users.buyer, invited_user_id: seed.users.non_admin }));
    assert.ok((await actors.seller.rpc('accept_community_invite', { p_community_id: communityId })).error);
    ok(await actors.non_admin.rpc('accept_community_invite', { p_community_id: communityId }));
    assert.equal(ok(await admin.from('community_memberships').select('role').eq('community_id', communityId).eq('user_id', seed.users.non_admin).single()).role, 'member');
    assert.equal(ok(await admin.from('communities').select('member_count').eq('id', communityId).single()).member_count, 4);
  });
  await check('anonymous community approval and invitation mutations are denied', async () => {
    for (const [name, args] of [['accept_community_invite', { p_community_id: communityId }], ['approve_community_join_request', { p_community_id: communityId, p_user_id: seed.users.seller }], ['community_toggle_post_like', { p_post_id: randomUUID(), p_user_id: seed.users.seller, p_action: 'like' }]]) {
      assert.equal((await anonymous.rpc(name, args)).error?.code, '42501');
    }
  });
} catch (error) {
  results.push({ name: 'community regression completed', passed: false, reason: error.message.replace(/https?:\/\/\S+/g, '[URL]') });
  console.error('Community regression failed; credential details withheld.');
} finally {
  for (const [table, column, id] of [['community_invites', 'id', invitationId], ['community_join_requests', 'id', requestId], ['community_memberships', 'community_id', communityId], ['communities', 'id', communityId]]) {
    const result = await admin.from(table).delete().eq(column, id);
    if (result.error) results.push({ name: `cleanup ${table}`, passed: false, reason: result.error.code });
  }
  for (const client of Object.values(actors)) await client.auth.signOut({ scope: 'local' }).catch(() => {});
  await mkdir('.qa-artifacts', { recursive: true });
  await writeFile('.qa-artifacts/community-privileges-regression.json', JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), fixtures: { communityId, invitationId, requestId }, results }, null, 2), { mode: 0o600 });
}
const failed = results.filter(result => !result.passed);
console.log(`Community privileges: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
