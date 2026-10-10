const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx:ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'next/server') return { NextRequest: Request, NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire,
    console, AbortSignal, Response, URL, URLSearchParams, Buffer, TextDecoder, TextEncoder, FormData, setTimeout, clearTimeout,
    process: { env: { PAYLUK_SECRET_KEY: 'test-only', ...mocks.env } },
    ...mocks.globals,
    fetch: mocks.fetch || (() => { throw new Error('Live network is prohibited in audit tests'); }),
  }, { filename });
  return module.exports;
}

function chain(result) {
  const query = {};
  for (const method of ['select','eq','neq','is','in','or','contains','limit','update','insert','single','maybeSingle','delete','order']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

for (const credential of ['anonymous','publishable','user-jwt','forged-secret','legacy-service','modern-service']) {
  test(`push Edge authorization accepts only backend credentials: ${credential}`, async () => {
    let handler;
    load('supabase/functions/send-push-notification/index.ts', {
      'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
      'https://esm.sh/@supabase/supabase-js@2': { createClient: () => { throw new Error('Invalid payload must fail before database access'); } },
      'npm:web-push@3.6.7': {},
      globals: { Deno: { env: { get: name => ({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_backend-only' }) })[name] } } },
    });
    const headers = { 'content-type': 'application/json' };
    if (credential === 'publishable') headers.apikey = 'sb_publishable_public';
    if (credential === 'user-jwt') headers.authorization = 'Bearer user-jwt';
    if (credential === 'forged-secret') headers.apikey = 'sb_secret_forged';
    if (credential === 'legacy-service') headers.authorization = 'Bearer legacy-service-key';
    if (credential === 'modern-service') headers.apikey = 'sb_secret_backend-only';
    const response = await handler(new Request('http://localhost', { method: 'POST', headers, body: '{}' }));
    assert.equal(response.status, ['legacy-service','modern-service'].includes(credential) ? 400 : 403);
  });
}

test('server functions send modern secret only on apikey and preserve timeout/error handling', async () => {
  const { invokeServerFunction } = load('src/lib/server-functions.ts', {
    env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_backend-only', NEXT_PUBLIC_SUPABASE_URL: 'https://qa.invalid' },
    fetch: async (_url, options) => {
      assert.equal(options.headers.apikey, 'sb_secret_backend-only');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal);
      return new Response('Provider details must not leak', { status: 503 });
    },
  });
  const result = await invokeServerFunction({}, 'send-push-notification', {});
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'Server function returned HTTP 503');
});

for (const scenario of ['safe-public','unsafe-public','pending-copy-fails','safe-pending','private-bucket','signed-private','foreign-host','other-owner']) {
  test(`moderation preserves media ownership and source data: ${scenario}`, async () => {
    let handler;
    const writes = [], signs = [];
    const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const admin = { storage: { from: bucket => ({
      createSignedUrl: async path => { signs.push(bucket); return { data: { signedUrl: 'https://signed.invalid/image' } }; },
      copy: async (...args) => { writes.push('copy'); return { error: scenario === 'pending-copy-fails' ? { code: 'copy_failed' } : null }; },
      remove: async () => { writes.push('remove'); return {}; },
      getPublicUrl: path => ({ data: { publicUrl: `https://qa.invalid/storage/v1/object/public/${bucket}/${path}` } }),
    }) } };
    load('supabase/functions/moderate-content/index.ts', {
      'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
      'https://esm.sh/@supabase/supabase-js@2': { createClient: () => admin },
      globals: { Deno: { env: { get: name => ({ SUPABASE_URL: 'https://qa.invalid', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-key', SIGHTENGINE_API_USER: 'fixture-user', SIGHTENGINE_API_SECRET: 'fixture-secret' })[name] } } },
      fetch: async () => Response.json({ status: 'success', gore: { prob: scenario === 'unsafe-public' ? 1 : 0 } }),
    });
    const path = scenario.includes('pending') ? `${owner}/image.png` : scenario === 'other-owner' ? 'other-owner/image.png'
      : `https://${scenario === 'foreign-host' ? 'external.invalid' : 'qa.invalid'}/storage/v1/object/${scenario === 'signed-private' ? 'sign' : 'public'}/${scenario === 'private-bucket' ? 'reports' : 'post-images'}/image.png`;
    const response = await handler(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer legacy-service-key' }, body: JSON.stringify({ type: 'image', content: path, userId: owner }) }));
    const expected = ['private-bucket','other-owner'].includes(scenario) ? 403 : ['foreign-host','signed-private'].includes(scenario) ? 400 : 200;
    assert.equal(response.status, expected);
    if (scenario === 'pending-copy-fails') { assert.deepEqual(writes, ['copy']); assert.equal((await response.json()).isSafe, false); }
    else if (scenario === 'safe-pending') assert.deepEqual(writes, ['copy','remove']);
    else assert.deepEqual(writes, []);
    if (expected !== 200) assert.equal(signs.length, 0);
  });
}

test('seller balance excludes ticket revenue and reserves pending withdrawals', async () => {
  const { PayoutService } = load('src/lib/payout-service.ts', {
    './supabase-admin': { supabaseAdmin: { from: table => chain({ data: table === 'escrow_transactions'
      ? [{ seller_amount:1000,status:'completed',item_type:'post',payment_provider:'payluk' },{ seller_amount:9000,status:'completed',item_type:'ticket',payment_provider:'payluk' },{ seller_amount:5000,status:'completed',item_type:'post',payment_provider:'retired-provider' }]
      : [{ amount:100,status:'completed' },{ amount:200,status:'processing' }] }) } },
    './payluk-onboarding':{ getPaylukCustomerId:async ()=>'seller-provider-id' },
    './payluk-service':{ PaylukService:{ getCustomerWallet:async ()=>({ mainBalance:5000 }) } },
    './server-notification-service':{ NotificationService:{} },
  });
  const balance = await PayoutService.getSellerBalance('seller');
  assert.equal(balance.totalEarnings,1000);
  assert.equal(balance.availableBalance,700);
  assert.equal(balance.pendingPayouts,200);
});

test('legacy payout with unknown provider is blocked before any provider request', async () => {
  const { POST } = load('src/app/api/seller/payouts/[payoutId]/retry/route.ts', {
    '@/lib/supabase-server':{ getAuthenticatedUser:async ()=>({ data:{ user:{ id:'seller' } } }) },
    '@/lib/supabase-admin':{ supabaseAdmin:{ from:()=>chain({ data:{ status:'failed',transaction_reference:'legacy',payment_provider:null } }) } },
    '@/lib/payluk-service':{ PaylukService:{} },'@/lib/payluk-onboarding':{},'@/lib/payout-service':{},
  });
  const response = await POST(new Request('http://localhost',{ method:'POST',headers:{ authorization:'Bearer test' } }),{ params:Promise.resolve({ payoutId:'payout' }) });
  assert.equal(response.status,409);
});

test('authenticated GET sends no request body', async () => {
  const { authenticatedFetch } = load('src/lib/authenticated-fetch.ts', {
    './supabase':{ supabase:{ auth:{ getSession:async ()=>({ data:{ session:{ access_token:'test-token' } } }) } } },
    fetch:async (_url,options)=>{ assert.equal(options.method,'GET');assert.equal(options.body,undefined);return Response.json({ payouts:[] }); },
  });
  assert.ok((await authenticatedFetch('/api/seller/payouts/history',{},'GET')).payouts);
});

for (const outcome of ['success', 'uncertain', 'unsupported']) {
  test(`Payluk dispute settlement handles ${outcome} without a provider fallback`, async () => {
    let finalized = false, resolutions = 0;
    const { POST } = load('src/app/api/admin/disputes/[disputeId]/resolve/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'admin' } } }) },
      '@/lib/payluk-service': { PaylukService: { resolveDispute: async (id, params) => {
        resolutions++; assert.equal(id, 'escrow-id'); assert.equal(params.status, 'COMPLETED');
        if (outcome === 'uncertain') throw new Error('Provider timeout');
      } } },
      '@/lib/server-notification-service': { NotificationService: { createDisputeResolvedNotification: async () => {} } },
      '@/lib/supabase-admin': { supabaseAdmin: {
        rpc: async (name, args) => {
          if (name === 'begin_dispute_resolution') return { data: { newly_created: true, operation: { id: 'operation', refund_amount: 0, seller_amount: 1000, resolution: 'Release' } } };
          if (name === 'finish_dispute_resolution') { finalized = true; assert.equal(args.p_provider_reference, 'escrow-id'); }
          return {};
        },
        from: table => chain({ data: table === 'users' ? { is_admin: true } : table === 'disputes' ? { transaction_id: 'transaction' }
          : { id: 'transaction', payment_provider: outcome === 'unsupported' ? 'retired-provider' : 'payluk', payluk_escrow_id: 'escrow-id' } }),
      } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ resolution: 'Release', refundAmount: 0, sellerAmount: 1000 }) }), { params: Promise.resolve({ disputeId: 'dispute' }) });
    assert.equal(response.status, outcome === 'success' ? 200 : 202);
    assert.equal(resolutions, outcome === 'unsupported' ? 0 : 1);
    assert.equal(finalized, outcome === 'success');
  });
}

test('marketplace message writes once to messages without requiring item_chats', async () => {
  const writes = [];
  const { SupabaseChatService } = load('src/lib/supabase-chat-service.ts', {
    '@/lib/supabase':{ supabase:{ from:table => {
      assert.notEqual(table,'chat_messages');assert.notEqual(table,'item_chats');
      const q = chain({ data:{ participant_ids:['seller'] } });
      q.insert = body => { writes.push({ table,body });return q; };return q;
    } } },
  });
  await SupabaseChatService.sendMessage('conversation','seller','Seller','hello');
  assert.equal(writes.length,1);
  assert.equal(writes[0].table,'messages');
  assert.equal(writes[0].body.conversation_id,'conversation');
});

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
    '@/lib/server-notification-service':{ NotificationService:{} },
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
      if (table === 'event_payouts' && update) data = [{ id:'payout' }];
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
    './payluk-onboarding': { getPaylukCustomerId: async () => 'customer' },
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


test('checkout retry reconciles a funded prior escrow without cancelling or charging again', async () => {
  let writes = 0;
  const { POST } = load('src/app/api/payment/initialize/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer',email:'test@example.invalid' } } }) },
    '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended:false }) },
    '@/lib/payluk-onboarding': {},
    '@/lib/escrow-payment': { applyEscrowPayment: async id => { assert.equal(id,'prior');return true; } },
    '@/lib/payment-reconciliation': { flagPayment: async () => {} },
    '@/lib/payluk-service': { PaylukService: { verifyEscrow: async () => ({ status:'ONGOING',state:'OPENED' }),createEscrow: () => { throw Error('Must not charge twice'); } } },
    '@/lib/supabase-admin': { supabaseAdmin: {
      rpc: async name => { assert.equal(name,'consume_rate_limit');return { data:true }; },
      from(table) {
        const query = chain({ data: table === 'posts' ? { id:'item',user_id:'seller',price:1000,is_sold:false,category:'For Sale',moderation_status:'approved' }
          : [{ id:'prior',buyer_id:'buyer',status:'pending',payluk_tx_ref:'token',payluk_escrow_id:'remote',total_amount:1030 }] });
        query.update = () => { writes++;return query; };query.insert=query.update;
        return query;
      },
    } },
  });
  const response = await POST(new Request('http://localhost',{ method:'POST',body:JSON.stringify({ itemId:'item',buyerId:'buyer',sellerId:'seller',price:1000 }) }));
  assert.equal(response.status,200);
  assert.equal((await response.json()).alreadyPaid,true);
  assert.equal(writes,0);
});

test('late payment is held for reconciliation instead of reporting success', async () => {
  const { applyEscrowPayment } = load('src/lib/escrow-payment.ts', {
    './supabase-admin': { supabaseAdmin: { rpc: async () => ({ data:'review' }) } },
    './payment-reconciliation': {},
  });
  await assert.rejects(applyEscrowPayment('cancelled','payluk','reference'),/reconciliation/);
});

test('payment write failure records a durable reconciliation flag before returning failure', async () => {
  let flagged = false;
  const { applyEscrowPayment } = load('src/lib/escrow-payment.ts', {
    './supabase-admin': { supabaseAdmin: { rpc: async () => ({ error:{ code:'db-error' } }) } },
    './payment-reconciliation': { flagPayment: async () => { flagged = true; } },
  });
  await assert.rejects(applyEscrowPayment('tx','payluk','reference'),/reconciliation/);
  assert.equal(flagged,true);
});


test('auth redirect rejects backslashes and external origins', () => {
  const { safeRelativePath,authCookieDomain } = load('src/lib/auth-navigation.ts');
  for (const input of ['/\\attacker.example/path','//attacker.example','https://attacker.example','/ /evil']) assert.equal(safeRelativePath(input,'/home'),'/home');
  assert.equal(safeRelativePath('/my-tickets?success=1'),'/my-tickets?success=1');
  assert.equal(authCookieDomain('preview.vercel.app'),undefined);
  assert.equal(authCookieDomain('localhost:9002'),undefined);
  assert.equal(authCookieDomain('app.yrdly.ng'),'.yrdly.ng');
});

for (const host of ['localhost:9002','audit-preview.vercel.app','app.yrdly.ng']) {
  test(`middleware authentication handoff for ${host}`, () => {
    const { middleware } = load('middleware.ts', {
      'next/server': { NextResponse: { next:()=>'app',redirect:()=> 'marketing' } },
    });
    const result = middleware({ nextUrl:new URL(`https://${host}/login`),headers:new Headers() });
    assert.equal(result,host === 'app.yrdly.ng' ? 'marketing' : 'app');
  });
}

for (const scenario of ['allowed','disallowed','redirect','oversize','timeout']) {
  test(`image loader ${scenario}`, async () => {
    let calls = 0;
    const { fetchSafeImage } = load('src/lib/safe-image-fetch.ts', { fetch:async (_url,options) => {
      calls++;assert.equal(options.redirect,'manual');assert.ok(options.signal);
      if (scenario === 'timeout') throw new DOMException('Timed out','TimeoutError');
      if (scenario === 'redirect') return new Response(null,{ status:302,headers:{ location:'http://127.0.0.1' } });
      return new Response(scenario === 'oversize' ? new Uint8Array(5*1024*1024+1) : 'image', { headers:{ 'content-type':'image/png' } });
    } });
    const result = fetchSafeImage(scenario === 'disallowed' ? 'http://127.0.0.1/private' : 'https://api.yrdly.ng/storage/v1/object/public/post-images/test.png');
    if (scenario === 'allowed') assert.equal((await result).toString(),'image');
    else await assert.rejects(result);
    assert.equal(calls,scenario === 'disallowed' ? 0 : 1);
  });
}

test('onboarding has an overall deadline and never scans customer pages', async () => {
  let lookups = 0;
  const { ensurePaylukCustomer } = load('src/lib/payluk-onboarding.ts', {
    globals:{ setTimeout:callback => setTimeout(callback,1) },
    './supabase-admin': { supabaseAdmin:{ from:()=>chain({ data:{ phone:'08012345678',phone_verified:true } }) } },
    './payluk-service': { PaylukService:{ getCustomerByPhone:()=> { lookups++;return new Promise(()=>{}); },listCustomers:()=> { throw Error('Never scan'); } } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'),/timed out.*retry/i);
  assert.equal(lookups,1);
});

test('location waits for async profile, restores home LGA and honors expired saved filters', () => {
  let auth = { loading:true,user:{ id:'user' },profile:null };
  const states = [],refs = [];let si=0,ri=0;let effects=[];
  const react = { createContext:()=>({ Provider:'provider' }),useContext:()=>{},
    useState:initial => { const index=si++;if (!(index in states)) states[index]=initial;return [states[index],value=>{ states[index]=value; }]; },
    useRef:initial => { const index=ri++;return refs[index] ||= { current:initial }; },
    useEffect:effect=>effects.push(effect),useCallback:fn=>fn,
  };
  const { LocationProvider } = load('src/contexts/LocationContext.tsx', {
    react,'react/jsx-runtime':{ jsx:(type,props)=>({ type,props }) },
    '@/hooks/use-supabase-auth':{ useAuth:()=>auth },
    globals:{ localStorage:{ getItem:()=>JSON.stringify({ filter:{ state:'Oyo' },timestamp:Date.now()-2*86400000 }),removeItem:()=>{},setItem:()=>{} } },
  });
  const render = () => { si=0;ri=0;effects=[];const output=LocationProvider({ children:null });effects.forEach(effect=>effect());return output.props.value; };
  render();
  auth = { loading:false,user:{ id:'user' },profile:{ id:'user',home_state:'Lagos',home_lga:'Ikeja' } };
  render();const value = render();
  assert.equal(value.activeFilter.state,'Lagos');assert.equal(value.activeFilter.lga,'Ikeja');assert.equal(value.displayLabel,'Ikeja, Lagos');
  value.setGlobalFilter(null);assert.equal(render().activeFilter,null);
});

test('ETA rate-limit failure rejects before calling Google', async () => {
  const { POST } = load('src/app/api/directions/eta/route.ts',{
    '@/lib/supabase-server':{ getAuthenticatedUser:async()=>({ data:{ user:{ id:'user' } } }) },
    '@/lib/supabase-admin':{ supabaseAdmin:{ rpc:async()=>({ error:{ code:'unavailable' } }) } },
  });
  assert.equal((await POST(new Request('http://localhost',{ method:'POST',body:'{}' }))).status,503);
});

test('push edge function rejects a regular user token before reading subscriptions', async () => {
  let handler;
  load('supabase/functions/send-push-notification/index.ts',{
    'https://deno.land/std@0.168.0/http/server.ts':{ serve:fn=>{ handler=fn; } },
    'https://esm.sh/@supabase/supabase-js@2':{ createClient:()=>{ throw Error('Must not read subscriptions'); } },
    'npm:web-push@3.6.7':{},globals:{ Deno:{ env:{ get:()=> 'service-only-test-key' } } },
  });
  const response = await handler(new Request('http://localhost',{ method:'POST',headers:{ authorization:'Bearer user-token' },body:'{}' }));
  assert.equal(response.status,403);
});

test('private media references preserve object names and recognize historical project URLs', () => {
  const media = load('src/lib/private-media.ts');
  const objectPath = 'chat/12345678-1234-1234-1234-123456789abc/photo with space.png';
  const reference = media.privateMediaReference('chat-images', objectPath);
  assert.equal(media.parsePrivateMediaReference(reference).path, objectPath);
  const legacy = media.parsePrivateMediaReference(`https://yoiyqxtpmxnrrbqqidcs.supabase.co/storage/v1/object/public/chat-images/${encodeURI(objectPath)}`);
  assert.equal(legacy.bucket, 'chat-images');
  assert.equal(legacy.path, objectPath);
  const signed = media.parsePrivateMediaReference(`https://api.yrdly.ng/storage/v1/object/sign/chat-images/${encodeURI(objectPath)}?token=expired`);
  assert.equal(signed.path, objectPath);
  assert.equal(media.parsePrivateMediaReference('https://example.com/photo.png'), null);
  assert.equal(media.parsePrivateMediaReference('https://api.yrdly.ng/storage/v1/object/public/post-images/photo.png'), null);
});

for (const objectPath of ['../secret', 'chat//photo', 'chat/./photo', 'chat/%2e%2e/photo', 'chat/\\photo', 'chat/photo?token=x', 'chat/photo#fragment', 'chat/\u0000photo']) {
  test(`private media rejects unsafe object path ${JSON.stringify(objectPath)}`, () => {
    const { validatePrivateMediaPath } = load('src/lib/private-media.ts');
    assert.throws(() => validatePrivateMediaPath(objectPath), /Invalid media path/);
  });
}

const mediaConversation = '12345678-1234-1234-1234-123456789abc';
const mediaUser = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
for (const scenario of ['anonymous','outsider','member','legacy-member','own-report','admin-report','outsider-report','lookup-error','admin-error','limiter-error','rate-limited','missing-object','bad-bucket','bad-path','bad-conversation']) {
  test(`media signing authorizes ${scenario} without exposing durable URLs`, async () => {
    let signed = 0;
    let dbReads = 0;
    const { POST } = load('src/app/api/media/sign/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: scenario === 'anonymous' ? null : { id: mediaUser } } }) },
      '@/lib/supabase-admin': { supabaseAdmin: {
        rpc: async () => ({ data: scenario !== 'rate-limited', error: scenario === 'limiter-error' ? { code:'unavailable' } : null }),
        from: table => {
          dbReads++;
          const query = chain({ data: table === 'users' ? { is_admin: scenario === 'admin-report' }
            : ['member','legacy-member','missing-object'].includes(scenario) ? { id:mediaConversation } : null,
            error: ['lookup-error','admin-error'].includes(scenario) ? { code:'unavailable' } : null });
          query.contains = (column, ids) => { assert.equal(column, 'participant_ids'); assert.equal(ids[0], mediaUser); return query; };
          return query;
        },
        storage: { from: bucket => ({ createSignedUrl: async (objectPath, ttl) => {
          signed++; assert.equal(ttl, 300);
          assert.equal(bucket, scenario.includes('report') ? 'reports' : 'chat-images');
          assert.equal(objectPath.includes('..'), false);
          return scenario === 'missing-object' ? { error:{ code:'404' } } : { data:{ signedUrl:'https://signed.example/private' } };
        } }) },
      } },
    });
    const body = { bucket: scenario.includes('report') || scenario === 'admin-error' ? 'reports' : scenario === 'bad-bucket' ? 'post-images' : 'chat-images',
      path: scenario === 'own-report' ? `${mediaUser}/photo.png` : scenario.includes('report') || scenario === 'admin-error' ? 'other-user/photo.png'
        : scenario === 'bad-path' ? '../photo.png' : scenario === 'bad-conversation' ? 'unknown/photo.png'
        : `${scenario === 'legacy-member' ? 'chat/' : ''}${mediaConversation}/photo.png` };
    const response = await POST(new Request('http://localhost/api/media/sign', { method:'POST', body:JSON.stringify(body) }));
    const expected = ['member','legacy-member','own-report','admin-report'].includes(scenario) ? 200
      : scenario === 'anonymous' ? 401 : ['outsider','outsider-report'].includes(scenario) ? 403
      : ['bad-bucket','bad-path','bad-conversation'].includes(scenario) ? 400
      : scenario === 'missing-object' ? 404 : scenario === 'rate-limited' ? 429 : 503;
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary'), /Authorization/);
    assert.equal(signed, expected === 200 || scenario === 'missing-object' ? 1 : 0);
    if (scenario === 'anonymous' || scenario === 'own-report') assert.equal(dbReads, 0);
    if (expected !== 200) assert.equal((await response.json()).url, undefined);
  });
}

test('private media resolver reauthorizes an expired URL instead of fetching it publicly', async () => {
  let requests = 0;
  const { resolvePrivateMediaSource } = load('src/hooks/use-private-media.ts', {
    './use-supabase-auth': { useAuth:()=>({}) },
    '@/lib/authenticated-fetch': { authenticatedFetch: async (endpoint, body) => {
      requests++; assert.equal(endpoint, '/api/media/sign'); assert.equal(body.bucket, 'chat-images');
      assert.equal(body.path, `${mediaConversation}/photo.png`);
      return { url:'https://signed.example/refreshed' };
    } },
  });
  assert.equal(await resolvePrivateMediaSource(`https://api.yrdly.ng/storage/v1/object/sign/chat-images/${mediaConversation}/photo.png?token=expired`), 'https://signed.example/refreshed');
  assert.equal(await resolvePrivateMediaSource('blob:local-preview'), 'blob:local-preview');
  assert.equal(requests, 1);
});

test('private media clears access on account changes and discards stale signer responses', async () => {
  let auth = { user:{ id:mediaUser } };
  let state;
  let effect;
  let resolveSigning;
  let requests = 0;
  const { usePrivateMedia } = load('src/hooks/use-private-media.ts', {
    react: { useState:()=>[state, value=>{ state=value; }], useEffect:callback=>{ effect=callback; } },
    './use-supabase-auth': { useAuth:()=>auth },
    '@/lib/authenticated-fetch': { authenticatedFetch:()=> { requests++; return new Promise(resolve=>{ resolveSigning=resolve; }); } },
    globals: { setTimeout:()=>1, clearTimeout:()=>{} },
  });
  const source = `storage://chat-images/${mediaConversation}/photo.png`;
  usePrivateMedia(source);
  const cleanup = effect();
  cleanup();
  auth = { user:null };
  assert.equal(usePrivateMedia(source).url, null);
  effect();
  resolveSigning({ url:'https://signed.example/previous-user' });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(usePrivateMedia(source).url, null);
  assert.equal(state.error, true);
  assert.equal(requests, 1);
});

for (const missing of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
  test(`admin client refuses missing ${missing} without an anonymous fallback`, () => {
    let creations = 0;
    assert.throws(()=>load('src/lib/supabase-admin.ts', {
      env:{ NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY:'server-test', NEXT_PUBLIC_SUPABASE_ANON_KEY:'anonymous-test', [missing]:'' },
      '@supabase/supabase-js': { createClient:()=>{ creations++; return {}; } },
    }), /Server Supabase configuration is missing/);
    assert.equal(creations, 0);
  });
}

test('sandbox smoke refuses live or ambiguous keys before any network request', async () => {
  const { runSandboxSmoke } = await import('../scripts/qa-payluk-sandbox.mjs');
  let calls = 0;
  for (const contents of ['PAYLUK_SECRET_KEY=sk_live_fake', 'sk_test_first\nsk_test_second', 'PAYLUK_SECRET_KEY=missing']) {
    await assert.rejects(runSandboxSmoke(contents, async()=>{ calls++; }), /sandbox key is required/);
  }
  assert.equal(calls, 0);
});

test('sandbox smoke accepts QA-file keys only on staging and returns no provider data', async () => {
  const { runSandboxSmoke } = await import('../scripts/qa-payluk-sandbox.mjs');
  for (const contents of ['PAYLUK_SECRET_KEY=sk_test_fake', 'sk_test_fake', 'Payluk test key = sk_test_fake']) {
    const result = await runSandboxSmoke(contents, async(url, options)=>{
      assert.equal(url, 'https://staging.api.payluk.ng/v1/countries');
      assert.equal(options.headers.Authorization, 'Bearer sk_test_fake');
      assert.equal(options.redirect, 'error');
      return Response.json({ status:200, data:{ private:'never log this' } });
    });
    assert.equal(result.passed, true);
    assert.equal(result.data, undefined);
    assert.equal(JSON.stringify(result).includes('sk_test_'), false);
  }
});

test('service worker never caches private storage URLs or signing responses', () => {
  const handlers = {};
  load('public/sw.js', { globals:{ self:{ addEventListener:(name, handler)=>{ handlers[name]=handler; } } } });
  for (const url of ['https://api.yrdly.ng/storage/v1/object/sign/chat-images/file?token=test',
    'https://yoiyqxtpmxnrrbqqidcs.supabase.co/storage/v1/object/sign/reports/file?token=test',
    'https://app.yrdly.ng/api/media/sign']) {
    handlers.fetch({ request:new Request(url), respondWith:()=>{ assert.fail('Private requests must bypass caches'); } });
  }
});

test('private image rendering bypasses the shared Next.js image cache', () => {
  const { PrivateMediaImage } = load('src/components/PrivateMedia.tsx', {
    '@/hooks/use-private-media':{ usePrivateMedia:()=>({ url:'https://signed.example/private',error:false }) },
    'next/image':{ __esModule:true,default:'image' }, 'react/jsx-runtime':{ jsx:(type,props)=>({ type,props }) },
  });
  const rendered = PrivateMediaImage({ src:'storage://reports/owner/file',alt:'Evidence',width:100,height:100 });
  assert.equal(rendered.props.unoptimized, true);
  assert.equal(rendered.props.src, 'https://signed.example/private');
});

for (const enabled of [false,true]) {
  test(`private media reference rollout ${enabled ? 'enabled' : 'disabled'} preserves shared-client compatibility`, () => {
    let publicUrls = 0;
    const { StorageService } = load('src/lib/storage-service.ts', {
      env:{ NEXT_PUBLIC_PRIVATE_MEDIA_REFERENCES:String(enabled) },
      './supabase':{ supabase:{ storage:{ from:bucket=>({ getPublicUrl:objectPath=>{
        publicUrls++; return { data:{ publicUrl:`https://api.yrdly.ng/storage/v1/object/public/${bucket}/${objectPath}` } };
      } }) } } },
    });
    const source = StorageService.getPublicUrl('chat-images', `${mediaConversation}/photo.png`);
    assert.equal(source.startsWith('storage://'), enabled);
    assert.equal(publicUrls, enabled ? 0 : 1);
    const parsed = load('src/lib/private-media.ts').parsePrivateMediaReference(source);
    assert.equal(parsed.path, `${mediaConversation}/photo.png`);
    assert.equal(parsed.bucket, 'chat-images');
  });
}

for (const scenario of ['anonymous', 'success', 'provider-failure']) {
  test(`Payluk bank list ${scenario}`, async () => {
    let calls = 0;
    const { GET } = load('src/app/api/seller/banks/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: scenario === 'anonymous' ? null : { id: 'seller' } } }) },
      '@/lib/payluk-service': { PaylukService: { getBankList: async () => {
        calls++;
        if (scenario === 'provider-failure') throw new Error('Test provider unavailable');
        return [{ name: 'Bank', code: 'opaque-bank-code' }];
      } } },
    });
    const response = await GET(new Request('http://localhost'));
    assert.equal(response.status, scenario === 'anonymous' ? 401 : scenario === 'success' ? 200 : 503);
    assert.equal(calls, scenario === 'anonymous' ? 0 : 1);
    if (scenario === 'success') assert.deepEqual(await response.json(), { success: true, banks: [{ name: 'Bank', code: 'opaque-bank-code' }] });
  });
}

for (const scenario of ['paid', 'pending', 'amount-mismatch', 'unsupported', 'other-buyer']) {
  test(`marketplace Payluk verification ${scenario}`, async () => {
    let applied = 0, verified = 0, flagged = 0;
    const tx = { id: '00000000-0000-0000-0000-000000000001', buyer_id: scenario === 'other-buyer' ? 'other' : 'buyer',
      payment_provider: scenario === 'unsupported' ? 'retired-provider' : 'payluk', status: 'pending',
      payluk_tx_ref: 'PY_TOKEN', payluk_escrow_id: 'escrow-id', amount: 2000, total_amount: 2060 };
    const { POST } = load('src/app/api/payment/verify/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } } }) },
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => chain({ data: tx }) } },
      '@/lib/payluk-service': { PaylukService: { verifyEscrow: async token => {
        verified++; assert.equal(token, 'PY_TOKEN');
        return { status: scenario === 'pending' ? 'PENDING' : 'ONGOING', amount: scenario === 'amount-mismatch' ? 1000 : 2000 };
      } } },
      '@/lib/escrow-payment': { applyEscrowPayment: async (id, provider, ref) => {
        applied++; assert.equal(id, tx.id); assert.equal(provider, 'payluk'); assert.equal(ref, 'escrow-id');
      } },
      '@/lib/payment-reconciliation': { flagPayment: async () => { flagged++; } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ txRef: tx.id }) }));
    assert.equal(response.status, { paid: 200, pending: 402, 'amount-mismatch': 409, unsupported: 409, 'other-buyer': 403 }[scenario]);
    assert.equal(applied, scenario === 'paid' ? 1 : 0);
    assert.equal(flagged, scenario === 'amount-mismatch' ? 1 : 0);
    assert.equal(verified, ['unsupported', 'other-buyer'].includes(scenario) ? 0 : 1);
  });
}

