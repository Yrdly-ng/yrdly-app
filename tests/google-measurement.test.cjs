const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

const code = ts.transpileModule(readFileSync('src/lib/attribution/google-measurement.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ consent = 'true', mode = 'gtm', origin = 'https://app.yrdly.ng', persistent = new Map() } = {}) {
  const scripts = new Map();
  const storage = new Map();
  const document = {
    cookie: consent ? `yrdly_cookie_consent=${consent}` : '',
    head: { appendChild: script => scripts.set(script.id, script) },
    getElementById: id => scripts.get(id),
    createElement: () => ({}),
  };
  const window = {
    location: { origin, href: `${origin}/login?email=someone@example.com#secret-token` },
    sessionStorage: { getItem: id => storage.get(id), setItem: (id, value) => storage.set(id, value) },
    localStorage: { getItem: id => persistent.get(id), setItem: (id, value) => persistent.set(id, value), removeItem: id => persistent.delete(id), key: i => [...persistent.keys()][i], get length() { return persistent.size; } },
    crypto: webcrypto,
  };
  const stub = () => ({ signupAttribution: () => ({ last: { source: 'google', medium: 'cpc', campaign: 'launch', content: 'someone@example.com' } }) });
  const exports = {};
  new Function('exports', 'require', 'window', 'document', 'process', code)(
    exports, stub, window, document, { env: { NEXT_PUBLIC_YRDLY_GOOGLE_MEASUREMENT: mode } },
  );
  return { api: exports, window, scripts, document, persistent };
}

const id = '123e4567-e89b-42d3-a456-426614174000';

test('GTM remains inactive without the explicit mode, consent and exact production origin', () => {
  for (const input of [{ consent: null }, { consent: 'false' }, { mode: 'legacy' }, { origin: 'https://preview.vercel.app' }]) {
    const { api, scripts, window } = setup(input);
    api.trackGooglePage('/login');
    api.reportGoogleConversion('sign_up', id);
    assert.equal(scripts.size, 0);
    assert.equal(window.dataLayer, undefined);
  }
});

test('pageviews keep safe campaign dimensions while purchase identifiers and amounts stay bounded', async () => {
  const { api, scripts, window } = setup();
  api.trackGooglePage('/reset-password');
  assert.equal(scripts.size, 0);
  api.trackGooglePage('/login');
  api.trackGooglePage('/login');
  for (const event of ['sign_up', 'listing_published', 'business_created']) {
    api.reportGoogleConversion(event, id);
    api.reportGoogleConversion(event, id);
  }
  await Promise.all([
    api.reportGooglePurchase(id, '400.50', 'post'),
    api.reportGooglePurchase(id, 400.5, 'post'),
    api.reportGooglePurchase(id, 'not valid', 'post'),
  ]);
  assert.equal(scripts.size, 1);
  const events = window.dataLayer.filter(entry => entry.event && entry.event !== 'gtm.js');
  assert.deepEqual(events.map(entry => entry.event), ['yrdly_page_view', 'sign_up', 'listing_published', 'business_created', 'purchase']);
  assert.equal(new URL(events[0].measurement_page_location).searchParams.get('utm_campaign'), 'launch');
  assert.equal(events[4].ecommerce.value, 400.5);
  assert.equal(events[4].ecommerce.currency, 'NGN');
  assert.match(events[4].ecommerce.transaction_id, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(events), /123e4567|someone@example\.com|secret-token|reset-password/);
});

const purchases = window => (window.dataLayer || []).filter(event => event.event === 'purchase');
const order2 = '123e4567-e89b-42d3-a456-426614174001';

test('verified ticket order and staged booking purchases use distinct opaque order IDs', async () => {
  const { api, window, persistent } = setup();
  await api.reportGooglePurchase(id, 2500, 'ticket');
  await api.reportGooglePurchase(id, 2500, 'ticket');
  await api.reportGooglePurchase(order2, 1000, 'booking');
  assert.deepEqual(purchases(window).map(e => [e.ecommerce.items[0].item_id, e.ecommerce.value]), [['ticket', 2500], ['booking', 1000]]);
  assert.equal(purchases(window)[0].ecommerce.items[0].quantity, 1);
  assert.notEqual(purchases(window)[0].ecommerce.transaction_id, purchases(window)[1].ecommerce.transaction_id);
  assert.doesNotMatch(JSON.stringify(purchases(window)), /123e4567|@|secret-token/);
  const reopened = setup({ persistent });
  await reopened.api.reportGooglePurchase(id, 2500, 'ticket');
  assert.equal(purchases(reopened.window).length, 0);
});

test('no purchase for free, missing, sandbox-omitted or malformed measurement amounts', async () => {
  const { api, window, scripts } = setup();
  for (const amount of [0, -10, undefined, null, false, NaN, Infinity, '0x10', '1e3', ' 5 ', '1.234', 1000000001]) {
    await api.reportGooglePurchase(id, amount, 'ticket');
  }
  await api.reportGooglePurchase('payment-token', 100, 'ticket');
  await api.reportGooglePurchase(id, 100, 'unsupported');
  assert.equal(purchases(window).length, 0);
  assert.equal(scripts.size, 0);
});

test('purchase tracking does not initialize when disabled, denied, or outside production', async () => {
  for (const input of [{ consent: null }, { consent: 'false' }, { mode: 'legacy' }, { origin: 'https://preview.vercel.app' }]) {
    const { api, window, scripts } = setup(input);
    await api.reportGooglePurchase(id, 500, 'booking');
    assert.equal(purchases(window).length, 0);
    assert.equal(scripts.size, 0);
  }
});

test('withdrawal blocks purchase events even when the container has already loaded', async () => {
  const { api, document, window } = setup();
  api.trackGooglePage('/login');
  document.cookie = 'yrdly_cookie_consent=false';
  await api.reportGooglePurchase(id, 500, 'booking');
  assert.equal(purchases(window).length, 0);
});

test('consent is rechecked after hashing if withdrawn while a purchase is in flight', async () => {
  const { api, document, window } = setup();
  const pending = api.reportGooglePurchase(id, 500, 'ticket');
  document.cookie = 'yrdly_cookie_consent=false';
  await pending;
  assert.equal(purchases(window).length, 0);
});

function loadModule(path, mocks, globals = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', 'window', 'document', 'process', output)(
    exports, name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    globals.window, globals.document, { env: globals.env || {} },
  );
  return exports;
}
const liveEnv = { NEXT_PUBLIC_SUPABASE_URL: 'https://api.yrdly.ng', PAYLUK_SECRET_KEY: 'sk_live_fixture', PAYLUK_BASE_URL: 'https://api.payluk.ng', NEXT_PUBLIC_YRDLY_GOOGLE_MEASUREMENT: 'gtm' };
const paymentState = loadModule('src/lib/payments/payment-state.ts', {});
const query = data => {
  const q = { maybeSingle: async () => ({ data }), single: async () => ({ data }) };
  for (const name of ['select','eq','or','order','limit']) q[name] = () => q;
  return q;
};
const jsonResponse = { json: (body, opts) => ({ body, status: opts?.status ?? 200 }) };
const owner = '123e4567-e89b-42d3-a456-426614174002';

