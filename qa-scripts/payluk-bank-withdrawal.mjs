// Manual, single-attempt payout test. Never run from CI or against production.
// Requires the locally saved, explicitly authorized QA beneficiary.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const mode = process.argv[2];
assert.ok(['prepare', 'execute', 'inspect'].includes(mode), 'Choose prepare, execute or inspect');
const { env, projectRef } = await readQaEnv();
assert.ok(env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'), 'Sandbox key required');
for (const key of ['QA_PAYOUT_ACCOUNT_NUMBER', 'QA_PAYOUT_ACCOUNT_NAME', 'QA_PAYOUT_BANK_CODE']) {
  assert.ok(env[key], `Missing ${key}`);
}
const base = 'https://yrdly-app-qa.vercel.app';
const path = '.qa-artifacts/payluk-bank-withdrawal-private.json';
const fixture = JSON.parse(await readFile('.qa-artifacts/payluk-lifecycle-completed.json', 'utf8'));
assert.equal(fixture.projectRef, projectRef);
assert.equal(fixture.qaPrefix, QA_PREFIX);
const admin = createAdminClient(env);
const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let state;
try { state = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
state ||= { projectRef, environment: 'sandbox', qaPrefix: QA_PREFIX, sellerId: fixture.users.seller, budget: 1200, results: [], startedAt: new Date().toISOString() };
assert.equal(state.projectRef, projectRef);
assert.equal(state.environment, 'sandbox');
assert.equal(state.qaPrefix, QA_PREFIX);
assert.equal(state.sellerId, fixture.users.seller);
assert.equal(state.budget, 1200, 'One small authorized sandbox payout only');
const save = () => writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'failed'}`);
  return result.data;
};
const kobo = amount => Math.round(Number(amount) * 100);
let token;
async function check(name, run) {
  if (state.results.some(result => result.name === name && result.passed)) return;
  await run(); state.results.push({ name, passed: true }); await save();
  console.log(`PASS sandbox payout: ${name}`);
}
async function api(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(90000),
  });
  const result = { status: response.status, body: await response.json() };
  state.appResponses ||= []; state.appResponses.push({ route, ...result }); await save();
  return result;
}
async function provider(route, customerId) {
  assert.ok(route.startsWith('/v1/'), 'Read-only provider route required');
  await delay(Math.max(0, 7500 - (Date.now() - (state.lastProviderRead || 0))));
  state.lastProviderRead = Date.now(); await save();
  const response = await fetch(`https://staging.api.payluk.ng${route}`, {
    headers: { authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, ...(customerId ? { 'customer-id': customerId } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  state.providerResponses ||= []; state.providerResponses.push({ route, status: response.status, body }); await save();
  assert.equal(response.status, 200, `Provider read failed: HTTP ${response.status}`);
  return body.data;
}
async function payouts() {
  return ok(await admin.from('payout_requests').select('id,amount,status,transaction_reference,failure_reason,requested_at')
    .eq('seller_id', state.sellerId), 'Read owned payout ledger');
}

try {
  const user = ok(await admin.auth.admin.getUserById(state.sellerId), 'Read owned Auth fixture').user;
  assert.equal(user.user_metadata.qa_prefix, QA_PREFIX);
  assert.equal(user.user_metadata.qa_role, 'checkout_seller');
  assert.ok(user.email.endsWith('@example.test'));
  const profile = ok(await admin.from('users').select('legal_name,payluk_customer_id').eq('id', state.sellerId).single(), 'Read owned profile');
  assert.ok(profile.payluk_customer_id);
  if (mode !== 'inspect') {
    token = ok(await client.auth.signInWithPassword({ email: user.email, password: fixture.passwords.seller }), 'Sign in owned seller').session.access_token;
  }
  await save();
  if (mode === 'prepare') {
    assert.ok(!state.requestStarted, 'A payout attempt already exists; use inspect');
    await check('controlled beneficiary is linked through authenticated account setup', async () => {
      const accounts = ok(await admin.from('seller_accounts').select('id,account_details,is_active,verification_status,account_updated_at')
        .eq('user_id', state.sellerId).eq('is_active', true), 'Read owned bank accounts');
      if (accounts.length) {
        assert.equal(accounts.length, 1);
        assert.equal(accounts[0].account_details.account_number, env.QA_PAYOUT_ACCOUNT_NUMBER);
        assert.equal(accounts[0].verification_status, 'verified');
        assert.ok(!accounts[0].account_updated_at, 'Do not bypass a cooling-off period');
      } else {
        if (!Object.hasOwn(state, 'originalLegalName')) state.originalLegalName = profile.legal_name;
        await save();
        // This is a marked synthetic QA identity, never a production profile.
        ok(await admin.from('users').update({ legal_name: env.QA_PAYOUT_ACCOUNT_NAME }).eq('id', state.sellerId), 'Set owned fixture beneficiary name');
        console.log('Reserving a fresh Payluk rate window for bank setup'); await delay(65000);
        const banks = await provider('/v1/payment/bank-list');
        const bank = banks.find(candidate => candidate.code === env.QA_PAYOUT_BANK_CODE);
        assert.ok(bank && /opay|paycom/i.test(bank.name), 'Use the previously verified controlled bank only');
        const response = await api('/api/seller/setup-account', {
          bankCode: bank.code, bankName: bank.name,
          accountNumber: env.QA_PAYOUT_ACCOUNT_NUMBER, accountName: env.QA_PAYOUT_ACCOUNT_NAME,
        });
        assert.equal(response.status, 200); assert.equal(response.body.success, true);
      }
    });
    await check('authenticated preview fits the budget and bank minimum without execution', async () => {
      console.log('Reserving a fresh Payluk rate window for payout preview'); await delay(65000);
      const before = await payouts();
      assert.ok(!before.some(row => ['pending', 'processing'].includes(row.status)), 'An existing payout must be reconciled first');
      state.payoutBeforeIds = before.map(row => row.id); await save();
      const response = await api('/api/seller/payouts/preview', { amount: state.budget });
      assert.equal(response.status, 200); assert.equal(response.body.success, true);
      assert.ok(response.body.netToBank >= 1000);
      assert.ok(kobo(response.body.totalDebit) <= kobo(state.budget));
      assert.equal(kobo(response.body.netToBank) + kobo(response.body.fee), kobo(response.body.totalDebit));
      assert.equal((await payouts()).length, before.length, 'Preview cannot reserve or execute a payout');
      state.preview = response.body;
    });
  }
  if (mode === 'execute') {
    assert.ok(state.preview && state.payoutBeforeIds, 'Prepare must pass first');
    assert.ok(!state.requestStarted, 'Refusing a second or uncertain payout; use inspect');
    state.walletBefore = await provider('/v1/wallet', profile.payluk_customer_id);
    assert.ok(state.walletBefore.mainBalance >= state.budget);
    console.log('Reserving a fresh Payluk rate window for a single sandbox payout'); await delay(65000);
    assert.ok(!(await payouts()).some(row => ['pending', 'processing'].includes(row.status)));
    state.requestStarted = new Date().toISOString(); await save();
    state.request = await api('/api/seller/payouts/request', { amount: state.budget });
    // Any failure or uncertainty is inspected by reference, never resubmitted.
    assert.equal(state.request.status, 200, 'Payout did not return confirmed success; use inspect');
    assert.equal(state.request.body.success, true);
    state.payoutId = state.request.body.payoutId; await save();
  }
  if (['execute', 'inspect'].includes(mode) && state.requestStarted) {
    const owned = (await payouts()).filter(row => !state.payoutBeforeIds.includes(row.id));
    assert.equal(owned.length, 1, 'Identify exactly one new owned payout before reconciliation');
    state.payout = owned[0]; state.payoutId ||= owned[0].id; await save();
    await check('application and provider confirm one payout with matching debit and fee', async () => {
      assert.equal(state.payout.status, 'completed', 'Pending/failed payout remains a release gate');
      assert.equal(kobo(state.payout.amount), kobo(state.budget));
      assert.ok(state.payout.transaction_reference);
      console.log('Reserving a fresh Payluk rate window for payout reconciliation'); await delay(65000);
      const history = await provider(`/v1/payment/history?reference=${encodeURIComponent(state.payout.transaction_reference)}`, profile.payluk_customer_id);
      assert.ok(Array.isArray(history)); assert.equal(history.length, 1);
      const payment = history[0]; state.providerPayment = payment; await save();
      assert.equal(payment.reference, state.payout.transaction_reference);
      assert.equal(payment.transactionType, 'withdrawal'); assert.equal(payment.status.toLowerCase(), 'success');
      assert.ok(payment.amount >= 1000);
      assert.equal(kobo(payment.amount) + kobo(payment.fee), kobo(state.budget));
      assert.equal(payment.withdrawalDetails.accountNumber, env.QA_PAYOUT_ACCOUNT_NUMBER);
      state.walletAfter = await provider('/v1/wallet', profile.payluk_customer_id);
      assert.equal(kobo(state.walletBefore.mainBalance) - kobo(state.walletAfter.mainBalance), kobo(state.budget));
    });
  }
  state.failure = null;
} catch (error) {
  state.failure = { mode, message: error instanceof Error ? error.message : 'Sandbox payout failed' };
  console.error('Sandbox payout incomplete; inspect private evidence before any further action. No automatic retry.');
  process.exitCode = 1;
} finally {
  await client.auth.signOut().catch(() => {});
  state.updatedAt = new Date().toISOString(); await save();
  await writeFile('.qa-artifacts/payluk-bank-withdrawal-summary.json', JSON.stringify({
    environment: state.environment, checkedAt: state.updatedAt, results: state.results,
    requestStarted: Boolean(state.requestStarted), applicationStatus: state.payout?.status,
    providerStatus: state.providerPayment?.status, amount: state.providerPayment?.amount, fee: state.providerPayment?.fee,
    bankReceiptVerified: false, ledgerRetained: Boolean(state.requestStarted),
  }, null, 2), { mode: 0o600 });
}
