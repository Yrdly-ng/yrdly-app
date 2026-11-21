const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync('src/lib/marketplace/shipbubble-quote.ts', 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const env = {
  VERCEL_ENV: 'preview',
  QA_ENVIRONMENT: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://jxgpvvehajxegeeozlnl.supabase.co',
  NEXT_PUBLIC_SHIPBUBBLE_QA_LISTING_ID: 'test-listing',
  SHIPBUBBLE_API_KEY: 'sb_sandbox_fixture',
  SHIPBUBBLE_QA_PICKUP_ADDRESS_CODE: '1001',
  SHIPBUBBLE_QA_PACKAGE_CATEGORY_ID: '2001',
};

function load(fetch = () => assert.fail('Unexpected provider call'), override = {}) {
  const exports = {};
  new Function('exports', 'process', 'fetch', outputText)(exports, { env: { ...env, ...override } }, fetch);
  return exports;
}

const recipient = { name: 'Test Buyer', email: 'buyer@example.com', phone: '08010000000', address: 'Victoria Island, Lagos, Nigeria' };
const item = { name: 'QA parcel', price: 2500 };
const lagosAddress = { address_code: 3001, country_code: 'NG', state: 'Lagos' };
const result = data => new Response(JSON.stringify({ status: 'success', data }));

test('delivery preview requires an isolated QA database, Preview deployment, sandbox key and listing configuration', () => {
  assert.ok(load().shipbubbleQuoteConfig());
  for (const override of [
    { VERCEL_ENV: 'production' }, { QA_ENVIRONMENT: '' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://api.yrdly.ng' }, { SHIPBUBBLE_API_KEY: 'sb_prod_fixture' },
    { SHIPBUBBLE_QA_PICKUP_ADDRESS_CODE: '0' }, { SHIPBUBBLE_QA_PACKAGE_CATEGORY_ID: 'NaN' },
    { NEXT_PUBLIC_SHIPBUBBLE_QA_LISTING_ID: '' },
  ]) assert.equal(load(undefined, override).shipbubbleQuoteConfig(), null);
});

test('validates the Lagos address and prefers Kwik over other eligible pickup quotes', async () => {
  const requests = [];
  const service = load(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    assert.equal(options.headers.Authorization, 'Bearer sb_sandbox_fixture');
    return requests.length === 1 ? result(lagosAddress) : result({
      couriers: [
        { service_type: 'dropoff', service_code: 'kwik', currency: 'NGN', total: 200 },
        { service_type: 'pickup', service_code: 'sandbox', currency: 'NGN', total: 1000 },
        { service_type: 'pickup', service_code: 'kwik', currency: 'NGN', rate_card_amount: '1520.35', total: 1800, delivery_eta: 'Same day' },
      ],
    });
  });
  const quote = await service.getShipbubblePickupQuote(service.shipbubbleQuoteConfig(), recipient, item);
  assert.deepEqual(quote, { feeKobo: 152035, eta: 'Same day', kwik: true });
  assert.deepEqual(requests.map(request => request.url.split('/shipping/')[1]), ['address/validate', 'fetch_rates']);
  assert.deepEqual(requests[0].body, recipient);
  assert.equal(requests[1].body.sender_address_code, 1001);
  assert.equal(requests[1].body.reciever_address_code, 3001);
  assert.equal(requests[1].body.service_type, 'pickup');
});

test('rejects addresses outside Lagos before calling the rates API', async () => {
  const requests = [];
  const service = load(async url => {
    requests.push(url);
    return result({ ...lagosAddress, state: 'Oyo' });
  });
  await assert.rejects(service.getShipbubblePickupQuote(service.shipbubbleQuoteConfig(), recipient, item), { reason: 'invalid_address' });
  assert.equal(requests.length, 1);
});

test('selects a valid sandbox fallback and treats missing valid quotes as unavailable', async () => {
  const couriers = [
    { service_type: 'pickup', service_code: 'kwik', currency: 'NGN', total: -1 },
    { service_type: 'pickup', service_code: 'other', currency: 'USD', total: 100 },
  ];
  const service = load(async url => url.endsWith('/validate') ? result(lagosAddress) : result({ couriers }));
  assert.equal(await service.getShipbubblePickupQuote(service.shipbubbleQuoteConfig(), recipient, item), null);
  couriers.push({ service_type: 'pickup', service_code: 'test', currency: 'NGN', total: 1250 });
  assert.deepEqual(await service.getShipbubblePickupQuote(service.shipbubbleQuoteConfig(), recipient, item),
    { feeKobo: 125000, eta: null, kwik: false });
});