test('delayed approval is reported only in the original seller session, once, and private or rejected listings never count', async () => {
  const s = setup();
  const listing = { id, user_id: owner, category: 'For Sale', visibility: 'public', moderation_status: 'pending', is_sold: false };
  let saved = listing, calls = 0;
  const pending = loadModule('src/lib/attribution/pending-listing-measurement.ts', {
    './google-measurement': s.api,
    '../auth/authenticated-fetch': { authenticatedFetch: async () => { calls++; return { data: saved }; } },
  }, s);
  const events = () => (s.window.dataLayer || []).filter(e => e.event === 'listing_published');
  pending.rememberGoogleListing(listing);
  pending.rememberGoogleListing({ ...listing, id: order2, visibility: 'private', moderation_status: 'approved' });
  assert.equal(events().length, 0);
  await pending.recoverGoogleListings(order2, () => true);
  assert.equal(calls, 0);
  await pending.recoverGoogleListings(owner, () => true);
  assert.equal(events().length, 0);
  saved = { ...listing, moderation_status: 'approved' };
  await pending.recoverGoogleListings(owner, () => true);
  await pending.recoverGoogleListings(owner, () => true);
  assert.equal(events().length, 1);
  pending.rememberGoogleListing({ ...listing, id: order2 });
  saved = { ...listing, id: order2, moderation_status: 'rejected' };
  await pending.recoverGoogleListings(owner, () => true);
  assert.equal(events().length, 1);
  assert.equal(s.persistent.has('yrdly:ga4:pending-listings:' + owner), false);
});

