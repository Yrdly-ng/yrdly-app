// Creates only synthetic sandbox customers and an unpaid escrow. Never funds it.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readQaEnv, ROOT } from './qa-common.mjs';

const { env } = await readQaEnv();
if (!/^sk_test_/.test(env.PAYLUK_SECRET_KEY || '')) throw new Error('Sandbox key required');
const artifact = { environment: 'sandbox', startedAt: new Date().toISOString(), results: [], customers: {} };
let escrow;
async function request(operation, method, path, body, customer) {
  const response = await fetch(`https://staging.api.payluk.ng${path}`, {
    method, headers: { Authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, ...(customer ? { 'customer-id': customer } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  const envelope = await response.json();
  const passed = response.ok && typeof envelope.status === 'number' && envelope.status < 400;
  artifact.results.push({ operation, httpStatus: response.status, providerStatus: envelope.status, passed });
  console.log(JSON.stringify(artifact.results.at(-1)));
  if (!passed) {
    artifact.validationFailure = envelope;
    throw new Error(`Sandbox ${operation} failed with HTTP ${response.status}`);
  }
  return envelope.data;
}
try {
  const suffix = Date.now().toString();
  for (const [index, role] of ['buyer', 'seller'].entries()) {
    const data = await request(`create ${role}`, 'POST', '/v1/customer/create', { firstname: 'Yrdly', lastname: `QA${role}`, email: `yrdly.qa.${role}.${suffix}@example.test`, phone: `080000${String((Number(suffix.slice(-5)) + index) % 100000).padStart(5, '0')}` });
    assert.match(data.customerId, /^[a-f0-9]{24}$/i);
    artifact.customers[role] = data.customerId;
    await request(`set ${role} permission`, 'PUT', `/v1/customer/permissions/${data.customerId}`, role === 'buyer' ? { canBuy: true } : { canSell: true });
  }
  const form = new FormData();
  for (const [key, value] of Object.entries({ amount: '2500', purpose: 'YRDLY-QA unpaid contract test', whoPays: 'buyer', maxDelivery: '3', deliveryTimeline: 'days', totalQuantity: '1' })) form.append(key, value);
  escrow = await request('create unpaid escrow', 'POST', '/v1/escrow/create', form, artifact.customers.seller);
  artifact.escrow = escrow;
  assert.ok(escrow.id && escrow.paymentToken);
  await request('set 3% additional fee', 'PUT', `/v1/escrow/additional-fee/${encodeURIComponent(escrow.paymentToken)}`, { additionalFee: 75 });
  const verified = await request('verify unpaid escrow', 'GET', `/v1/escrow/verify/${encodeURIComponent(escrow.paymentToken)}`);
  assert.equal(verified.state, 'AWAITING_PAYMENT');
  assert.equal(verified.amount, 2500);
  assert.equal(verified.additionalFee, 75);
  artifact.results.push({ operation: 'verify state and commission', passed: true });
} finally {
  if (escrow?.paymentToken) {
    try { await request('delete own unpaid escrow', 'DELETE', `/v1/escrow/delete/${encodeURIComponent(escrow.paymentToken)}`, undefined, artifact.customers.seller); }
    catch { artifact.results.push({ operation: 'unpaid escrow cleanup requires review', passed: false }); }
  }
  artifact.finishedAt = new Date().toISOString();
  await mkdir(`${ROOT}/.qa-artifacts`, { recursive: true });
  await writeFile(`${ROOT}/.qa-artifacts/payluk-contract.json`, JSON.stringify(artifact, null, 2), { mode: 0o600 });
  if (artifact.results.some(r => !r.passed)) process.exitCode = 1;
}
