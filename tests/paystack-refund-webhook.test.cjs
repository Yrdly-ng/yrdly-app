const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function fixture(options = {}) {
  const calls = { verified: [], reconciled: [] };
  const tx = 'order-1';
  const providerId = '101';
  const refunds = options.refunds ?? [{ id: 'refund-1', transaction_id: tx, provider_refund_id: providerId, amount_kobo: 300000 }];
  const tables = {
    escrow_transactions: options.unknownOrder ? [] : [{ id: tx, payment_reference: 'evt-payment', payment_provider: 'paystack', item_type: 'ticket' }],
    paystack_ticket_refunds: refunds,
    paystack_ticket_orders: [{ transaction_id: tx, provider_transaction_id: '501' }],
    paystack_event_earnings: [{ transaction_id: tx, domain: 'test' }],
  };
  const admin = {
    from(table) {
      assert.ok(table in tables, `Unexpected table ${table}`);
      const filters = [];
      const result = single => {
        const rows = tables[table].filter(row => filters.every(fn => fn(row)));
        return single && rows.length > 1 ? { data: null, error: { message: 'Ambiguous result' } } : { data: single ? rows[0] ?? null : rows, error: null };
      };
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push(row => row[key] === value); return query; },
        not: (key, operator, value) => { assert.equal(operator, 'is'); assert.equal(value, null); filters.push(row => row[key] != null); return query; },
        limit: () => query,
        single: async () => result(true), maybeSingle: async () => result(true),
        then: (resolve, reject) => Promise.resolve(result(false)).then(resolve, reject),
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'reconcile_paystack_ticket_refund');
      const row = refunds.find(refund => refund.id === args.p_refund_id);
      if (row.amount_kobo !== args.p_amount) return { error: { message: 'refund_verification_mismatch' } };
      calls.reconciled.push(args);
      return { error: null };
    },
  };
  const source = ts.transpileModule(fs.readFileSync('src/lib/events/paystack-event-finance.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const deps = {
    'server-only': {},
    '@/lib/supabase/supabase-admin': { supabaseAdmin: admin },
    '@/lib/payments/paystack-service': {
      paystackKeyMode: () => 'test', getPaystackEventMode: () => 'test',
      PaystackService: { async getRefund(id) {
        calls.verified.push(id);
        if (options.providerFailure) throw Error('Provider unavailable');
        return { id: Number(id), transaction: { id: 501 }, currency: 'NGN', domain: 'test', amount: 300000, status: 'processed', ...options.verified };
      } },
    },
  };
  new Function('require', 'module', 'exports', source)(name => { assert.ok(name in deps); return deps[name]; }, module, module.exports);
  return { calls, run: data => module.exports.reconcilePaystackFinancialWebhook('refund.processed', data) };
}

const documented = { transaction_reference: 'evt-payment', refund_reference: null, amount: '300000', currency: 'NGN', domain: 'test', status: 'processed' };

test('documented refund webhook without an id verifies its stored provider refund and reconciles', async () => {
  const f = fixture();
  await f.run(documented);
  assert.deepEqual(f.calls.verified, ['101']);
  assert.equal(f.calls.reconciled.length, 1);
  assert.equal(f.calls.reconciled[0].p_status, 'processed');
});

test('existing id-bearing webhook still reconciles using authoritative provider state', async () => {
  const f = fixture({ verified: { status: 'pending' } });
  await f.run({ id: 101, status: 'processed' });
  assert.deepEqual(f.calls.verified, ['101']);
  assert.equal(f.calls.reconciled[0].p_status, 'pending');
});

for (const mutation of [{ domain: 'live' }, { currency: 'USD' }, { amount: 'NaN' }, { amount: -1 }, { transaction_reference: '../invalid' }]) {
  test(`documented refund webhook rejects invalid identity ${JSON.stringify(mutation)}`, async () => {
    const f = fixture();
    await assert.rejects(f.run({ ...documented, ...mutation }), /identity mismatch/);
    assert.equal(f.calls.verified.length, 0);
    assert.equal(f.calls.reconciled.length, 0);
  });
}

test('unknown order does not touch another payment', async () => {
  const f = fixture({ unknownOrder: true });
  await f.run(documented);
  assert.equal(f.calls.verified.length, 0);
});

for (const refunds of [[], [
  { id: 'refund-1', transaction_id: 'order-1', provider_refund_id: '101', amount_kobo: 300000 },
  { id: 'refund-2', transaction_id: 'order-1', provider_refund_id: '102', amount_kobo: 300000 },
]]) {
  test(`missing or ambiguous refund identity fails closed (${refunds.length} matches)`, async () => {
    const f = fixture({ refunds });
    await assert.rejects(f.run(documented), /reference reconciliation/);
    assert.equal(f.calls.reconciled.length, 0);
  });
}

for (const verified of [{ domain: 'live' }, { amount: 1 }, { transaction: { id: 999 } }]) {
  test(`provider mismatch cannot complete refund ${JSON.stringify(verified)}`, async () => {
    const f = fixture({ verified });
    await assert.rejects(f.run(documented), /mismatch/);
    assert.equal(f.calls.reconciled.length, 0);
  });
}

test('provider failure is retriable and cannot complete refund', async () => {
  const f = fixture({ providerFailure: true });
  await assert.rejects(f.run(documented), /Provider unavailable/);
  assert.equal(f.calls.reconciled.length, 0);
});