test('consent withdrawal queues denial and deletes outstanding listing measurement records', () => {
  const s = setup();
  s.api.trackGooglePage('/login');
  s.persistent.set('yrdly:ga4:pending-listings:' + owner, '[]');
  s.document.cookie = 'yrdly_cookie_consent=false';
  s.api.syncGoogleMeasurementConsent();
  const commands = s.window.dataLayer.filter(e => e[0] === 'consent');
  assert.deepEqual(commands.map(e => [e[1], e[2].analytics_storage]), [['default','denied'],['update','granted'],['update','denied']]);
  assert.ok(commands.every(e => e[2].ad_personalization === 'denied' && e[2].ad_user_data === 'denied'));
  assert.equal(s.persistent.size, 0);
});

test('marketplace server measurement uses verified principal and excludes sandbox, unauthorized and pending payments', async () => {
  const tx = { id, buyer_id: owner, item_type: 'post', amount: 2500, total_amount: 2700, payment_provider: 'payluk', payluk_tx_ref: 'secret-token', payluk_escrow_id: 'escrow', status: 'pending', metadata: {} };
  const remote = { id: 'escrow', status: 'ONGOING', amount: 2500, environment: 'live' };
  let applied = 0;
  const verify = async (changes = {}, provider = {}, env = liveEnv, user = owner) => {
    const route = loadModule('src/app/api/payment/verify/route.ts', {
      'next/server': { NextResponse: jsonResponse },
      '@/lib/supabase/supabase-admin': { supabaseAdmin: { from: () => query({ ...tx, ...changes }) } },
      '@/lib/supabase/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: user } } }) },
      '@/lib/payments/payluk-service': { PaylukService: { verifyEscrow: async () => ({ ...remote, ...provider }) } },
      '@/lib/payments/escrow-payment': { applyEscrowPayment: async () => { applied++; } },
      '@/lib/payments/payment-reconciliation': { flagPayment: async () => {} },
      '@/lib/payments/payment-state': paymentState,
    }, { env });
    return route.POST({ json: async () => ({ txRef: id }) });
  };
  const live = await verify();
  assert.equal(live.body.measurementAmount, 2500);
  assert.equal(live.body.amount, 2700);
  assert.equal(live.body.measurementKind, 'post');
  assert.equal((await verify({item_type:'catalog_item',status:'paid'})).body.measurementKind, 'catalog_item');
  assert.equal(applied, 1);
  assert.equal((await verify({}, {environment:'test'})).body.measurementAmount, undefined);
  assert.equal((await verify({}, {}, {...liveEnv,QA_ENVIRONMENT:'staging'})).body.measurementAmount, undefined);
  assert.equal((await verify({}, {status:'PENDING'})).status, 402);
  assert.equal((await verify({}, {amount:999})).status, 409);
  assert.equal((await verify({}, {}, liveEnv, order2)).status, 403);
  assert.doesNotMatch(JSON.stringify(live.body), /secret-token/);
});

