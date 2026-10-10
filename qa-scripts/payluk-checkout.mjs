// Uses existing synthetic customers, or creates new ones via the hosted app.
// Never funds escrow; phone verification is explicitly seeded fixture trust.
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, createAdminClient, generatePassword, QA_PREFIX } from './qa-common.mjs';

const { env } = await readQaEnv();
assert.ok(env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'));
const mode = process.argv[2] || 'existing';
assert.ok(['existing', 'fresh'].includes(mode), 'Use existing or fresh');
const base = 'https://yrdly-app-qa.vercel.app';
const provider = mode === 'fresh' ? { environment: 'sandbox', customers: {} }
  : JSON.parse(await readFile('.qa-artifacts/payluk-contract.json', 'utf8'));
assert.equal(provider.environment, 'sandbox');
const admin = createAdminClient(env);
const artifact = { mode, startedAt: new Date().toISOString(), users: {}, listingId: randomUUID(), results: [] };
let buyerClient;
let buyerToken;
let verifiedEscrow;
function ok(result, label) { if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'failed'}`); return result.data; }
async function save() { await writeFile(`.qa-artifacts/payluk-checkout${mode === 'fresh' ? '-fresh' : ''}.json`, JSON.stringify(artifact, null, 2), { mode: 0o600 }); }
async function check(name, fn) { await fn(); artifact.results.push({ name, passed: true }); console.log(`PASS Payluk checkout: ${name}`); await save(); }
async function providerRequest(method, path, customer) {
  const response = await fetch(`https://staging.api.payluk.ng${path}`, { method, headers: { Authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, ...(customer ? { 'customer-id': customer } : {}) }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  const body = await response.json();
  if (method === 'GET' && path.startsWith('/v1/customers?phone=') && response.status === 400 && body.status === false && body.message === 'No customer found with the provided phone') return { data: [] };
  assert.ok(response.ok, `Sandbox ${method} failed: HTTP ${response.status}`);
  return body.data;
}
try {
  for (const role of ['buyer', 'seller']) {
    const email = `yrdly.qa.checkout.${role}.${randomUUID()}@example.test`;
    const customer = mode === 'fresh' ? { email, phone: `08000${String(randomInt(1000000)).padStart(6, '0')}` } : provider[`${role}Customer`];
    if (mode === 'fresh') {
      const lookup = await providerRequest('GET', `/v1/customers?phone=${encodeURIComponent(customer.phone)}`);
      assert.ok(!lookup.data.some(row => row.phone?.replace(/\D/g, '').replace(/^234/, '0') === customer.phone), 'Fresh fixture phone must have no existing provider customer');
      provider[`${role}Customer`] = customer;
    } else assert.equal(customer.customerId, provider.customers[role]);
    assert.ok(customer.email.endsWith('@example.test'), 'Synthetic provider identity required');
    const password = generatePassword();
    const auth = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { qa_prefix: QA_PREFIX, qa_role: `checkout_${role}` } }), 'Create QA auth user');
    artifact.users[role] = auth.user.id;
    await save();
    // Explicit fixture trust; this does not establish delivery to a synthetic number.
    ok(await admin.from('users').upsert({ id: auth.user.id, email, name: `${QA_PREFIX} Checkout ${role}`, legal_name: `${QA_PREFIX} Checkout ${role}`, username: `qa_${randomUUID().replaceAll('-', '').slice(0, 20)}`, profile_completed: true, phone: customer.phone, phone_verified: true, payluk_customer_id: null }), 'Seed synthetic payment profile');
    if (role === 'buyer') {
      buyerClient = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const login = ok(await buyerClient.auth.signInWithPassword({ email, password }), 'Login QA buyer');
      buyerToken = login.session.access_token;
    }
  }
  ok(await admin.from('posts').insert({ id: artifact.listingId, user_id: artifact.users.seller, author_name: `${QA_PREFIX} Checkout Seller`, author_image: '', category: 'For Sale', sub_category: 'Other', title: `${QA_PREFIX} unpaid sandbox checkout`, text: `${QA_PREFIX} no funds collected`, price: 2500, condition: 'New', image_urls: [], visibility: 'PUBLIC', moderation_status: 'approved', is_sold: false, liked_by: [], comment_count: 0, timestamp: new Date().toISOString() }), 'Create QA listing');
  async function initialize() {
    const response = await fetch(`${base}/api/payment/initialize`, { method: 'POST', headers: { authorization: `Bearer ${buyerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ itemId: artifact.listingId, buyerId: artifact.users.buyer, sellerId: artifact.users.seller, price: 1 }), signal: AbortSignal.timeout(45000), redirect: 'error' });
    const body = await response.json();
    artifact.responses ||= [];
    artifact.responses.push({ status: response.status, body });
    await save();
    assert.equal(response.status, 200, `Hosted checkout returned HTTP ${response.status}`);
    assert.equal(body.success, true);
    return body;
  }
  let first;
  await check('hosted checkout uses database price and 3% commission', async () => {
    first = await initialize();
    assert.equal(first.totalAmount, 2575);
    assert.ok(first.paylukPaymentToken && first.paylukEscrowId);
  });
  await check(mode === 'fresh' ? 'application creates and binds brand-new sandbox customers' : 'onboarding binds each verified synthetic phone to its customer', async () => {
    const profiles = ok(await admin.from('users').select('id,payluk_customer_id').in('id', Object.values(artifact.users)), 'Read mappings');
    if (mode === 'fresh') for (const role of ['buyer', 'seller']) provider.customers[role] = profiles.find(p => p.id === artifact.users[role]).payluk_customer_id;
    for (const role of ['buyer', 'seller']) {
      const mapped = profiles.find(p => p.id === artifact.users[role]).payluk_customer_id;
      if (mode === 'fresh') {
        assert.ok(mapped, 'New provider mapping required');
        const remote = await providerRequest('GET', `/v1/customer/get/${encodeURIComponent(mapped)}`);
        assert.equal(remote.phone?.replace(/\D/g, '').replace(/^234/, '0'), provider[`${role}Customer`].phone);
        assert.equal(remote.email, provider[`${role}Customer`].email);
      } else assert.equal(mapped, provider.customers[role]);
    }
    assert.equal(first.buyerPaylukId, provider.customers.buyer);
  });
  await check('retry reuses the same unpaid transaction and provider escrow', async () => {
    const retried = await initialize();
    for (const field of ['transactionId', 'paylukPaymentToken', 'paylukEscrowId']) assert.equal(retried[field], first[field]);
    const rows = ok(await admin.from('escrow_transactions').select('id').eq('item_id', artifact.listingId), 'Read reservations');
    assert.equal(rows.length, 1);
  });
  await check('provider principal and additional fee match the application', async () => {
    verifiedEscrow = await providerRequest('GET', `/v1/escrow/verify/${encodeURIComponent(first.paylukPaymentToken)}`);
    assert.equal(verifiedEscrow.state, 'AWAITING_PAYMENT');
    assert.equal(verifiedEscrow.amount, 2500);
    assert.equal(verifiedEscrow.additionalFee, 75);
    const tx = ok(await admin.from('escrow_transactions').select('seller_amount').eq('id', first.transactionId).single(), 'Read escrow proceeds');
    assert.equal(tx.seller_amount, Math.round((verifiedEscrow.amount - verifiedEscrow.fee) * 100) / 100);
  });
} catch (error) {
  artifact.failure = error instanceof Error ? error.message : 'Checkout regression failed';
  console.error(error instanceof assert.AssertionError ? 'Checkout assertion failed; details saved privately' : 'Checkout provider/network operation failed; details saved privately');
  process.exitCode = 1;
} finally {
  try {
    const transactions = ok(await admin.from('escrow_transactions').select('id,payluk_tx_ref').eq('item_id', artifact.listingId), 'Find QA cleanup transactions');
    for (const tx of transactions) {
      if (tx.payluk_tx_ref) {
        const remote = verifiedEscrow?.paymentToken === tx.payluk_tx_ref ? verifiedEscrow
          : await providerRequest('GET', `/v1/escrow/verify/${encodeURIComponent(tx.payluk_tx_ref)}`);
        assert.equal(remote.state, 'AWAITING_PAYMENT', 'Refusing funded escrow cleanup');
        await providerRequest('DELETE', `/v1/escrow/delete/${encodeURIComponent(tx.payluk_tx_ref)}`, provider.customers.seller);
      }
      ok(await admin.from('escrow_transactions').delete().eq('id', tx.id), 'Remove QA transaction');
    }
    ok(await admin.from('posts').delete().eq('id', artifact.listingId), 'Remove QA listing');
    if (buyerClient) await buyerClient.auth.signOut();
    for (const id of Object.values(artifact.users)) {
      ok(await admin.from('rate_limits').delete().eq('user_id', id), 'Remove QA rate counter');
      ok(await admin.from('users').delete().eq('id', id), 'Remove QA profile');
      ok(await admin.auth.admin.deleteUser(id), 'Remove QA auth user');
    }
    artifact.cleaned = true;
    console.log('PASS Payluk checkout: unpaid escrow and temporary QA fixtures cleaned');
  } catch (error) {
    artifact.cleanupFailure = error instanceof Error ? error.message : 'Cleanup failed';
    console.error('Checkout cleanup failed; details saved privately');
    process.exitCode = 1;
  }
  artifact.finishedAt = new Date().toISOString();
  await save();
}