for (const scenario of ['missing', 'unsupported', 'other-buyer', 'pending', 'amount-mismatch', 'confirmed', 'replay']) {
  test(`Payluk ticket verification ${scenario}`, async () => {
    let verified = 0, fulfilled = 0, updated = 0, flagged = 0;
    const tx = { id: '00000000-0000-0000-0000-000000000001', buyer_id: scenario === 'other-buyer' ? 'other' : 'buyer',
      item_type: 'ticket', payment_provider: scenario === 'unsupported' ? 'retired-provider' : 'payluk',
      payluk_tx_ref: 'PY_TOKEN', status: scenario === 'replay' ? 'paid' : 'pending', amount: 2000 };
    const { TicketService } = load('src/lib/ticket-service.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => {
        const q = chain({ data: scenario === 'missing' ? null : tx });
        q.update = () => { updated++; return chain({ data: { ...tx, status: 'paid' } }); };
        return q;
      } } },
      '@/lib/resend-service': { ResendEmailService: {} }, '@/lib/server-push-notification': {},
      '@/lib/payluk-service': { PaylukService: { verifyEscrow: async token => {
        verified++; assert.equal(token, 'PY_TOKEN');
        return { status: scenario === 'pending' ? 'PENDING' : 'CLAIMED', amount: scenario === 'amount-mismatch' ? 1000 : 2000 };
      } } },
      './payment-reconciliation': { flagPayment: async () => { flagged++; } },
    });
    TicketService.processTicketPaymentFromTransaction = async paid => { fulfilled++; assert.equal(paid.status, 'paid'); return { id: 'ticket' }; };
    if (['confirmed', 'replay'].includes(scenario)) {
      assert.equal((await TicketService.verifyAndProcessTicket('order-reference', 'buyer')).id, 'ticket');
    } else {
      await assert.rejects(TicketService.verifyAndProcessTicket('order-reference', 'buyer'), new RegExp({
        missing: 'payment_not_found', unsupported: 'payment_requires_review', 'other-buyer': 'ticket_buyer_mismatch',
        pending: 'payment_pending', 'amount-mismatch': 'payment_requires_review',
      }[scenario]));
    }
    assert.equal(fulfilled, ['confirmed', 'replay'].includes(scenario) ? 1 : 0);
    assert.equal(updated, scenario === 'confirmed' ? 1 : 0);
    assert.equal(verified, ['pending', 'amount-mismatch', 'confirmed'].includes(scenario) ? 1 : 0);
    assert.equal(flagged, scenario === 'amount-mismatch' ? 1 : 0);
  });
}

