const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const filename = path.resolve(file);
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, console, Buffer,
    require(id) {
      const name = path.basename(id);
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
      return require(id);
    },
  }, { filename });
  return module.exports;
}

const transaction = () => ({
  id: '00000000-0000-4000-8000-000000000001', item_type: 'ticket',
  payment_provider: 'payluk', buyer_id: 'buyer', item_id: 'tier', status: 'paid',
  amount: 4000, payluk_tx_ref: 'PY_TEST', payluk_escrow_id: 'provider-escrow',
  metadata: { event_id: 'event', quantity: 2, attendee_name: 'Ada', attendee_email: 'ada@example.test' },
});

function fixture(options = {}) {
  const tx = transaction();
  const saved = options.existing || [];
  let ticketReads = 0, inserts = 0, providerReads = 0, flags = 0;
  const completed = () => Array.from({ length: 2 }, (_, i) => ({ id: `ticket-${i}`, event_id: 'event', ticket_code: `CODE-${i}`, qr_data: '{}' }));
  const admin = { from(table) {
    let operation = 'select', payload;
    const query = {};
    for (const method of ['select', 'eq', 'or', 'in', 'single', 'maybeSingle']) query[method] = () => query;
    query.insert = value => { operation = 'insert'; payload = value; return query; };
    query.update = value => { operation = 'update'; payload = value; return query; };
    query.then = (resolve, reject) => Promise.resolve().then(() => {
      if (table === 'tickets' && operation === 'select') {
        ticketReads++;
        if (options.lookupError) return { error: { message: 'ticket lookup unavailable' } };
        if (options.race && ticketReads === 1) return { data: [] };
        return { data: options.race ? completed() : saved };
      }
      if (table === 'tickets' && operation === 'insert') {
        inserts++;
        if (options.insertError) return { error: options.insertError };
        for (const [i, ticket] of payload.entries()) saved.push({ ...ticket, id: `ticket-${i}` });
        return { data: saved };
      }
      if (table === 'ticket_tiers') return { data: { id: 'tier', name: 'General', price: 2000, sold: options.sold || 0, capacity: 2 } };
      if (table === 'events') return { data: { id: 'event', title: 'Meetup', start_time: '2027-01-01T12:00:00Z', organizer_id: 'owner' } };
      if (table === 'escrow_transactions') {
        if (operation === 'update') Object.assign(tx, payload);
        return { data: tx };
      }
      return { data: null };
    }).then(resolve, reject);
    return query;
  } };
  const { TicketService } = load('src/lib/events/ticket-service.ts', {
    'supabase-admin': { supabaseAdmin: admin },
    'resend-service': { ResendEmailService: { isConfigured: () => false } },
    qrcode: {}, 'server-push-notification': { sendPushNotification: async () => {} },
    'payluk-service': { PaylukService: { verifyEscrow: async () => { providerReads++; return options.provider || { status: 'ONGOING', amount: 4000 }; } } },
    'payment-reconciliation': { flagPayment: async () => { flags++; } },
  });
  return { TicketService, tx, saved, counts: () => ({ ticketReads, inserts, providerReads, flags }) };
}

test('confirmed payment issues each purchased ticket once and repeated callbacks reuse it', async () => {
  const f = fixture();
  const first = await f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer');
  const replay = await f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer');
  assert.equal(first.id, replay.id);
  assert.equal(f.saved.length, 2);
  assert.equal(new Set(f.saved.map(ticket => ticket.ticket_code)).size, 2);
  assert.deepEqual(f.saved.map(ticket => ticket.purchase_ticket_index), [0, 1]);
  assert.ok(f.saved.every(ticket => ticket.buyer_id === 'buyer' && ticket.amount_paid === 2000 && JSON.parse(ticket.qr_data).ticket_code === ticket.ticket_code));
  assert.equal(f.counts().inserts, 1);
  assert.equal(f.counts().providerReads, 0);
});

for (const error of [{ code: '23505', message: 'duplicate purchase ordinal' }, { message: 'ticket_tier_sold_out' }, { message: 'ticket_buyer_limit' }]) {
  test(`simultaneous callback returns already-issued tickets after ${error.message}`, async () => {
    const f = fixture({ race: true, insertError: error });
    const result = await f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer');
    assert.equal(result.id, 'ticket-0');
    assert.equal(result.quantity, 2);
  });
}

test('capacity read racing successful fulfilment does not report a false refund requirement', async () => {
  const f = fixture({ race: true, sold: 2, insertError: { message: 'ticket_tier_sold_out' } });
  assert.equal((await f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer')).id, 'ticket-0');
});

test('failed idempotency lookup cannot start ticket issuance', async () => {
  const f = fixture({ lookupError: true });
  await assert.rejects(f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer'), error => error.message === 'ticket lookup unavailable');
  assert.equal(f.counts().inserts, 0);
});

test('incomplete prior issuance is flagged for review rather than reported successful', async () => {
  const f = fixture({ existing: [{ id: 'ticket-0' }] });
  await assert.rejects(f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer'), /payment_requires_review/);
  assert.equal(f.counts().inserts, 0);
});

for (const [name, change, expected] of [
  ['other buyer', f => {}, 'ticket_buyer_mismatch'],
  ['unpaid provider', f => { f.tx.status = 'pending'; }, 'payment_pending'],
  ['wrong amount', f => { f.tx.status = 'pending'; }, 'payment_requires_review'],
  ['cancelled transaction', f => { f.tx.status = 'cancelled'; }, 'payment_requires_review'],
]) {
  test(`verification refuses ${name} without issuing tickets`, async () => {
    const f = fixture({ provider: { status: name === 'unpaid provider' ? 'PENDING' : 'ONGOING', amount: 1 } });
    change(f);
    await assert.rejects(f.TicketService.verifyAndProcessTicket(f.tx.id, name === 'other buyer' ? 'stranger' : 'buyer'), new RegExp(expected));
    assert.equal(f.counts().inserts, 0);
    if (name === 'wrong amount') assert.equal(f.counts().flags, 1);
  });
}

test('genuine sold out failure remains actionable when no other callback issued tickets', async () => {
  const f = fixture({ insertError: { message: 'ticket_tier_sold_out' } });
  await assert.rejects(f.TicketService.verifyAndProcessTicket(f.tx.id, 'buyer'), /sold_out_payluk_refund_required/);
});
