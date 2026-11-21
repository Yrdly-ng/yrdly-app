const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync('src/lib/marketplace/travo-delivery.ts', 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const itemId = 'ed65db15-20c4-433f-8a87-ecd269f88076';
const buyerId = '6f0c6562-cef8-444c-872d-9c017890565f';
const env = {
  VERCEL_ENV: 'preview',
  QA_ENVIRONMENT: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://jxgpvvehajxegeeozlnl.supabase.co',
  NEXT_PUBLIC_TRAVO_QA_LISTING_ID: itemId,
  TRAVO_QA_PICKUP_ADDRESS: '12 Allen Avenue, Ikeja, Lagos',
  TRAVO_QA_PACKAGE_WEIGHT_KG: '1',
  TRAVO_API_KEY: 'travo_test_fixture',
};
const expiry = new Date(Date.now() + 3_600_000).toISOString();
const address = 'Admiralty Wy, Eti-Osa, Lekki 106104, Lagos, Nigeria';
const fixtureQuote = { quoteId: 'quote_test', itemId, buyerId, feeKobo: 565400, itemKobo: 1000000, expiresAt: Date.parse(expiry) };
const customer = { name: 'Fixture Buyer', email: 'fixture@example.com', phone: '+2348012345678' };

function load(fetch = () => assert.fail('Unexpected provider call'), overrides = {}) {
  const exports = {};
  new Function('exports', 'process', 'fetch', 'require', outputText)(exports, { env: { ...env, ...overrides } }, fetch, require);
  return exports;
}

function prices(dropoff = { address, precision: 'street' }) {
  return {
    addresses: { pickup: { address: env.TRAVO_QA_PICKUP_ADDRESS, state: 'Lagos', country: 'NG', precision: 'exact' }, dropoff },
    quotes: [
      { id: 'quote_higher', amount: 600000, currency: 'NGN', expires_at: expiry },
      { id: 'quote_expired', amount: 100000, currency: 'NGN', expires_at: '2000-01-01T00:00:00Z' },
      { id: 'quote_test', amount: 565400, currency: 'NGN', expires_at: expiry },
    ],
  };
}

function customerQuote(overrides = {}) {
  return Response.json({ customer_quote: {
    order_id: 'order_test', currency: 'NGN', amount: 565400, payer: 'customer',
    quote_url: 'https://travo.ng/quote/order_test-fixture',
    tracking_url: 'https://travo.ng/track/order_test-fixture', ...overrides,
  } });
}

test('only the isolated Preview can quote and only Payluk sandbox can enable checkout', () => {
  assert.ok(load().travoSettings());
  assert.equal(load(undefined, { VERCEL_ENV: 'production' }).travoSettings(), null);
  assert.equal(load(undefined, { NEXT_PUBLIC_SUPABASE_URL: 'https://live.example.com' }).travoSettings(), null);
  assert.equal(load().travoCheckoutEnabled(), false);
  const payment = { TRAVO_QA_CHECKOUT_ENABLED: 'true', PAYLUK_BASE_URL: 'https://staging.api.payluk.ng', PAYLUK_SECRET_KEY: 'sk_test_fixture' };
  assert.equal(load(undefined, payment).travoCheckoutEnabled(), true);
  assert.equal(load(undefined, { ...payment, PAYLUK_SECRET_KEY: 'sk_live_fixture' }).travoCheckoutEnabled(), false);
});

test('retrieves the cheapest current Lagos price without sending customer details', async () => {
  const service = load(async (url, request) => {
    assert.equal(url, 'https://app.travo.ng/v1/quotes');
    assert.equal(request.headers.Authorization, 'Bearer travo_test_fixture');
    assert.deepEqual(JSON.parse(request.body), { pickup: env.TRAVO_QA_PICKUP_ADDRESS, dropoff: address, weight_kg: 1 });
    return Response.json(prices());
  });
  assert.deepEqual(await service.quoteTravoDelivery(service.travoSettings(), address), {
    quoteId: 'quote_test', feeKobo: 565400, expiresAt: Date.parse(expiry), dropoff: address,
  });
});

test('rejects outside-Lagos and imprecise addresses', async () => {
  for (const dropoff of [
    { address: 'Ibadan, Oyo, Nigeria', precision: 'exact' },
    { address, precision: 'city' },
  ]) {
    const service = load(async () => Response.json(prices(dropoff)));
    assert.equal(await service.quoteTravoDelivery(service.travoSettings(), address), null);
  }
});

test('binds the accepted amounts and buyer and listing IDs to the signed quote', () => {
  const service = load();
  const token = service.signTravoQuote(service.travoSettings(), fixtureQuote);
  assert.deepEqual(service.readTravoQuote(service.travoSettings(), token), fixtureQuote);
  const [, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify({ ...fixtureQuote, feeKobo: 1 })).toString('base64url');
  assert.equal(service.readTravoQuote(service.travoSettings(), changed + '.' + signature), null);
  assert.equal(service.readTravoQuote({ ...service.travoSettings(), key: 'different' }, token), null);
});

test('requests direct customer payment and returns Travo payment and tracking links', async () => {
  const service = load(async (url, request) => {
    assert.equal(url, 'https://app.travo.ng/v1/quotes/quote_test/send');
    assert.deepEqual(JSON.parse(request.body), { payer: 'customer', customer, reference: 'fixture-transaction' });
    return customerQuote();
  });
  assert.deepEqual(await service.sendTravoDeliveryQuote(service.travoSettings(), fixtureQuote, 'fixture-transaction', customer), {
    orderId: 'order_test', paymentUrl: 'https://travo.ng/quote/order_test-fixture',
    trackingUrl: 'https://travo.ng/track/order_test-fixture',
  });
});

test('rejects merchant-funded, repriced or off-domain checkout responses', async () => {
  for (const override of [{ payer: 'store' }, { amount: 600000 }, { quote_url: 'https://travo.ng.example.com/quote/test' }]) {
    const service = load(async () => customerQuote(override));
    await assert.rejects(service.sendTravoDeliveryQuote(service.travoSettings(), fixtureQuote, 'fixture-transaction', customer));
  }
});
