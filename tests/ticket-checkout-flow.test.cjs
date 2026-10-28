const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const crypto = require('node:crypto');

const eventId = '10000000-0000-0000-0000-000000000001';
const tierId = '20000000-0000-0000-0000-000000000001';
const txId = '30000000-0000-0000-0000-000000000001';
const input = { event_id: eventId, tier_id: tierId, buyer_id: 'buyer', quantity: 2, attendee_name: 'Ada', attendee_email: 'ada@example.test', attendee_phone: null };
function harness({ providerFailure, identityFailure, reserveError } = {}) {
  const calls = [];
  const tables = {
    escrow_transactions: [], tickets: [], ticket_checkout_reservations: [], notifications: [], users: [],
    events: [{ id: eventId, organizer_id: 'organizer', title: 'Test gathering', end_time: '2099-01-02T12:00:00Z', start_time: '2099-01-01T12:00:00Z', attendee_count: 0 }],
    ticket_tiers: [{ id: tierId, event_id: eventId, price: 2000, capacity: 20, sold: 0, name: 'General' }],
  };
  let provider = null;
  function from(table) {
    let operation = 'read', payload, single = false;
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push((r) => r[key] === value); return query; },
      is(key, value) { filters.push((r) => (r[key] ?? null) === value); return query; },
      in(key, values) { filters.push((r) => values.includes(r[key])); return query; },
      gt(key, value) { filters.push((r) => r[key] > value); return query; },
      lte(key, value) { filters.push((r) => r[key] <= value); return query; },
      or(clause) { const terms = clause.split(',').map((s) => s.split('.eq.')); filters.push((r) => terms.some(([key,value]) => r[key] === value)); return query; },
      order() { return query; }, limit() { return query; },
      update(value) { operation = 'update'; payload = value; return query; },
      insert(value) { operation = 'insert'; payload = Array.isArray(value) ? value : [value]; return query; },
      maybeSingle() { single = true; return query; }, single() { single = true; return query; },
      then(resolve, reject) {
        try {
          let rows = tables[table].filter((r) => filters.every((f) => f(r)));
          if (operation === 'update') rows.forEach((r) => Object.assign(r, payload));
          if (operation === 'insert') {
            rows = payload.map((r, i) => ({ id: `${table}-${tables[table].length + i}`, ...r }));
            if (table === 'tickets') {
              for (const r of rows) {
                if (tables.tickets.some((t) => t.payment_tx_ref === r.payment_tx_ref && t.purchase_ticket_index === r.purchase_ticket_index)) return resolve({ data: null, error: { code: '23505' } });
                const reservation = tables.ticket_checkout_reservations.find((v) => v.transaction_id === r.payment_tx_ref);
                if (reservation) reservation.remaining -= 1;
                tables.ticket_tiers[0].sold += 1;
              }
            }
            tables[table].push(...rows);
          }
          return resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null });
        } catch (error) { return reject(error); }
      },
    };
    return query;
  }
  const db = { from, rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'reserve_ticket_checkout') {
      if (reserveError) return { data: null, error: { message: reserveError } };
      let tx = tables.escrow_transactions.find((t) => t.status !== 'cancelled');
      if (!tx) {
        tx = { id: txId, item_id: tierId, item_type: 'ticket', buyer_id: 'buyer', seller_id: 'organizer', status: 'pending', amount: 4000, commission: 120, total_amount: 4000, payment_provider: 'payluk', payment_reference: 'evt-test', payluk_tx_ref: null, payluk_escrow_id: null, metadata: { ...input, payluk_fee_mode: 'seller_commission_v1' } };
        tables.escrow_transactions.push(tx);
        tables.ticket_checkout_reservations.push({ transaction_id: txId, tier_id: tierId, remaining: 2, expires_at: '2099-01-01' });
      }
      return { data: { transaction: structuredClone(tx) }, error: null };
    }
    if (name === 'release_ticket_checkout') {
      tables.escrow_transactions[0].status = 'cancelled';
      tables.ticket_checkout_reservations[0].remaining = 0;
      return { error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  } };
  const payluk = {
    updateCustomerPermissions: async () => {},
    createEscrow: async (seller, body) => {
      calls.push({ name: 'createEscrow', seller, body });
      if (providerFailure) throw new Error(providerFailure);
      provider = { id: 'provider-id', paymentToken: 'PY_TOKEN', status: 'PENDING', state: 'AWAITING_PAYMENT', fee: 80, ...body };
      return structuredClone(provider);
    },
    addAdditionalFee: async (token, fee) => { provider.additionalFee = fee; },
    verifyEscrow: async () => { calls.push({ name: 'verifyEscrow' }); return structuredClone(provider); },
    deleteEscrow: async () => { calls.push({ name: 'deleteEscrow' }); provider.status = 'DELETED'; },
  };
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file];
    const module = { exports: {} };
    cache[file] = module.exports;
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', output)((name) => {
      if (name === 'server-only') return {};
      if (name === 'next/server') return { after: () => {} };
      if (name.includes('paystack-service')) return { getPaystackEventMode: () => null };
      if (name.includes('paystack-ticket-service')) return {};
      if (name.includes('supabase-admin')) return { supabaseAdmin: db };
      if (name.includes('payluk-service')) return { PaylukService: payluk };
      if (name.includes('payluk-onboarding')) return { getPaylukCustomerId: async (user) => { if (identityFailure) throw new Error(identityFailure); return `provider-${user}`; } };
      if (name.includes('payment-reconciliation')) return { flagPayment: async (...args) => calls.push({ name: 'flagPayment', args }) };
      if (name.includes('resend-service')) return { ResendEmailService: { isConfigured: () => false } };
      if (name.includes('server-push-notification')) return { sendPushNotification: async () => {} };
      if (name.includes('server-notification-service')) return { NotificationService: { createNotification: async () => ({}) } };
      if (name.includes('constants')) return { EVENT_CONSTANTS: { TICKET_CODE_PREFIX: 'YRD' } };
      if (name === 'qrcode') return { toDataURL: async () => 'data:qr' };
      if (name === 'node:crypto') return crypto;
      if (name.startsWith('@/')) return load(`${name.replace('@/', 'src/')}.ts`);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      throw new Error(`Unexpected dependency ${name}`);
    }, module, module.exports);
    return (cache[file] = module.exports);
  }
  return {
    calls, tables,
    checkout: load('src/lib/events/ticket-checkout.ts'),
    ticketService: load('src/lib/events/ticket-service.ts').TicketService,
    provider: () => provider,
    create: () => load('src/lib/events/ticket-checkout.ts').createTicketCheckout(input, '2x General', new Date(Date.now() + 86400000).toISOString()),
  };
}

