// Explicit, resumable sandbox money tests. Funded ledger fixtures are retained.
// Uses the hosted Checkout SDK's test-bank rail, never wallet top-up/deposit.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, createAdminClient, generatePassword, QA_PREFIX } from './qa-common.mjs';

const mode = process.argv[2];
assert.ok(['prepare', 'fund', 'complete', 'new-sale', 'new-refund', 'dispute', 'reconcile', 'resolve', 'inspect'].includes(mode), 'Choose an explicit lifecycle operation');
const { env, projectRef } = await readQaEnv();
assert.ok(env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'));
assert.ok(env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY?.startsWith('pk_test_'));
const base = 'https://yrdly-app-qa.vercel.app';
const checkout = 'https://staging.live.payluk.ng';
const scenario = process.argv[3] || 'default';
assert.ok(['default', 'commission'].includes(scenario), 'Use default or commission evidence');
const artifactPath = `.qa-artifacts/payluk-lifecycle${scenario === 'commission' ? '-commission' : ''}.json`;
const admin = createAdminClient(env);
const clients = [];
const actors = {};
let state;
try { state = JSON.parse(await readFile(artifactPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!state) {
  if (mode === 'new-sale') {
    assert.equal(scenario, 'commission');
    const source = JSON.parse(await readFile('.qa-artifacts/payluk-lifecycle-completed.json', 'utf8'));
    assert.equal(source.projectRef, projectRef); assert.equal(source.qaPrefix, QA_PREFIX);
    state = { projectRef, environment: 'sandbox', qaPrefix: QA_PREFIX, kind: 'commission', startedAt: new Date().toISOString(), users: source.users, passwords: source.passwords, listingId: randomUUID(), results: [] };
  } else {
    assert.equal(mode, 'prepare', 'Prepare an owned unpaid fixture first');
    const source = JSON.parse(await readFile('.qa-artifacts/payluk-checkout-fresh.json', 'utf8'));
    const response = source.responses?.find(r => r.status === 200 && r.body.success);
    assert.ok(response && !source.cleaned, 'An owned, retained fresh checkout is required');
    state = { projectRef, environment: 'sandbox', qaPrefix: QA_PREFIX, startedAt: new Date().toISOString(), users: source.users, listingId: source.listingId, payment: response.body, results: [], passwords: {} };
  }
}
assert.equal(state.projectRef, projectRef);
assert.equal(state.environment, 'sandbox');
assert.equal(state.qaPrefix, QA_PREFIX);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = (r, label) => { if (r.error) throw new Error(`${label}: ${r.error.code || r.error.status || 'failed'}`); return r.data; };
async function save() { await writeFile(artifactPath, JSON.stringify(state, null, 2), { mode: 0o600 }); }
async function check(name, run) {
  if (state.results.some(r => r.name === name && r.passed)) return;
  await run(); state.results.push({ name, passed: true, at: new Date().toISOString() });
  console.log(`PASS Payluk lifecycle: ${name}`); await save();
}
async function provider(path, customer) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await pause(Math.max(0, 7000 - (Date.now() - (state.lastProviderRead || 0))));
    state.lastProviderRead = Date.now(); await save();
    const r = await fetch(`https://staging.api.payluk.ng${path}`, { headers: { authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, ...(customer ? { 'customer-id': customer } : {}) }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    const body = await r.json();
    state.providerResponses ||= []; state.providerResponses.push({ path: path.replace(/\/[a-zA-Z0-9_-]{24,}/g, '/[reference]'), status: r.status, body }); await save();
    if (r.status === 429 && attempt < 2) { console.log('Waiting for the Payluk sandbox read-rate window'); await pause(65000); continue; }
    assert.equal(r.status, 200, `Sandbox read failed: HTTP ${r.status}`);
    return body.data;
  }
}
async function api(role, path, body, method = 'POST') {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${actors[role].token}` }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000), redirect: 'error' });
  const result = { status: r.status, body: await r.json() };
  state.appResponses ||= []; state.appResponses.push({ path, ...result }); await save(); return result;
}
async function checkoutRequest(path, body, session) {
  const r = await fetch(`${checkout}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error' });
  const result = { status: r.status, body: await r.json() };
  state.checkoutResponses ||= []; state.checkoutResponses.push({ path: path.split('?')[0], ...result }); await save();
  assert.ok(r.ok, `Checkout operation failed: HTTP ${r.status}`); return result.body;
}
async function tx() { return ok(await admin.from('escrow_transactions').select('*').eq('id', state.payment.transactionId).single(), 'Read owned transaction'); }
async function remote() { return provider(`/v1/escrow/verify/${encodeURIComponent(state.payment.paylukPaymentToken)}`); }
function balance(wallet) { return Number(wallet.mainBalance ?? wallet.wallet?.mainBalance ?? wallet.balance ?? 0); }

try {
  for (const role of ['buyer', 'seller']) {
    const id = state.users[role];
    const auth = ok(await admin.auth.admin.getUserById(id), 'Read owned Auth fixture').user;
    assert.equal(auth.user_metadata.qa_prefix, QA_PREFIX);
    assert.equal(auth.user_metadata.qa_role, `checkout_${role}`);
    assert.ok(auth.email.endsWith('@example.test'));
    const profile = ok(await admin.from('users').select('id,email,phone,phone_verified,payluk_customer_id').eq('id', id).single(), 'Read owned payment profile');
    assert.equal(profile.email, auth.email); assert.ok(profile.phone_verified && profile.payluk_customer_id);
    actors[role] = { profile };
    if (mode !== 'inspect') {
      if (!state.passwords[role]) {
        state.passwords[role] = generatePassword(); await save();
        ok(await admin.auth.admin.updateUserById(id, { password: state.passwords[role] }), 'Set owned fixture password');
      }
      const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); clients.push(client);
      actors[role].token = ok(await client.auth.signInWithPassword({ email: auth.email, password: state.passwords[role] }), 'Sign in owned fixture').session.access_token;
    }
  }
  let transaction = state.payment ? await tx() : null;
  if (transaction) {
    assert.equal(transaction.buyer_id, state.users.buyer); assert.equal(transaction.seller_id, state.users.seller); assert.equal(transaction.item_id, state.listingId); assert.equal(transaction.payment_provider, 'payluk');
  } else assert.ok(['new-refund', 'new-sale'].includes(mode), 'Resume the pending new checkout first');
  if (mode === 'new-sale') {
    assert.equal(state.kind, 'commission');
    const existing = ok(await admin.from('posts').select('user_id').eq('id', state.listingId).maybeSingle(), 'Check owned commission listing');
    if (existing) assert.equal(existing.user_id, state.users.seller);
    else ok(await admin.from('posts').insert({ id: state.listingId, user_id: state.users.seller, author_name: `${QA_PREFIX} Commission Seller`, author_image: '', category: 'For Sale', sub_category: 'Other', title: `${QA_PREFIX} canonical commission test`, text: `${QA_PREFIX} synthetic test-bank funds only`, price: 2500, condition: 'New', image_urls: [], visibility: 'PUBLIC', moderation_status: 'approved', is_sold: false, liked_by: [], comment_count: 0, timestamp: new Date().toISOString() }), 'Create owned commission listing');
    if (!state.payment) {
      console.log('Reserving a fresh Payluk rate window for canonical commission checkout'); await pause(65000);
      const r = await api('buyer', '/api/payment/initialize', { itemId: state.listingId, buyerId: state.users.buyer, sellerId: state.users.seller, price: 1 }); assert.equal(r.status, 200); assert.equal(r.body.success, true); state.payment = r.body; await save();
    }
  }
  if (mode === 'new-refund') {
    if (state.kind !== 'refund') {
      assert.equal(transaction.status, 'completed', 'Finish the release scenario first');
      assert.ok(state.results.some(r => r.name === 'released seller wallet matches escrow-specific net proceeds'));
      await writeFile('.qa-artifacts/payluk-lifecycle-completed.json', JSON.stringify(state, null, 2), { mode: 0o600 });
      state = { projectRef, environment: 'sandbox', qaPrefix: QA_PREFIX, kind: 'refund', startedAt: new Date().toISOString(), users: state.users, passwords: state.passwords, listingId: randomUUID(), results: [] }; await save();
      ok(await admin.from('posts').insert({ id: state.listingId, user_id: state.users.seller, author_name: `${QA_PREFIX} Refund Seller`, author_image: '', category: 'For Sale', sub_category: 'Other', title: `${QA_PREFIX} funded sandbox refund`, text: `${QA_PREFIX} synthetic test-bank funds only`, price: 2500, condition: 'New', image_urls: [], visibility: 'PUBLIC', moderation_status: 'approved', is_sold: false, liked_by: [], comment_count: 0, timestamp: new Date().toISOString() }), 'Create owned refund listing');
    }
    if (!state.payment) {
      console.log('Reserving a fresh Payluk rate window for hosted refund checkout'); await pause(65000);
      const r = await api('buyer', '/api/payment/initialize', { itemId: state.listingId, buyerId: state.users.buyer, sellerId: state.users.seller, price: 1 }); assert.equal(r.status, 200); assert.equal(r.body.success, true); state.payment = r.body; await save();
    }
  }
  if (mode === 'prepare') {
    await check('fresh customer creation binds both confirmed identities', async () => {
      for (const role of ['buyer', 'seller']) {
        const p = actors[role].profile; const c = await provider(`/v1/customer/get/${p.payluk_customer_id}`);
        assert.equal(c.email, p.email); assert.equal(c.phone.replace(/\D/g, '').replace(/^234/, '0'), p.phone);
      }
    });
    await check('fresh checkout retry reuses one unpaid escrow', async () => {
      console.log('Reserving a fresh Payluk rate window for hosted checkout'); await pause(65000);
      const r = await api('buyer', '/api/payment/initialize', { itemId: state.listingId, buyerId: state.users.buyer, sellerId: state.users.seller, price: 1 });
      assert.equal(r.status, 200);
      for (const key of ['transactionId', 'paylukPaymentToken', 'paylukEscrowId']) assert.equal(r.body[key], state.payment[key]);
      assert.equal(ok(await admin.from('escrow_transactions').select('id').eq('item_id', state.listingId), 'Read reservations').length, 1);
    });
    await check('unpaid provider price, commission and seller proceeds match', async () => {
      const r = await remote(); assert.equal(r.state, 'AWAITING_PAYMENT'); assert.equal(r.amount, 2500); assert.equal(r.additionalFee, 75); assert.equal(state.payment.totalAmount, 2575);
      if (state.kind === 'commission') assert.equal(r.fee, 50, 'Dashboard merchant commission must be zero for the canonical app fee');
      assert.equal(transaction.seller_amount, Math.round((r.amount - r.fee) * 100) / 100); state.unpaidEscrow = r;
    });
    await check('wallet baselines recorded without deposits', async () => {
      state.walletBefore = {};
      for (const role of ['buyer', 'seller']) state.walletBefore[role] = await provider('/v1/wallet', actors[role].profile.payluk_customer_id);
    });
  }
  if (mode === 'fund') {
    assert.ok(state.walletBefore && state.unpaidEscrow, 'Prepare must pass before funding');
    await check('SDK opens the sandbox test-bank rail', async () => {
      if (!state.session) state.session = (await checkoutRequest('/v1/checkout/session', { paymentToken: state.payment.paylukPaymentToken, reference: state.payment.transactionId, redirectUrl: `${base}/transactions`, customerId: actors.buyer.profile.payluk_customer_id, publicKey: env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY })).session;
      assert.ok(state.session); await save();
      const summary = await checkoutRequest(`/v1/checkout/escrow?session=${encodeURIComponent(state.session)}`);
      assert.equal(summary.provider, 'payluk-test-bank', 'Refusing another checkout rail'); state.checkoutSummary = summary;
      state.intent ||= await checkoutRequest(`/v1/checkout/pay-with-payluk-test-bank/initialize?session=${encodeURIComponent(state.session)}`, {}, state.session);
      assert.ok(state.intent.reference); assert.equal(state.intent.amount, state.payment.totalAmount);
    });
    await check('test bank pays the exact owned escrow amount once', async () => {
      // Account shape comes from the hosted renderer, not from user-supplied data.
      const account = state.intent.virtualAccount;
      assert.ok(account && /^99\d{8}$/.test(account.accountNumber), 'A Payluk test-bank account is required');
      const enquiry = await checkoutRequest('/v1/checkout/test-bank/name-enquiry', { accountNumber: account.accountNumber });
      assert.equal(enquiry.bankName, 'Payluk Test Bank'); assert.equal(enquiry.expectedAmount, state.payment.totalAmount);
      assert.ok(!enquiry.paid && !state.transferStarted, 'Refusing a second or uncertain transfer');
      const accounts = (await checkoutRequest('/v1/checkout/test-bank/accounts')).accounts;
      const source = accounts.find(a => a.balance >= state.intent.amount); assert.ok(source, 'Funded test float required');
      state.transferStarted = new Date().toISOString(); await save();
      state.transfer = await checkoutRequest('/v1/checkout/test-bank/transfer', { fromAccountNumber: source.accountNumber, toAccountNumber: account.accountNumber, amount: state.intent.amount, narration: `${QA_PREFIX} ${state.payment.transactionId}` });
      assert.equal(state.transfer.amount, state.intent.amount); assert.equal(state.transfer.rail, 'checkout');
    });
    await check('SDK verifies the funded escrow', async () => {
      state.sdkVerification = await checkoutRequest(`/v1/checkout/pay-with-payluk-test-bank/verify?session=${encodeURIComponent(state.session)}`, { reference: state.intent.reference }, state.session);
      assert.ok(state.sdkVerification.paymentId);
    });
    await check('real provider callback marks payment and listing sold', async () => {
      // No app verification request or database state write precedes this check.
      const until = Date.now() + 120000;
      let row;
      do { row = await tx(); if (row.status === 'paid') break; await pause(3000); } while (Date.now() < until);
      assert.equal(row.status, 'paid', 'Provider callback has not applied payment');
      assert.equal(ok(await admin.from('posts').select('is_sold').eq('id', state.listingId).single(), 'Read listing').is_sold, true);
      state.paidTransaction = row;
    });
    await check('signed funding replays preserve one payment and notification', async () => {
      const escrow = await remote(); assert.equal(escrow.status, 'ONGOING'); state.fundedEscrow = escrow;
      const count = async () => ok(await admin.from('notifications').select('id').eq('user_id', state.users.seller).eq('related_id', state.payment.transactionId).eq('type', 'payment_successful'), 'Read payment notifications').length;
      const before = await count();
      const raw = JSON.stringify({ event: 'escrow.ongoing', data: escrow, timestamp: new Date().toISOString() });
      for (let i = 0; i < 2; i++) {
        const r = await fetch(`${base}/api/webhooks/payluk`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-payluk-signature': createHmac('sha512', env.PAYLUK_SECRET_KEY).update(raw).digest('hex') }, body: raw, signal: AbortSignal.timeout(30000) }); assert.equal(r.status, 200);
      }
      assert.equal((await tx()).status, 'paid'); assert.equal(await count(), before);
      assert.equal(ok(await admin.from('escrow_transactions').select('id').eq('item_id', state.listingId), 'Read ledger').length, 1);
    });
  }
  if (mode === 'complete') {
    assert.ok(state.paidTransaction, 'Funding must pass before completion');
    await check('seller cannot confirm the buyer delivery', async () => assert.equal((await api('seller', '/api/payluk/confirm-delivery', { transactionId: state.payment.transactionId })).status, 403));
    await check('buyer confirms funded delivery and retry is idempotent', async () => {
      const r = await api('buyer', '/api/payluk/confirm-delivery', { transactionId: state.payment.transactionId }); assert.equal(r.status, 200); assert.equal(r.body.success, true);
      const repeat = await api('buyer', '/api/payluk/confirm-delivery', { transactionId: state.payment.transactionId }); assert.equal(repeat.status, 200); assert.equal(repeat.body.alreadyCompleted, true);
      assert.equal((await tx()).status, 'completed');
    });
    await check('released seller wallet matches escrow-specific net proceeds', async () => {
      const r = await remote(); assert.equal(r.status, 'COMPLETED'); state.completedEscrow = r;
      state.sellerWalletAfter = await provider('/v1/wallet', actors.seller.profile.payluk_customer_id);
      const row = await tx(); assert.equal(row.seller_amount, state.paidTransaction.seller_amount);
      assert.equal(Math.round((balance(state.sellerWalletAfter) - balance(state.walletBefore.seller)) * 100) / 100, row.seller_amount);
      assert.equal(ok(await admin.from('payout_requests').select('id').eq('seller_id', state.users.seller), 'Read own payouts').length, 0, 'No bank details were seeded or bank payouts requested');
    });
    await check('seller earned balance matches released proceeds and bank-account gate holds', async () => {
      const r = await api('seller', '/api/seller/payouts/balance', null, 'GET'); assert.equal(r.status, 200);
      const rows = ok(await admin.from('escrow_transactions').select('seller_amount').eq('seller_id', state.users.seller).eq('status', 'completed').neq('item_type', 'ticket'), 'Read own completed earnings');
      const earned = rows.reduce((sum, row) => sum + Number(row.seller_amount), 0);
      assert.equal(r.body.totalEarnings, earned); assert.equal(r.body.availableBalance, earned);
      assert.equal(r.body.pendingPayouts, 0); assert.equal(r.body.completedPayouts, 0);
      const request = await api('seller', '/api/seller/payouts/request', { amount: 1000 }); assert.equal(request.status, 400); assert.equal(request.body.error, 'NO_ACTIVE_ACCOUNT');
    });
    if (state.kind === 'commission') await check('merchant ledger receives exactly one canonical 3% commission', async () => {
      const ledger = await provider('/v1/merchant/transactions?' + new URLSearchParams({ fromDate: state.startedAt, toDate: new Date().toISOString() })); assert.ok(Array.isArray(ledger));
      const own = ledger.filter(row => JSON.stringify(row.escrowDetails).includes(state.payment.paylukPaymentToken));
      state.merchantSettlement = own;
      assert.equal(own.filter(row => row.status === 'success' && row.transactionType === 'delivery').reduce((sum, row) => sum + row.amount, 0), 75);
      assert.equal(own.filter(row => row.status === 'success' && row.transactionType === 'commission').reduce((sum, row) => sum + row.amount, 0), 0);
      assert.equal(own.filter(row => row.status === 'success').reduce((sum, row) => sum + row.amount, 0), 75);
    });
  }
  if (['dispute', 'resolve', 'reconcile'].includes(mode)) {
    assert.equal(state.kind, 'refund'); assert.ok(state.paidTransaction);
    for (const role of ['admin', 'non_admin']) {
      const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); clients.push(client);
      const login = ok(await client.auth.signInWithPassword({ email: env[`QA_${role.toUpperCase()}_EMAIL`], password: env[`QA_${role.toUpperCase()}_PASSWORD`] }), 'Sign in QA role');
      assert.equal(login.user.user_metadata.qa_prefix, QA_PREFIX); actors[role] = { token: login.session.access_token };
    }
  }
  if (mode === 'reconcile') await check('definitely rejected refund is verified before enabling one corrected retry', async () => {
    const operation = ok(await admin.from('dispute_resolution_operations').select('status,error_message').eq('dispute_id', state.disputeId).single(), 'Read owned resolution');
    assert.equal(operation.status, 'needs_reconciliation');
    assert.ok(operation.error_message.includes('HTTP 400') && operation.error_message.includes('only valid on a SPLIT resolution'));
    const escrow = await remote(); assert.equal(escrow.status, 'INVESTIGATING'); state.reconciliationEvidence = { operation, escrow, verifiedAt: new Date().toISOString() }; await save();
    const r = await api('admin', `/api/admin/disputes/${state.disputeId}/reconcile`, { outcome: 'not_applied' }); assert.equal(r.status, 200); assert.equal(r.body.status, 'retryable');
  });
  if (mode === 'dispute') {
    console.log('Reserving a fresh Payluk rate window for funded dispute checks'); await pause(65000);
    await check('outsider cannot open a funded transaction dispute', async () => {
      const r = await api('non_admin', '/api/disputes', { transactionId: state.payment.transactionId, reason: 'YRDLY-QA outsider probe', evidence: { description: 'YRDLY-QA attempt by an unrelated test account', photos: [] } }); assert.equal(r.status, 400);
      assert.equal(ok(await admin.from('disputes').select('id').eq('transaction_id', state.payment.transactionId), 'Read owned disputes').length, 0);
    });
    await check('buyer opens the funded dispute with Payluk', async () => {
      const existing = ok(await admin.from('disputes').select('id,provider_submission_status').eq('transaction_id', state.payment.transactionId).maybeSingle(), 'Read owned dispute');
      if (existing) { assert.equal(existing.provider_submission_status, 'submitted'); state.disputeId = existing.id; }
      else {
        const r = await api('buyer', '/api/disputes', { transactionId: state.payment.transactionId, reason: 'YRDLY-QA sandbox refund scenario', evidence: { description: 'YRDLY-QA simulated item not delivered; test-bank funds only', photos: [] } });
        assert.equal(r.status, 201); assert.equal(r.body.providerSubmissionStatus, 'submitted'); state.disputeId = r.body.id;
      }
      assert.equal((await tx()).status, 'disputed'); assert.equal((await remote()).status, 'DISPUTED');
    });
    await check('seller submits one provider reply and a duplicate is rejected', async () => {
      const row = ok(await admin.from('disputes').select('provider_seller_reply_status').eq('id', state.disputeId).single(), 'Read seller reply');
      if (row.provider_seller_reply_status === 'not_required') {
        const r = await api('seller', `/api/disputes/${state.disputeId}/evidence`, { description: 'YRDLY-QA seller agrees to simulated full refund.', photos: [] }); assert.equal(r.status, 200); assert.equal(r.body.providerSellerReplyStatus, 'submitted');
      } else assert.equal(row.provider_seller_reply_status, 'submitted');
      assert.equal((await api('seller', `/api/disputes/${state.disputeId}/evidence`, { description: 'YRDLY-QA duplicate seller reply', photos: [] })).status, 409);
      assert.equal((await remote()).status, 'INVESTIGATING');
    });
  }
  if (mode === 'resolve') {
    assert.ok(state.disputeId);
    console.log('Reserving a fresh Payluk rate window for refund settlement'); await pause(65000);
    const resolution = { resolution: 'YRDLY-QA simulated full refund, no item delivered', refundAmount: 2500, sellerAmount: 0 };
    await check('non-admin cannot resolve or refund the dispute', async () => assert.equal((await api('buyer', `/api/admin/disputes/${state.disputeId}/resolve`, resolution)).status, 403));
    await check('admin full refund commits once and restores listing availability', async () => {
      const r = await api('admin', `/api/admin/disputes/${state.disputeId}/resolve`, resolution); assert.equal(r.status, 200); assert.equal(r.body.success, true);
      const repeat = await api('admin', `/api/admin/disputes/${state.disputeId}/resolve`, resolution); assert.equal(repeat.status, 200); assert.equal(repeat.body.idempotent, true);
      const row = ok(await admin.from('disputes').select('status,refund_amount,seller_amount').eq('id', state.disputeId).single(), 'Read refund ledger');
      assert.equal(row.status, 'resolved'); assert.equal(row.refund_amount, 2500); assert.equal(row.seller_amount, 0); state.refundLedger = row;
      assert.equal((await tx()).status, 'cancelled'); assert.equal(ok(await admin.from('posts').select('is_sold').eq('id', state.listingId).single(), 'Read refunded listing').is_sold, false);
    });
    await check('provider refund and buyer wallet reconcile including non-refundable fee', async () => {
      state.refundedEscrow = await remote(); assert.equal(state.refundedEscrow.status, 'REFUNDED');
      state.buyerWalletAfter = await provider('/v1/wallet', actors.buyer.profile.payluk_customer_id);
      const expected = state.unpaidEscrow.amount - state.unpaidEscrow.fee + (state.refundedEscrow.additionalFeeRefundable ? state.unpaidEscrow.additionalFee : 0);
      assert.equal(Math.round((balance(state.buyerWalletAfter) - balance(state.walletBefore.buyer)) * 100) / 100, expected);
      // Another owned scenario may complete while this dispute is pending.
      // Reconcile against all completed sales, never mistake an aggregate
      // wallet change for proceeds from this refunded escrow.
      const sellerWallet = await provider('/v1/wallet', actors.seller.profile.payluk_customer_id);
      const initial = JSON.parse(await readFile('.qa-artifacts/payluk-lifecycle-completed.json', 'utf8'));
      assert.equal(initial.users.seller, state.users.seller);
      const completed = ok(await admin.from('escrow_transactions').select('seller_amount').eq('seller_id', state.users.seller).eq('status', 'completed'), 'Read completed QA sales');
      assert.equal(balance(sellerWallet), balance(initial.walletBefore.seller) + completed.reduce((sum, row) => sum + Number(row.seller_amount), 0));
      assert.equal(ok(await admin.from('payout_requests').select('id').eq('seller_id', state.users.seller), 'Read QA payouts').length, 0);
    });
  }
  if (mode === 'inspect') console.log(JSON.stringify({ environment: state.environment, status: transaction.status, checksPassed: state.results.filter(r => r.passed).length, transferStarted: Boolean(state.transferStarted), ledgerRetained: true }));
  state.lastFailure = null;
} catch (error) {
  state.lastFailure = { mode, at: new Date().toISOString(), message: error instanceof Error ? error.message : 'Lifecycle failure' };
  console.error('Payluk lifecycle check failed; details retained privately. Funded fixtures are never deleted.'); process.exitCode = 1;
} finally {
  for (const client of clients) await client.auth.signOut().catch(() => {});
  state.updatedAt = new Date().toISOString(); await save();
}
