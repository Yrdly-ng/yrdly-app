// Verify the QA Auth policy rejects a known compromised password before signup.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
const admin = createAdminClient(env);
const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = randomUUID(), email = `yrdly-qa-password-${marker}@example.test`;
const results = [];
let createdUser;
try {
  const { data, error } = await client.auth.signUp({
    email, password: 'Password123!',
    options: { data: { qa_prefix: QA_PREFIX, qa_password_probe: marker } },
  });
  createdUser = data.user?.id;
  assert.equal(error?.code, 'weak_password');
  assert.ok(error.reasons?.includes('pwned'), 'The password must be rejected specifically as compromised');
  assert.equal(createdUser, undefined);
  results.push({ name: 'QA Auth rejects a compromised password before creating an account', passed: true });
  console.log('PASS QA Auth rejects a compromised password before creating an account');
} catch {
  results.push({ name: 'QA compromised-password rejection', passed: false });
  console.error('Password policy regression failed; request details withheld.');
} finally {
  if (createdUser) {
    const { data, error } = await admin.auth.admin.getUserById(createdUser);
    if (!error && data.user?.email === email && data.user.user_metadata.qa_password_probe === marker) {
      if ((await admin.auth.admin.deleteUser(createdUser)).error) results.push({ name: 'cleanup owned password probe', passed: false });
    } else results.push({ name: 'validate owned password probe for cleanup', passed: false });
  }
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  await mkdir('.qa-artifacts', { recursive: true });
  await writeFile('.qa-artifacts/password-security-regression.json', JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
}
if (results.some(result => !result.passed)) process.exitCode = 1;