for (const scenario of ['success', 'provider-failure']) {
  test(`event checkout uses Payluk ${scenario} and records one order escrow`, async () => {
    let created = 0;
    const inserts = [];
    const { POST } = load('src/app/api/events/tickets/purchase/route.ts', {
      globals: { crypto: require('node:crypto') },
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } } }) },
      '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
      '@/lib/resend-service': { ResendEmailService: {} }, '@/lib/server-push-notification': {},
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async id => `provider-${id}` },
      '@/lib/payluk-service': { PaylukService: { updateCustomerPermissions: async () => {}, createEscrow: async (seller, params) => {
        created++; assert.equal(seller, 'provider-organizer'); assert.equal(params.amount, 4000); assert.equal(params.totalQuantity, 1);
        if (scenario === 'provider-failure') throw new Error('Test provider unavailable');
        return { id: 'escrow-id', paymentToken: 'PY_TOKEN' };
      } } },
      '@/lib/supabase-admin': { supabaseAdmin: { from: table => {
        const q = chain({ data: table === 'events' ? { id: 'event', title: 'Event', status: 'PUBLISHED', organizer_id: 'organizer' }
          : table === 'ticket_tiers' ? { id: 'tier', name: 'General', price: 2000, capacity: 100, sold: 0, is_visible: true } : [] });
        q.insert = row => { inserts.push({ table, row }); return chain({ error: null }); };
        return q;
      } } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ event_id: 'event', tier_id: 'tier', attendee_name: 'Buyer', attendee_email: 'buyer@example.com', quantity: 2 }) }));
    assert.equal(response.status, scenario === 'success' ? 200 : 502);
    assert.equal(created, 1);
    assert.equal(inserts.length, scenario === 'success' ? 1 : 0);
    if (scenario === 'success') {
      const result = await response.json();
      assert.equal(result.provider, 'payluk'); assert.equal(result.paylukPaymentToken, 'PY_TOKEN');
      const { row } = inserts[0];
      assert.equal(row.payment_provider, 'payluk'); assert.equal(row.metadata.quantity, 2);
      assert.equal(row.commission, 120); assert.equal(row.seller_amount, 3880);
      assert.equal(row.total_amount, 4000); assert.equal(row.payment_reference, result.tx_ref);
    }
  });
}

