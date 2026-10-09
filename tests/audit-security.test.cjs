const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire,
    console, AbortSignal, Response, URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
    process: { env: { PAYLUK_SECRET_KEY: 'test-only', ...mocks.env } },
    fetch: mocks.fetch || (() => { throw new Error('Live network is prohibited in audit tests'); }),
  }, { filename });
  return module.exports;
}

function chain(result) {
  const query = {};
  for (const method of ['select','eq','neq','is','in','or','limit','update','insert','single','maybeSingle','delete']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

test('onboarding rejects an unverified phone before calling Payluk', async () => {
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ data: { phone: '08012345678', phone_verified: false } }) } },
    './payluk-service': { PaylukService: {} },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /Verify your phone/);
});

test('stored Payluk identity with a different phone is rejected without remapping', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => { reads++; return chain({ data: { phone: '08012345678', phone_verified: true, payluk_customer_id: 'existing' } }); } } },
    './payluk-service': { PaylukService: { getCustomerById: async () => ({ customerId: 'existing', phone: '08098765432' }) } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /identity could not be verified/);
  assert.equal(reads, 1);
});

test('Payluk mapping held by another Yrdly user is rejected', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ data: ++reads === 1
      ? { phone: '08012345678', phone_verified: true, payluk_customer_id: 'existing' } : [{ id: 'other' }] }) } },
    './payluk-service': { PaylukService: { getCustomerById: async () => ({ customerId: 'existing', phone: '+2348012345678' }) } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /already linked/);
});

test('escrow transition refuses another seller', async () => {
  const { POST } = load('src/app/api/transactions/[id]/status/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'outsider' } } }) },
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => chain({ data: { buyer_id: 'buyer', seller_id: 'seller', status: 'paid' } }) } },
  });
  const result = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ action: 'shipped' }) }), { params: Promise.resolve({ id: 'tx' }) });
  assert.equal(result.status, 403);
});

test('payout accounts enforce verification and cooling period', () => {
  const { payoutAccountError } = load('src/lib/payout-account.ts');
  assert.match(payoutAccountError({ is_active: true, verification_status: 'pending' }), /verified/);
  assert.match(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: new Date().toISOString() }), /24 hours/);
  assert.equal(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: null }), null);
});

module.exports = { load, chain };

for (const [status, expected] of [['pending','pending'],['failed','failed'],['success','success'],['successful','pending'],[undefined,'pending']]) {
  test(`withdrawal envelope 200 with ${status} yields ${expected}`, async () => {
    let persisted = false;
    let executions = 0;
    const { PaylukService } = load('src/lib/payluk-service.ts', {
      './payluk-onboarding': {},
      fetch: async (url, options) => {
        if (url.endsWith('/v1/wallet')) return Response.json({ status: 200, data: { mainBalance: 10000 } });
        if (url.endsWith('/v1/payment/create-intent')) {
          const intent = JSON.parse(options.body);
          return Response.json({ status: 200, data: { amount: intent.amount, fee: 50, reference: intent.reference } });
        }
        assert.equal(url.endsWith('/v1/payment/verify'), true);
        assert.equal(persisted, true, 'Persist the intent before executing any transfer');
        executions++;
        return Response.json({ status: 200, data: { status } });
      },
    });
    const result = await PaylukService.withdrawToBank({ sellerPaylukCustomerId: 'customer', amount: 2000,
      bankCode: '044', accountNumber: '0000000000', reference: 'stable-operation', onIntentReady: async reference => {
        assert.equal(reference, 'stable-operation-net'); persisted = true;
      } });
    assert.equal(result.outcome, expected);
    assert.equal(result.success, expected === 'success');
    assert.equal(executions, 1);
  });
}

test('network loss after transfer execution keeps the result pending', async () => {
  const { PaylukService } = load('src/lib/payluk-service.ts', { './payluk-onboarding': {}, fetch: async (url, options) => {
    if (url.endsWith('/v1/wallet')) return Response.json({ status: 200, data: { mainBalance: 10000 } });
    if (url.endsWith('/v1/payment/create-intent')) {
      const intent = JSON.parse(options.body);
      return Response.json({ status: 200, data: { ...intent, fee: 50 } });
    }
    throw new Error('Simulated connection loss');
  } });
  const result = await PaylukService.withdrawToBank({ sellerPaylukCustomerId: 'customer', amount: 2000,
    bankCode: '044', accountNumber: '0000000000', reference: 'stable-operation', onIntentReady: async () => {} });
  assert.equal(result.outcome, 'pending');
  assert.equal(result.reference, 'stable-operation-net');
});

test('suspension lookup errors fail closed', async () => {
  const { isUserSuspendedOrBanned } = load('src/lib/user-suspension.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ error: { message: 'database unavailable' } }) } },
  });
  await assert.rejects(isUserSuspendedOrBanned('user'), /could not be verified/);
});

test('provider references never get compared with a UUID id column', () => {
  const { paymentReferenceFilter } = load('src/lib/payment-state.ts');
  assert.equal(paymentReferenceFilter('provider-123', ['id','payment_reference']), 'payment_reference.eq.provider-123');
  assert.throws(() => paymentReferenceFilter('x,amount.gt.0', ['id','payment_reference']), /Invalid payment reference/);
});

