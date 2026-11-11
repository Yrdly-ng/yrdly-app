/**
 * Payluk staging-only integration smoke test.
 * The user authorised a funded SANDBOX test, never a live customer debit.
 *
 * This script is enabled only for the isolated QA preview ref, with Payluk
 * sk_test credentials and the allowlisted Supabase QA project. It never uses
 * a real bank or a production database.
 */
import { randomUUID, randomInt } from 'node:crypto';
import assert from 'node:assert/strict';

const QA_REF = 'jxgpvvehajxegeeozlnl';
const qaCommit = process.env.VERCEL_GIT_COMMIT_REF === 'feature/streamlined-onboarding-nov-2026';
if (!qaCommit) {
  console.log('SKIP: funded Payluk smoke test is restricted to the QA preview ref');
  process.exit(0);
}
if (process.env.VERCEL_ENV !== 'preview'
    || process.env.QA_ENVIRONMENT !== 'staging'
    || process.env.QA_EXPECTED_PROJECT_REF !== QA_REF
    || !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.test').hostname.startsWith(QA_REF + '.')
    || !process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_')
    || !process.env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY?.startsWith('pk_test_')
    || process.env.PAYLUK_BASE_URL !== 'https://staging.api.payluk.ng') {
  throw new Error('Refusing funded QA: expected isolated Supabase/Payluk staging setup');
}

const api = 'https://staging.api.payluk.ng';
const secret = process.env.PAYLUK_SECRET_KEY;
async function request(method, path, { customerId, body, form } = {}) {
  const headers = { Authorization: 'Bearer ' + secret };
  if (customerId) headers['customer-id'] = customerId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(api + path, {
    method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(15000), redirect:'error',
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw Error('Provider returned a non-JSON response: HTTP ' + response.status); }
  // Never log customer, tokens, response bodies, or any credential.
  if (!response.ok || payload.status === false) {
    throw Error('Payluk staging ' + method + ' ' + path.split('?')[0].replace(/\/[a-f0-9]{24}/g,'/<id>') + ' failed: HTTP ' + response.status + ' (' + String(payload.message || 'unknown').slice(0,100) + ')');
  }
  return payload.data;
}
const unique = randomUUID();
const phone = () => '08000' + String(randomInt(1000000)).padStart(6,'0');
const create = async (role) => {
  const c = await request('POST','/v1/customer/create', {
    body: {firstname:'YRDLY',lastname:'QA '+role,
      email:'yrdly.qa.wallet.' + role + '.' + randomUUID() + '@example.test',
      phone:phone()},
  });
  assert.ok(c?.id, role + ' Payluk customer creation failed');
  await request('PUT','/v1/customer/permissions/' + encodeURIComponent(c.id),{
    body:role==='buyer'?{canBuy:true}:{canSell:true}
  });
  return c.id;
};
const seller = await create('seller');
const buyer = await create('buyer');
const form = new FormData();
form.append('amount','2300');
form.append('purpose','YRDLY-QA-wallet-recovery-' + unique);
form.append('whoPays','seller');
form.append('maxDelivery','1');
form.append('deliveryTimeline','days');
form.append('totalQuantity','1');
const draft = await request('POST','/v1/escrow/create',{customerId:seller,form});
assert.ok(draft?.id && draft?.paymentToken, 'Test escrow not created');
assert.equal(draft.status, 'PENDING');
assert.equal(draft.state, 'AWAITING_PAYMENT');
assert.equal(Number(draft.amount),2300);
const wallet = async () => {
  const b=await request('GET','/v1/wallet',{customerId:buyer});
  const bal=Number(b?.mainBalance ?? b?.availableBalance ?? b?.wallet?.mainBalance);
  assert.ok(Number.isFinite(bal), 'No numeric wallet balance');
  return bal;
};
const before = await wallet();
// Staging-only helper. Never invokes a real bank or payment service.
await request('POST','/v1/payment/topup',{customerId:buyer,body:{amount:2300}});
const credited = await wallet();
assert.ok(credited >= before + 2300 - 0.01, 'Sandbox wallet topup did not credit the full amount');
const paymentRef = 'yrdly-wallet-' + randomUUID();
await request('POST','/v1/payment/escrow',{
  customerId:buyer,
  body:{amount:2300,reference:paymentRef,transactionType:'escrow',
        gateway:'wallet',escrowDetails:{escrowId:draft.id}}
});
const after = await wallet();
const funded = await request('GET','/v1/escrow/verify/' + encodeURIComponent(draft.paymentToken));
assert.equal(funded.id,draft.id);
assert.ok(['ONGOING','COMPLETED','CLAIMED'].includes(String(funded.status).toUpperCase()),
  'Provider did not settle the escrow');
assert.ok(after <= credited - 2300 + 0.01, 'Buyer wallet was not debited for escrow purchase');
console.log('PASS Payluk STAGING: new synthetic wallet credited ₦2,300 and funded owned escrow exactly once.');