test('compatibility ticket checkout preserves auth and uses the canonical Payluk handler', async () => {
  const { POST } = load('src/app/api/tickets/initialize/route.ts', {
    '@/app/api/events/tickets/purchase/route': { POST: async request => {
      assert.equal(request.headers.get('authorization'), 'Bearer test-token');
      assert.deepEqual(await request.json(), { event_id: 'event', tier_id: 'tier', attendee_name: 'Buyer', attendee_email: 'buyer@example.com', quantity: 1 });
      return Response.json({ success: true, tx_ref: 'ref', payment_link: 'https://payluk.ng/escrow/token', paylukPaymentToken: 'token' });
    } },
  });
  const response = await POST(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ eventId: 'event', tierId: 'tier', attendeeName: 'Buyer', attendeeEmail: 'buyer@example.com' }) }));
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.txRef, 'ref'); assert.equal(result.paymentLink, 'https://payluk.ng/escrow/token');
});

for (const amount of [2000, null, 0]) {
  test(`ticket refund amount ${amount} never fabricates a paid refund`, async () => {
    let writes = 0;
    const { POST } = load('src/app/api/events/tickets/refund/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'organizer' } } }) },
      '@/lib/server-push-notification': { sendPushNotification: async () => {} },
      '@/lib/supabase-admin': { supabaseAdmin: { from: table => {
        const q = chain({ data: table === 'tickets' ? { id: 'ticket', status: 'PAID', amount_paid: amount, event: { id: 'event', title: 'Event', organizer_id: 'organizer' } } : null });
        q.update = () => { writes++; return chain({}); }; q.insert = () => chain({}); return q;
      } } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ticket_id: 'ticket' }) }));
    assert.equal(response.status, amount === 0 ? 200 : 409);
    assert.equal(writes, amount === 0 ? 1 : 0);
  });
}

