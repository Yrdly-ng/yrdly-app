// Sandbox-only name enquiry for the test bank named by Payluk's quota response.
// Never creates a payout or submits /payment/verify.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { readQaEnv, createAdminClient, updateQaEnv, QA_PREFIX } from './qa-common.mjs';

const { env, projectRef } = await readQaEnv();
assert.ok(env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'), 'Sandbox key required');
const fixture = JSON.parse(await readFile('.qa-artifacts/payluk-lifecycle-completed.json', 'utf8'));
assert.equal(fixture.projectRef, projectRef);
assert.equal(fixture.qaPrefix, QA_PREFIX);
const state = { environment: 'sandbox', qaPrefix: QA_PREFIX, checkedAt: new Date().toISOString() };
try {
  const admin = createAdminClient(env);
  const { data, error } = await admin.from('users').select('payluk_customer_id').eq('id', fixture.users.seller).single();
  assert.equal(error, null); assert.ok(data.payluk_customer_id);
  const response = await fetch('https://staging.api.payluk.ng/v1/payment/verify-account', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, 'customer-id': data.payluk_customer_id, 'content-type': 'application/json' },
    body: JSON.stringify({ accountNumber: '0123456789', bankCode: '001' }),
  });
  state.status = response.status; state.body = await response.json();
  assert.equal(response.status, 200);
  assert.match(state.body.data?.accountName || '', /test|sandbox/i, 'Accept an explicitly synthetic beneficiary only');
  if (state.body.data.accountNumber) assert.equal(state.body.data.accountNumber, '0123456789');
  await updateQaEnv({
    QA_TEST_PAYOUT_BANK_CODE: '001', QA_TEST_PAYOUT_BANK_NAME: 'Payluk Provider Test Bank',
    QA_TEST_PAYOUT_ACCOUNT_NUMBER: '0123456789', QA_TEST_PAYOUT_ACCOUNT_NAME: state.body.data.accountName,
  });
  console.log('PASS provider sandbox beneficiary name enquiry; fixture saved privately, no payout executed');
} catch (error) {
  state.failure = error instanceof Error ? error.message : 'Name enquiry failed';
  console.error('Provider-test beneficiary check incomplete; details retained privately.');
  process.exitCode = 1;
} finally {
  await writeFile('.qa-artifacts/payluk-test-beneficiary-private.json', JSON.stringify(state, null, 2), { mode: 0o600 });
}
