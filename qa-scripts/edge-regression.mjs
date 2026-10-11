import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput } from './qa-common.mjs';

const { env } = await readQaEnv();
const seed = await readOutput();
const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data, error } = await client.auth.signInWithPassword({ email: env.QA_BUYER_EMAIL, password: env.QA_BUYER_PASSWORD });
if (error) throw new Error('QA login failed');
const payload = JSON.stringify({ userId: seed.users.buyer, payload: { title: 'YRDLY-QA', body: 'Authorization test; fixture has no subscribed device.' } });
for (const [name, headers, body, expected] of [
  ['anonymous', {}, payload, [401,403]],
  ['publishable', { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, payload, [403]],
  ['authenticated user', { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${data.session.access_token}` }, payload, [403]],
  ['forged secret', { apikey: 'sb_secret_invalid-qa-only' }, payload, [401,403]],
  ['backend secret', { apikey: env.SUPABASE_SERVICE_ROLE_KEY }, payload, [200]],
  ['oversize backend body', { apikey: env.SUPABASE_SERVICE_ROLE_KEY }, ' '.repeat(8193), [413]],
  ['invalid backend payload', { apikey: env.SUPABASE_SERVICE_ROLE_KEY }, '{}', [400]],
]) {
  const response = await fetch(`${env.SUPABASE_URL}/functions/v1/send-push-notification`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  assert.ok(expected.includes(response.status), `${name}: unexpected HTTP ${response.status}`);
  if (name === 'backend secret') assert.equal((await response.json()).reason, 'no_token');
  console.log(`PASS push Edge: ${name}`);
}
