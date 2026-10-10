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
    if (id === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire,
    console, AbortSignal, Response, URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
    process: { env: { PAYLUK_SECRET_KEY: 'test-only', ...mocks.env } },
    ...mocks.globals,
    fetch: mocks.fetch || (() => { throw new Error('Live network is prohibited in audit tests'); }),
  }, { filename });
  return module.exports;
}

function chain(result) {
  const query = {};
  for (const method of ['select','eq','neq','is','in','or','limit','update','insert','single','maybeSingle','delete','order']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

test('seller balance excludes ticket revenue and reserves pending withdrawals', async () => {
  const { PayoutService } = load('src/lib/payout-service.ts', {
    './supabase-admin': { supabaseAdmin: { from: table => chain({ data: table === 'escrow_transactions'
      ? [{ seller_amount:1000,status:'completed',item_type:'post',payment_provider:'payluk' },{ seller_amount:9000,status:'completed',item_type:'ticket',payment_provider:'payluk' },{ seller_amount:5000,status:'completed',item_type:'post',payment_provider:'paystack' }]
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

for (const outcome of ['success','pending']) {
  test(`Paystack dispute settlement stays with Paystack and handles ${outcome}`, async () => {
    let finalized = false,transfers = 0;
    const { POST } = load('src/app/api/admin/disputes/[disputeId]/resolve/route.ts', {
      '@/lib/supabase-server':{ getAuthenticatedUser:async ()=>({ data:{ user:{ id:'admin' } } }) },
      '@/lib/payluk-service':{ PaylukService:{} },
      '@/lib/server-notification-service':{ NotificationService:{ createDisputeResolvedNotification:async ()=>{} } },
      '@/lib/paystack-service':{ PaystackService:{ transferToSeller:async params=>{
        transfers++;assert.equal(params.reference,'dispute-payout-operation');assert.equal(params.amount,1000);return { outcome };
      } } },
      '@/lib/supabase-admin':{ supabaseAdmin:{
        rpc:async name=>{
          if (name === 'begin_dispute_resolution') return { data:{ newly_created:true,operation:{ id:'operation',refund_amount:0,seller_amount:1000,resolution:'Release' } } };
          if (name === 'finish_dispute_resolution') finalized = true;
          return {};
        },
        from:table=>chain({ data: table === 'users' ? { is_admin:true } : table === 'disputes' ? { transaction_id:'transaction' }
          : table === 'seller_accounts' ? { is_active:true,verification_status:'verified',account_details:{ bank_code:'test',account_number:'test' } }
          : { id:'transaction',payment_provider:'paystack' } }),
      } },
    });
    const response = await POST(new Request('http://localhost',{ method:'POST',body:JSON.stringify({ resolution:'Release',refundAmount:0,sellerAmount:1000 }) }),{ params:Promise.resolve({ disputeId:'dispute' }) });
    assert.equal(response.status,outcome === 'success' ? 200 : 202);
    assert.equal(transfers,1);assert.equal(finalized,outcome === 'success');
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
