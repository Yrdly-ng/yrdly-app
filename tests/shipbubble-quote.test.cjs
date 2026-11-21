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
  new Function('exports', 'process', 'fetch', 'require', outputText)(exports, { env: { ...env, ...override } }, fetch, require);
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
  assert.deepEqual(quote, { feeKobo: 152035, eta: 'Same day', kwik: true, provider: undefined });
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
    { feeKobo: 125000, eta: null, kwik: false, provider: undefined });
});

test('paid delivery requires the extra flag and Payluk sandbox transport', () => {
  const supported = {
    SHIPBUBBLE_QA_PAID_DELIVERY: 'true',
    PAYLUK_SECRET_KEY: 'sk_test_fixture',
    PAYLUK_BASE_URL: 'https://staging.api.payluk.ng',
  };
  const enabled = load(undefined, supported);
  assert.equal(enabled.deliveryCheckoutEnabled(enabled.shipbubbleQuoteConfig()), true);
  for (const override of [{ SHIPBUBBLE_QA_PAID_DELIVERY: '' }, { PAYLUK_SECRET_KEY: 'sk_live_fixture' }, { PAYLUK_BASE_URL: 'https://api.payluk.ng' }]) {
    const disabled = load(undefined, { ...supported, ...override });
    assert.equal(disabled.deliveryCheckoutEnabled(disabled.shipbubbleQuoteConfig()), false);
  }
});

test('checkout token protects the merchant quote and rejects changed tokens and other keys', () => {
  const service = load();
  const config = service.shipbubbleQuoteConfig();
  const quote = {
    buyerId: 'buyer', itemId: 'listing', priceKobo: 250000, feeKobo: 42000,
    expiresAt: 2000000000000,
    provider: { requestToken: 'provider-opaque-reference', courierId: 'test', serviceCode: 'test' },
  };
  const token = service.sealDeliveryQuote(config, quote);
  assert.doesNotMatch(Buffer.from(token, 'base64url').toString(), /provider-opaque-reference/);
  assert.deepEqual(service.readDeliveryQuote(config, token), quote);
  assert.equal(service.readDeliveryQuote(config, (token[0] === 'a' ? 'b' : 'a') + token.slice(1)), null);
  assert.equal(service.readDeliveryQuote({ ...config, key: 'sb_sandbox_rotated' }, token), null);
});

test('only the saved courier and rate token go to the sandbox booking API', async () => {
  const service = load(async (url, options) => {
    assert.ok(url.endsWith('/shipping/labels'));
    assert.deepEqual(JSON.parse(options.body), { request_token: 'reference', service_code: 'test', courier_id: 'test-id' });
    return result({ order_id: 'SB-TEST-ORDER', tracking_url: 'http://localhost:3000/tracking' });
  });
  const config = service.shipbubbleQuoteConfig();
  const outcome = await service.bookShipbubbleDelivery(config, { provider: { requestToken: 'reference', courierId: 'test-id', serviceCode: 'test' } });
  assert.deepEqual(outcome, { shipmentId: 'SB-TEST-ORDER', trackingUrl: null });
});

test('Payluk funds the product principal and collects the verified delivery amount separately', () => {
  const state = {};
  const source = readFileSync('src/lib/payments/payment-state.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', compiled)(state);
  const tx = { amount: 2500, commission: 75, metadata: { payluk_fee_mode: 'native_commission_delivery_v1', delivery_fee_kobo: 42000 } };
  const escrow = { amount: 2500, additionalFee: 420, whoPays: 'seller', environment: 'test' };
  assert.equal(state.paylukAmountsMatch(tx, escrow), true);
  for (const override of [{ amount: 2920 }, { additionalFee: 0 }, { whoPays: 'buyer' }, { environment: 'live' }]) {
    assert.equal(state.paylukAmountsMatch(tx, { ...escrow, ...override }), false);
  }
});

test('seller dispatch claims the paid order before booking and blocks duplicate or uncertain dispatches', async () => {
  const source = readFileSync('src/lib/marketplace/shipbubble-dispatch.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const tx = {
    id: 'order', buyer_id: 'buyer', seller_id: 'seller', item_id: 'item', status: 'paid',
    payluk_escrow_id: 'escrow', payluk_tx_ref: 'payluk-ref', metadata: { delivery_fee_kobo: 42000 },
    delivery_details: { option: 'shipbubble', delivery_status: 'awaiting_seller', quote: 'sealed', quote_id: 'hash' },
  };
  let calls = 0;
  let fail = false;
  function query(updates) {
    const conditions = [];
    const state = {
      eq(key, value) { conditions.push([key, value]); return state; },
      select() { return state; },
      async maybeSingle() {
        const matches = conditions.every(([key, value]) => key.includes('->>')
          ? tx.delivery_details[key.split('->>')[1]] === value : tx[key] === value);
        if (!matches) return { data: null };
        if (updates) Object.assign(tx, updates);
        return { data: structuredClone(tx) };
      },
      then(resolve, reject) { return state.maybeSingle().then(resolve, reject); },
    };
    return state;
  }
  const modules = {
    '@/lib/supabase/supabase-admin': { supabaseAdmin: { from() { return { select: () => query(), update: values => query(values) }; } } },
    '@/lib/payments/payluk-service': { PaylukService: { async verifyEscrow() { return { id: 'escrow', status: 'ONGOING' }; } } },
    '@/lib/payments/payment-state': { paylukAmountsMatch: () => true },
    './shipbubble-quote': {
      shipbubbleQuoteConfig: () => ({}), deliveryCheckoutEnabled: () => true,
      readDeliveryQuote: () => ({ buyerId: 'buyer', itemId: 'item', feeKobo: 42000 }),
      async bookShipbubbleDelivery() {
        calls++;
        if (fail) throw new Error('timeout');
        return { shipmentId: 'SB-SHIPMENT', trackingUrl: null };
      },
    },
  };
  const dispatch = {};
  new Function('exports', 'require', outputText)(dispatch, name => modules[name]);
  assert.equal((await dispatch.dispatchDelivery('order', 'other')).status, 404);
  tx.status = 'pending';
  assert.equal((await dispatch.dispatchDelivery('order', 'seller')).status, 409);
  assert.equal(calls, 0);
  tx.status = 'paid';
  const concurrent = await Promise.all([dispatch.dispatchDelivery('order', 'seller'), dispatch.dispatchDelivery('order', 'seller')]);
  assert.ok(concurrent.some(response => response.status === 200));
  assert.equal(calls, 1);
  assert.equal(tx.delivery_details.shipment_id, 'SB-SHIPMENT');
  assert.equal((await dispatch.dispatchDelivery('order', 'seller')).status, 200);
  assert.equal(calls, 1);

  fail = true;
  tx.delivery_details = { option: 'shipbubble', delivery_status: 'awaiting_seller', quote: 'sealed', quote_id: 'second-hash' };
  assert.equal((await dispatch.dispatchDelivery('order', 'seller')).status, 502);
  assert.equal((await dispatch.dispatchDelivery('order', 'seller')).status, 409);
  assert.equal(calls, 2);
  assert.equal(tx.delivery_details.delivery_status, 'needs_review');

  assert.equal(dispatch.shouldAdvanceShipment('in_transit', 'confirmed'), false);
  assert.equal(dispatch.shouldAdvanceShipment('in_transit', 'completed'), true);
  assert.equal(dispatch.shouldAdvanceShipment('completed', 'cancelled'), false);
  assert.equal(dispatch.shouldAdvanceShipment('cancelled', 'completed'), false);
});
