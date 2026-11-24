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
    localStorage: { getItem: id => persistent.get(id), setItem: (id, value) => persistent.set(id, value) },
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
