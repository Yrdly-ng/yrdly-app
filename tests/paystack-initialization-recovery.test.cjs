const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(path, dependencies, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)(
    name => name in dependencies ? dependencies[name] : require(name), module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

function fixture({ status = 400, message = '"email" must be a valid email', body, networkFailure = false, closeFailure = false } = {}) {
  const calls = { closed: 0, flagged: 0, initialized: 0 };
  let state = 'reserved';
  const env = { PAYSTACK_SECRET_KEY: 'sk_test_fixture', PAYSTACK_EVENT_CHECKOUT_ENABLED: 'true', PAYSTACK_SANDBOX_PROJECT_REF: 'fixture', NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co' };
  const api = load('src/lib/payments/paystack-service.ts', { 'server-only': {} }, {
    process: { env }, fetch: async () => {
      calls.initialized++;
      if (networkFailure) throw new Error('network interrupted');
      return new Response(JSON.stringify(body ?? { status: false, message }), { status });
    },
  });
  const tx = { id: 'fixture-order', buyer_id: 'buyer', seller_id: 'organizer', payment_reference: 'evt-fixture', total_amount: 3000 };
  const admin = {
    rpc: async name => {
      if (name === 'reserve_paystack_ticket_checkout') return { data: { transaction: tx } };
      assert.equal(name, 'close_paystack_ticket_checkout');
      calls.closed++;
      if (closeFailure) return { error: new Error('concurrent payment prevents close') };
      state = 'closed';
      return { error: null };
    },
    from: table => {
      let update;
      const result = () => {
        if (table === 'events') return { data: { organizer_id: 'organizer' } };
        if (table === 'escrow_transactions') return { data: tx };
        assert.equal(table, 'paystack_ticket_orders');
        if (update) { state = update.state; return { data: { transaction_id: tx.id } }; }
        return { data: { state, domain: 'test' } };
      };
      const query = {
        select: () => query, eq: () => query, or: () => query,
        update: value => { update = value; return query; }, single: async () => result(), maybeSingle: async () => result(),
      };
      return query;
    },
  };
  class TicketCheckoutError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
  const service = load('src/lib/events/paystack-ticket-service.ts', {
    'server-only': {}, 'next/server': {}, qrcode: {},
    '@/lib/supabase/supabase-admin': { supabaseAdmin: admin },
    '@/lib/payments/paystack-service': api,
    '@/lib/payments/payment-state': { paymentReferenceFilter: () => '' },
    '@/lib/payments/payment-reconciliation': { flagPayment: async () => { calls.flagged++; } },
    './ticket-checkout': { TicketCheckoutError },
    '@/lib/email/resend-service': {}, '@/lib/notifications/server-push-notification': {}, './paystack-event-finance': {},
  }, { process: { env } });
  return {
    calls, state: () => state,
    run: () => service.createPaystackTicketCheckout({ buyer_id: 'buyer', event_id: 'event', attendee_email: 'buyer@example.test' }, 'https://app.yrdly.ng/payment/callback'),
  };
}

test('known provider email rejection closes the reservation before returning a correction message', async () => {
  const f = fixture();
  await assert.rejects(f.run(), error => error.status === 400 && error.message === 'Use a valid attendee email address');
  assert.equal(f.state(), 'closed');
  assert.deepEqual(f.calls, { closed: 1, flagged: 0, initialized: 1 });
});

for (const [name, options] of [
  ['duplicate reference', { message: 'Duplicate Transaction Reference' }],
  ['unknown validation rejection', { message: 'Invalid request' }],
  ['provider server error containing email message', { status: 500 }],
  ['contradictory successful envelope', { body: { status: true, message: '"email" must be a valid email' } }],
  ['response with transaction data', { body: { status: false, message: '"email" must be a valid email', data: { reference: 'evt-fixture' } } }],
  ['network interruption', { networkFailure: true }],
]) {
  test(`${name} keeps the order held without another initialization`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), error => error.status === 502);
    assert.equal(f.state(), 'initializing');
    assert.deepEqual(f.calls, { closed: 0, flagged: 1, initialized: 1 });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.equal(f.calls.initialized, 1);
  });
}

test('a failed atomic close preserves the hold and requests reconciliation', async () => {
  const f = fixture({ closeFailure: true });
  await assert.rejects(f.run(), error => error.status === 502);
  assert.equal(f.state(), 'initializing');
  assert.deepEqual(f.calls, { closed: 1, flagged: 1, initialized: 1 });
});