test('paid ticket flow reserves once, reopens existing checkout, verifies payment, issues two QR tickets exactly once', async () => {
  const h = harness();
  const checkout = await h.create();
  assert.equal(checkout.totalAmount, 4000);
  assert.equal(h.provider().amount + h.provider().additionalFee, 4000);
  assert.equal(h.tables.tickets.length, 0);
  const retry = await h.create();
  assert.equal(retry.transactionId, checkout.transactionId);
  assert.equal(h.calls.filter((c) => c.name === 'createEscrow').length, 1);
  await assert.rejects(h.ticketService.verifyAndProcessTicket(checkout.tx_ref, 'buyer'), /payment_pending/);
  assert.equal(h.tables.tickets.length, 0);
  Object.assign(h.provider(), { status: 'ONGOING', state: 'OPENED' });
  const issued = await h.ticketService.verifyAndProcessTicket(checkout.tx_ref, 'buyer');
  const repeated = await h.ticketService.verifyAndProcessTicket(checkout.tx_ref, 'buyer');
  assert.equal(issued.id, repeated.id);
  assert.equal(h.tables.tickets.length, 2);
  assert.equal(h.tables.ticket_checkout_reservations[0].remaining, 0);
  assert.equal(h.tables.ticket_tiers[0].sold, 2);
  assert.equal(h.tables.escrow_transactions[0].status, 'paid');
  for (const ticket of h.tables.tickets) {
    assert.equal(ticket.status, 'PAID');
    assert.equal(ticket.buyer_id, 'buyer');
    assert.equal(JSON.parse(ticket.qr_data).ticket_code, ticket.ticket_code);
    assert.equal(JSON.parse(ticket.qr_data).event_id, eventId);
  }
});

test('verification refuses a different buyer and a provider amount mismatch without issuing tickets', async () => {
  const h = harness(); const checkout = await h.create();
  Object.assign(h.provider(), { status: 'ONGOING', state: 'OPENED' });
  await assert.rejects(h.ticketService.verifyAndProcessTicket(checkout.tx_ref, 'another-buyer'), /ticket_buyer_mismatch/);
  h.provider().amount = 1;
  await assert.rejects(h.ticketService.verifyAndProcessTicket(checkout.tx_ref, 'buyer'), /payment_requires_review/);
  assert.equal(h.tables.tickets.length, 0);
  assert.equal(h.tables.escrow_transactions[0].status, 'pending');
  assert.ok(h.calls.some((c) => c.name === 'flagPayment'));
});

test('uncertain provider creation keeps the reservation held and prevents replacement checkout', async () => {
  const h = harness({ providerFailure: 'Connection lost after submission' });
  await assert.rejects(h.create(), /reconciliation/);
  assert.equal(h.tables.escrow_transactions[0].status, 'reconciling');
  assert.equal(h.tables.ticket_checkout_reservations[0].remaining, 2);
  await assert.rejects(h.create(), /processing or needs review/);
  assert.equal(h.calls.filter((c) => c.name === 'createEscrow').length, 1);
});

test('identity failure before provider submission releases the unpaid reservation', async () => {
  const h = harness({ identityFailure: 'Phone verification required' });
  await assert.rejects(h.create(), /prepare payment accounts/);
  assert.equal(h.tables.escrow_transactions[0].status, 'cancelled');
  assert.equal(h.tables.ticket_checkout_reservations[0].remaining, 0);
  assert.equal(h.calls.filter((c) => c.name === 'createEscrow').length, 0);
});