test('booking verification measures confirmed live full and staged principal, but not sandbox or pending', async () => {
  const tx = { id, amount: 1500, total_amount: 1600, status: 'pending', payluk_tx_ref: 'secret-token', payluk_escrow_id: 'escrow', metadata: {} };
  const remote = { id: 'escrow', status: 'ONGOING', amount: 1500, environment: 'live' };
  let applied = 0;
  const verify = (changes = {}, provider = {}, env = liveEnv) => {
    const service = loadModule('src/lib/bookings/booking-payments.ts', {
      '../supabase/supabase-admin': { supabaseAdmin: { from: () => query({ ...tx, ...changes }) } },
      '../payments/payluk-service': { PaylukService: { verifyEscrow: async () => ({ ...remote, ...provider }) } },
      '../payments/payluk-onboarding': {},
      '../payments/payment-reconciliation': { flagPayment: async () => {} },
      '../payments/payment-state': paymentState,
      '../payments/escrow-payment': { applyEscrowPayment: async () => { applied++; } },
    }, { env });
    return service.verifyBookingCheckout(order2, owner);
  };
  assert.equal((await verify()).measurementAmount, 1500);
  assert.equal((await verify({ status:'paid' })).measurementAmount, 1500);
  assert.equal(applied, 1);
  assert.equal((await verify({ metadata:{payluk_environment:'live',payluk_fee_mode:'milestone_native_commission_v1'} }, {whoPays:'buyer'})).measurementAmount, 1500);
  assert.equal((await verify({}, {environment:'test'})).measurementAmount, undefined);
  assert.equal((await verify({}, {}, {...liveEnv,QA_ENVIRONMENT:'staging'})).measurementAmount, undefined);
  await assert.rejects(verify({}, {status:'PENDING'}), /not completed/);
  await assert.rejects(verify({}, {amount: 1}), /reconciliation/);
});

test('Paystack verifies a multi-ticket order once using live principal, excluding sandbox and failed payments', async () => {
  const tx = { id, buyer_id: owner, seller_id: order2, item_id: order2, amount: 4500, total_amount: 4700, payment_reference: 'paystack-ref', metadata: {quantity:3,event_id:order2} };
  let fulfilled = 0;
  const verify = async (domain, provider = {}, env = liveEnv, buyer = owner) => {
    const service = loadModule('src/lib/events/paystack-ticket-service.ts', {
      'server-only': {}, qrcode: {}, 'next/server': {after: () => {}},
      '@/lib/supabase/supabase-admin': {supabaseAdmin: {
        from: table => query(table === 'escrow_transactions' ? tx : {domain}),
        rpc: async (name, args) => { assert.equal(name, 'fulfill_paystack_ticket_checkout'); assert.equal(args.p_tickets.length,3); fulfilled++; return {data:{tickets:[{id:order2,event_id:order2}]}}; },
      }},
      '@/lib/payments/paystack-service': {PaystackService: {verifyTransaction: async () => ({status:'success',reference:tx.payment_reference,domain,currency:'NGN',amount:470000,fees:20000,paid_at:'2026-01-01T00:00:00Z',metadata:{yrdly_transaction_id:id},...provider})},paystackKeyMode:()=>domain,getPaystackEventMode:()=>domain,paystackSandboxUserAllowed:()=>true},
      '@/lib/payments/payment-state': paymentState,
      '@/lib/payments/payment-reconciliation': {flagPayment:async()=>{}},
      './ticket-checkout': {TicketCheckoutError:Error},
      '@/lib/email/resend-service': {},
      '@/lib/notifications/server-push-notification': {},
      './paystack-event-finance': {},
    }, {env});
    return service.verifyPaystackTicketCheckout(id, buyer);
  };
  const live = await verify('live');
  assert.equal(live.measurementAmount,4500);
  assert.equal(live.transaction_id,id);
  assert.equal(live.quantity,3);
  assert.equal((await verify('test')).measurementAmount,undefined);
  assert.equal((await verify('live',{}, {...liveEnv,QA_ENVIRONMENT:'staging'})).measurementAmount,undefined);
  await assert.rejects(verify('live',{status:'failed'}), /not been confirmed/);
  await assert.rejects(verify('live',{amount:10}), /needs review/);
  await assert.rejects(verify('live',{},liveEnv,order2),/not found/);
  assert.equal(fulfilled,3);
});