test('event payout includes USED tickets and keeps pending withdrawals unreleased', async () => {
  const updates = [];
  const admin = { from(table) {
    const operations = [];
    const query = {};
    for (const method of ['select','eq','in','is','single','maybeSingle','delete','insert','update']) query[method] = (...args) => { operations.push([method,...args]); return query; };
    query.then = (resolve, reject) => {
      let data;
      if (table === 'tickets') {
        const allowed = operations.find(([op]) => op === 'in')[2];
        data = [{ status: 'USED', amount_paid: 2000, payment_provider: 'payluk', settlement_mode: 'held' }].filter(ticket => allowed.includes(ticket.status));
      } else if (table === 'seller_accounts') data = { account_details: { bank_code: '044', account_number: '0000000000' }, updated_at: '2026-01-01' };
      else if (operations.some(([op]) => op === 'insert')) {
        assert.equal(operations.find(([op]) => op === 'insert')[1].gross_amount, 2000);
        data = { id: 'payout' };
      } else data = null;
      const update = operations.find(([op]) => op === 'update');
      if (update) updates.push({ table, ...update[1] });
      return Promise.resolve({ data, error: null }).then(resolve,reject);
    };
    return query;
  } };
  const { EventEscrowService } = load('src/lib/event-escrow-service.ts', {
    '@supabase/supabase-js': { createClient: () => admin },
    './payluk-service': { PaylukService: { withdrawToBank: async params => {
      await params.onIntentReady('intent'); return { outcome: 'pending', success: false };
    } } },
    './paystack-service': { PaystackService: { transferToSeller: async () => { throw new Error('Cross-provider fallback prohibited'); } } },
    './payluk-onboarding': { getPaylukCustomerId: async () => 'customer' },
    './ticket-payment-provider': {}, './ticket-refunds': {},
  });
  await assert.rejects(EventEscrowService.processEventPayout('event','organizer'), /pending/);
  assert.equal(updates.some(update => update.table === 'events'), false);
  assert.equal(updates.some(update => update.status === 'PROCESSING'), true);
  assert.equal(updates.some(update => update.status === 'COMPLETED'), false);
});


test('ticket verification rejects anonymous callers before fulfillment', async () => {
  const { POST } = load('src/app/api/events/tickets/verify/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: null } }) },
    '@/lib/ticket-service': { TicketService: { verifyAndProcessTicket: () => { throw new Error('Must not run'); } } },
  });
  assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: '{"tx_ref":"known"}' }))).status, 401);
});

test('ticket verification checks buyer and strips credentials', async () => {
  const { POST } = load('src/app/api/events/tickets/verify/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } } }) },
    '@/lib/ticket-service': { TicketService: { verifyAndProcessTicket: async (ref, buyer) => {
      assert.equal(buyer, 'buyer');
      if (ref === 'other') throw new Error('ticket_buyer_mismatch');
      return { id: 'ticket', event_id: 'event', ticket_code: 'secret', qr_data: 'secret' };
    } } },
  });
  const request = ref => new Request('http://localhost', { method: 'POST', body: JSON.stringify({ tx_ref: ref }) });
  assert.equal((await POST(request('other'))).status, 403);
  assert.deepEqual(await (await POST(request('own'))).json(), { success: true, ticket: { id: 'ticket', event_id: 'event' } });
});

for (const [scenario, expected] of [['outsider',403],['wrong-event',404],['refunded',409],['expired',400],['used',409],['race-lost',409],['valid',200]]) {
  test(`check-in ${scenario} yields ${expected}`, async () => {
    let writes = 0;
    const { POST } = load('src/app/api/events/checkin/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: scenario === 'outsider' ? 'other' : 'organizer' } } }) },
      '@/lib/supabase-admin': { supabaseAdmin: { from(table) {
        if (table === 'events') return chain({ data: { organizer_id: 'organizer', status: 'PUBLISHED' } });
        const query = chain({ data: scenario === 'wrong-event' ? null : { id: 'ticket', status: scenario === 'used' ? 'USED' : 'PAID', refund_status: scenario === 'refunded' ? 'requested' : null, expires_at: scenario === 'expired' ? '2020-01-01' : null } });
        query.update = () => { writes++; return chain({ data: scenario === 'race-lost' ? [] : [{ id: 'ticket' }] }); };
        return query;
      } } },
    });
    const result = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ticket_code: 'TC-TEST', event_id: '00000000-0000-0000-0000-000000000001' }) }));
    assert.equal(result.status, expected);
    assert.equal(writes, ['valid','race-lost'].includes(scenario) ? 1 : 0);
  });
}

test('event creation removes incomplete event when tier save fails', async () => {
  let removed = false;
  const { POST } = load('src/app/api/events/create/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'organizer' } } }) },
    '@/lib/supabase-admin': { supabaseAdmin: {
      functions: { invoke: async () => ({ data: { isSafe: true } }) },
      from(table) {
        if (table === 'ticket_tiers') return chain({ error: { code: 'test-failure' } });
        const query = chain({ data: { id: 'draft' } });
        query.insert = payload => { assert.equal(payload.status, 'DRAFT'); return query; };
        query.delete = () => { removed = true; return query; };
        return query;
      },
    } },
  });
  const result = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ title: 'Test', startTime: '2026-11-01', endTime: '2026-11-02', publish: true, ticketTiers: [{ name: 'Free', price: 0, capacity: 10 }] }) }));
  assert.equal(result.status, 500);
  assert.equal(removed, true);
});