test('cancelling a paid checkout verifies and issues tickets instead of deleting or releasing its paid escrow', async () => {
  const h = harness(); const checkout = await h.create();
  Object.assign(h.provider(), { status: 'ONGOING', state: 'OPENED' });
  await assert.rejects(h.checkout.cancelTicketCheckout(checkout.transactionId, 'buyer'), /has been paid/);
  assert.equal(h.tables.tickets.length, 2);
  assert.equal(h.tables.escrow_transactions[0].status, 'paid');
  assert.equal(h.calls.filter((c) => c.name === 'deleteEscrow').length, 0);
});

test('unpaid cancellation deletes only the verified matching provider escrow before releasing seats', async () => {
  const h = harness(); const checkout = await h.create();
  await h.checkout.cancelTicketCheckout(checkout.transactionId, 'buyer');
  assert.equal(h.provider().status, 'DELETED');
  assert.equal(h.tables.escrow_transactions[0].status, 'cancelled');
  assert.equal(h.tables.ticket_checkout_reservations[0].remaining, 0);
  assert.equal(h.tables.tickets.length, 0);
});

test('sold-out reservation rejection never creates a provider checkout', async () => {
  const h = harness({ reserveError: 'ticket_tier_sold_out' });
  await assert.rejects(h.create(), /ticket_tier_sold_out/);
  assert.equal(h.calls.filter((c) => c.name === 'createEscrow').length, 0);
});

function purchaseRoute({ price = 2000, errorTable, eventEnd = '2099-01-02T12:00:00Z' } = {}) {
  const calls = [];
  const db = {
    from(table) {
      let operation = 'read', inserted;
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, single() { return chain; },
        update() { operation = 'update'; return chain; },
        insert(rows) { operation = 'insert'; inserted = rows; calls.push({ name: 'insert', table, rows }); return chain; },
        then(resolve) {
          if (operation === 'read' && errorTable === table) return resolve({ data: null, error: { code: 'DB_UNAVAILABLE' } });
          if (operation === 'insert') return resolve({ data: inserted.map((r, i) => ({ id: `free-${i}`, ...r })), error: null });
          const data = table === 'events' ? { id: eventId, organizer_id: 'organizer', status: 'PUBLISHED', title: 'Gathering', end_time: eventEnd }
            : table === 'ticket_tiers' ? { id: tierId, name: 'General', price, capacity: 20, sold: 0, is_visible: true } : [];
          return resolve({ data, error: null });
        },
      };
      return chain;
    },
    rpc: async (name) => { calls.push({ name }); return { data: true, error: null }; },
  };
  class TicketCheckoutError extends Error {}
  const mocks = {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/supabase/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } }, error: null }) },
    '@/lib/supabase/supabase-admin': { supabaseAdmin: db },
    '@/lib/moderation/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
    '@/lib/shared/constants': { EVENT_CONSTANTS: { TICKET_CODE_PREFIX: 'YRD' } },
    '@/lib/marketplace/price-policy': { isMoneyAmount: (v) => Number.isFinite(v) && v >= 0, isPaidPrice: (v) => v >= 1053, MINIMUM_PRICE_MESSAGE: 'Invalid price' },
    '@/lib/email/resend-service': { ResendEmailService: { isConfigured: () => false } },
    '@/lib/notifications/server-push-notification': { sendPushNotification: async () => {} },
    '@/lib/events/ticket-checkout': { TicketCheckoutError, createTicketCheckout: async () => { calls.push({ name: 'createTicketCheckout' }); return { success: true, paylukPaymentToken: 'PY_TOKEN' }; } },
    '@/lib/events/ticket-service': { TicketService: { notifyOrganizerOfTicketSale: async () => {} } },
    qrcode: {},
  };
  const output = ts.transpileModule(fs.readFileSync('src/app/api/events/tickets/purchase/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { calls, run: () => module.exports.POST(new Request('https://yrdly.test/api/events/tickets/purchase', { method: 'POST', body: JSON.stringify(input) })) };
}

for (const errorTable of ['events', 'ticket_tiers', 'tickets']) {
  test(`purchase fails closed with a retryable response when ${errorTable} lookup fails`, async () => {
    const h = purchaseRoute({ errorTable });
    const response = await h.run();
    assert.equal(response.status, 503);
    assert.equal(h.calls.filter((c) => ['createTicketCheckout', 'insert'].includes(c.name)).length, 0);
  });
}

test('numeric-string zero-price tiers issue free tickets without opening paid checkout', async () => {
  const h = purchaseRoute({ price: '0' });
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.free, true);
  assert.equal(body.quantity, 2);
  assert.equal(h.calls.filter((c) => c.name === 'createTicketCheckout').length, 0);
});

test('ended events cannot issue free tickets or start paid checkout', async () => {
  for (const price of [0, 2000]) {
    const h = purchaseRoute({ price, eventEnd: '2020-01-01T12:00:00Z' });
    const response = await h.run();
    assert.equal(response.status, 400);
    assert.equal(h.calls.filter((c) => ['createTicketCheckout', 'insert'].includes(c.name)).length, 0);
  }
});