for (const amount of [2000, null, 0]) {
  test(`event cancellation amount ${amount} preserves unresolved paid tickets`, async () => {
    let writes = 0, ticketLookups = 0;
    const { POST } = load('src/app/api/events/[id]/cancel/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'organizer' } } }) },
      '@/lib/supabase-admin': { supabaseAdmin: { from: table => {
        const q = chain({ data: table === 'events' ? { id: 'event', status: 'PUBLISHED', organizer_id: 'organizer' }
          : ticketLookups++ === 0 ? [{ id: 'ticket', amount_paid: amount }] : [] });
        q.update = () => { writes++; return chain({}); }; return q;
      } } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'event' }) });
    assert.equal(response.status, amount === 0 ? 200 : 409); assert.equal(writes, amount === 0 ? 2 : 0);
  });
}

for (const scenario of ['replay', 'fulfillment-failure']) {
  test(`signed Payluk ticket webhook ${scenario} keeps provider identity and retry behavior`, async () => {
    let issued = 0, flagged = 0;
    const fullTx = { id: '00000000-0000-0000-0000-000000000001', status: 'paid', payment_provider: 'payluk', item_type: 'ticket', metadata: { event_id: 'event' } };
    const { POST } = load('src/app/api/webhooks/payluk/route.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => {
        let projection;
        const q = {};
        q.select = columns => { projection = columns; return q; }; q.or = () => q;
        q.maybeSingle = async () => ({ data: Object.fromEntries(projection.split(',').map(key => key.trim()).map(key => [key, fullTx[key]])) });
        return q;
      } } },
      '@/lib/escrow-payment': { applyEscrowPayment: async () => false },
      '@/lib/payment-reconciliation': { flagPayment: async (_provider, _reference, _id, reason) => { flagged++; assert.equal(reason, 'ticket_fulfillment_failed'); } },
      '@/lib/ticket-service': { TicketService: { processTicketPaymentFromTransaction: async tx => {
        issued++; assert.equal(tx.payment_provider, 'payluk');
        if (scenario === 'fulfillment-failure') throw new Error('Test fulfillment unavailable');
      } } },
      '@/lib/server-notification-service': {}, '@/lib/payluk-service': {}, '@/lib/payout-service': {}, '@/lib/server-push-notification': {},
      '@/lib/booking-payments': { handlePaylukWebhookEvent: async () => {} },
    });
    const body = JSON.stringify({ event: 'escrow.ongoing', data: { id: 'escrow-id', paymentToken: 'PY_TOKEN', status: 'ONGOING' } });
    const signature = require('node:crypto').createHmac('sha512', 'test-only').update(body).digest('hex');
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'x-payluk-signature': signature }, body }));
    assert.equal(response.status, scenario === 'replay' ? 200 : 500);
    assert.equal(issued, 1); assert.equal(flagged, scenario === 'fulfillment-failure' ? 1 : 0);
  });
}

test('Payluk test-mode account resolution fails closed on provider errors', async () => {
  const { PaylukService } = load('src/lib/payluk-service.ts', {
    env: { PAYLUK_SECRET_KEY: 'sk_test_fixture' }, './payluk-onboarding': {},
    fetch: async () => { throw new Error('Test provider unavailable'); },
  });
  assert.equal((await PaylukService.resolveAccount('0123456789abcdef01234567', '0000000000', 'opaque-code')).valid, false);
});
