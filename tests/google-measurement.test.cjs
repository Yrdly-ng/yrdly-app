const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

const code = ts.transpileModule(readFileSync('src/lib/attribution/google-measurement.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ consent = 'true', mode = 'gtm', origin = 'https://app.yrdly.ng' } = {}) {
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
    crypto: webcrypto,
  };
  const stub = () => ({ signupAttribution: () => ({ last: { source: 'google', medium: 'cpc', campaign: 'launch', content: 'someone@example.com' } }) });
  const exports = {};
  new Function('exports', 'require', 'window', 'document', 'process', code)(
    exports, stub, window, document, { env: { NEXT_PUBLIC_YRDLY_GOOGLE_MEASUREMENT: mode } },
  );
  return { api: exports, window, scripts };
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
