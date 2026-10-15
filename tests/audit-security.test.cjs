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
    const basename = path.basename(id).replace(/\.tsx?$/, '');
    const mockKey = Object.keys(mocks).find(key => path.basename(key).replace(/\.tsx?$/, '') === basename);
    if (mockKey) return mocks[mockKey];
    if (id === 'next/server') return { NextRequest: Request, NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id.endsWith('.ts') ? id : `${id}.ts`), mocks);
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
  for (const method of ['select','eq','neq','is','in','or','contains','limit','update','insert','single','maybeSingle','delete','order','gt','gte','lt','lte']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

for (const scenario of ['success','retry','mismatch','uncertain','lost-claim','onboarding-failure','provider-failure','commission-failure']) {
  test(`booking checkout saves the order before provider writes: ${scenario}`, async () => {
    let customerWriteActive = false, created = 0, flags = 0, fees = 0;
    const customers = [];
    const tx = { id:'owned-order',buyer_id:'buyer',seller_id:'seller',item_id:'owned-booking',item_type:'booking',amount:2001.11,commission:60.03,total_amount:2061.14,
      status:scenario==='uncertain'?'reconciling':'pending',payment_reference:'bk-owned',metadata:{payluk_fee_mode:'buyer_commission_v1'},
      ...(['retry','mismatch'].includes(scenario)?{payluk_tx_ref:'PY_TOKEN',payluk_escrow_id:'escrow-id'}:{}) };
    const admin = {
      rpc: async (name,args) => { assert.equal(name,'reserve_booking_checkout');assert.equal(args.p_buyer_id,'buyer');return {data:{transaction:tx}}; },
      from: table => {
        assert.equal(table,'escrow_transactions');const q=chain({data:tx});
        q.update=payload=>{if(scenario==='lost-claim')return chain({data:null});Object.assign(tx,payload);return chain({data:{id:tx.id}});};return q;
      },
    };
    const {createCheckoutForBooking}=load('src/lib/bookings/booking-payments.ts',{
      './supabase-admin':{supabaseAdmin:admin},
      './payment-reconciliation':{flagPayment:async()=>{flags++;}},
      './escrow-payment':{applyEscrowPayment:async()=>{throw new Error('Unpaid checkout must not be fulfilled');}},
      './payluk-onboarding':{getPaylukCustomerId:async id=>{
        if(scenario==='onboarding-failure')throw new Error('Phone verification required');
        assert.equal(customerWriteActive,false);customerWriteActive=true;await new Promise(resolve=>setTimeout(resolve,1));customers.push(id);customerWriteActive=false;return 'provider-'+id;
      }},
      './payluk-service':{PaylukService:{
        updateCustomerPermissions:async()=>{},
        verifyEscrow:async()=>({status:'PENDING',state:'AWAITING_PAYMENT',amount:2001.11,whoPays:'seller',additionalFee:scenario==='mismatch'?0:60.03}),
        createEscrow:async(seller,details)=>{assert.equal(tx.status,'creating_escrow');assert.equal(seller,'provider-seller');assert.equal(details.amount,2001.11);created++;if(scenario==='provider-failure')throw new Error('Unknown creation outcome');return{id:'escrow-id',paymentToken:'PY_TOKEN',fee:40.02};},
        addAdditionalFee:async(token,fee)=>{assert.equal(tx.payluk_escrow_id,'escrow-id');assert.equal(token,'PY_TOKEN');assert.equal(fee,60.03);fees++;if(scenario==='commission-failure')throw new Error('Unknown fee outcome');},
      }},
    });
    const run=()=>createCheckoutForBooking({bookingId:'owned-booking',buyerId:'buyer',sellerId:'untrusted-seller',amount:1,type:'full',purpose:'QA service',appointmentTime:new Date(Date.now()+86400000).toISOString()});
    if(['success','retry'].includes(scenario)){
      const result=await run();assert.equal(result.totalAmount,2061.14);assert.equal(result.paylukPaymentToken,'PY_TOKEN');assert.equal(result.url,undefined);
      if(scenario==='success'){assert.deepEqual(customers,['buyer','seller']);assert.equal(tx.seller_amount,1961.09);}
    }else await assert.rejects(run());
    assert.equal(created,['success','provider-failure','commission-failure'].includes(scenario)?1:0);
    assert.equal(fees,['success','commission-failure'].includes(scenario)?1:0);
    assert.equal(flags,['mismatch','provider-failure','commission-failure'].includes(scenario)?1:0);
    if(scenario==='onboarding-failure')assert.equal(tx.status,'cancelled');
    if(['provider-failure','commission-failure'].includes(scenario))assert.equal(tx.status,'reconciling');
    if(scenario==='commission-failure')assert.equal(tx.payluk_tx_ref,'PY_TOKEN');
  });
}

test('booking percentage deposits retain kobo precision',()=>{
  const {computeDepositAmount}=load('src/lib/bookings/booking-payments.ts',{'./supabase-admin':{supabaseAdmin:{}},'./payluk-service':{PaylukService:{}},'./payluk-onboarding':{},'./payment-reconciliation':{},'./escrow-payment':{}});
  assert.equal(computeDepositAmount({price:12345.67,deposit_percent:15}),1851.85);
  assert.equal(computeDepositAmount({price:12345.67,deposit_amount:1001.11,deposit_percent:15}),1001.11);
});

for(const scenario of ['unpaid','read-timeout','delete-timeout','paid','outsider','in-flight']){
  test(`booking checkout cancellation protects funds: ${scenario}`,async()=>{
    let deleted=0,flags=0,applied=0;
    const tx={id:'order',buyer_id:'buyer',seller_id:'seller',item_id:'booking',item_type:'booking',status:scenario==='in-flight'?'creating_escrow':'pending',amount:2500,commission:75,payluk_tx_ref:'PY_TOKEN',payluk_escrow_id:'escrow-id',metadata:{payluk_fee_mode:'buyer_commission_v1'}};
    const {cancelBookingCheckout}=load('src/lib/bookings/booking-payments.ts',{
      './supabase-admin':{supabaseAdmin:{from:()=>{const q=chain({data:scenario==='outsider'?null:tx});q.update=p=>{Object.assign(tx,p);return chain({data:{id:tx.id}});};return q;}}},
      './payluk-onboarding':{getPaylukCustomerId:async()=> 'provider-seller'},
      './payment-reconciliation':{flagPayment:async()=>{flags++;}},
      './escrow-payment':{applyEscrowPayment:async()=>{applied++;tx.status='paid';}},
      './payluk-service':{PaylukService:{verifyEscrow:async()=>{if(scenario==='read-timeout')throw new Error('Read timeout');return{amount:2500,additionalFee:75,whoPays:'seller',state:scenario==='paid'?'OPENED':'AWAITING_PAYMENT',status:scenario==='paid'?'ONGOING':'PENDING'};},deleteEscrow:async()=>{deleted++;if(scenario==='delete-timeout')throw new Error('Unknown deletion outcome');}}},
    });
    const run=()=>cancelBookingCheckout('order',scenario==='outsider'?'outsider':'buyer');
    if(scenario==='unpaid')await run();else await assert.rejects(run());
    assert.equal(deleted,['unpaid','delete-timeout'].includes(scenario)?1:0);assert.equal(applied,scenario==='paid'?1:0);assert.equal(flags,scenario==='delete-timeout'?1:0);
    assert.equal(tx.status,{unpaid:'cancelled','read-timeout':'pending','delete-timeout':'reconciling',paid:'paid',outsider:'pending','in-flight':'creating_escrow'}[scenario]);
  });
}

for(const scenario of ['success','paid-replay','unpaid','fee-mismatch','principal-mismatch','outsider']){
  test(`booking verification requires the owned settled amount: ${scenario}`,async()=>{
    let applied=0,flags=0,verified=0;
    const tx={id:'order',buyer_id:'buyer',item_id:'booking',status:scenario==='paid-replay'?'paid':'pending',amount:2500,commission:75,payluk_tx_ref:'PY_TOKEN',payluk_escrow_id:'escrow-id',metadata:{payluk_fee_mode:'buyer_commission_v1'}};
    const {verifyBookingCheckout}=load('src/lib/bookings/booking-payments.ts',{
      './supabase-admin':{supabaseAdmin:{from:()=>{const q=chain({data:scenario==='outsider'?null:tx});q.eq=(column,value)=>{if(column==='buyer_id')assert.equal(value,scenario==='outsider'?'outsider':'buyer');return q;};return q;}}},
      './payluk-service':{PaylukService:{verifyEscrow:async()=>{verified++;return{status:scenario==='unpaid'?'PENDING':'ONGOING',amount:scenario==='principal-mismatch'?2501:2500,additionalFee:scenario==='fee-mismatch'?0:75,whoPays:'seller'};}}},
      './payluk-onboarding':{},'./payment-reconciliation':{flagPayment:async()=>{flags++;}},'./escrow-payment':{applyEscrowPayment:async()=>{applied++;}},
    });
    const run=()=>verifyBookingCheckout('booking',scenario==='outsider'?'outsider':'buyer');
    if(['success','paid-replay'].includes(scenario))assert.equal((await run()).transactionId,'order');else await assert.rejects(run());
    assert.equal(applied,scenario==='success'?1:0);assert.equal(verified,['paid-replay','outsider'].includes(scenario)?0:1);
    assert.equal(flags,['fee-mismatch','principal-mismatch'].includes(scenario)?1:0);
  });
}

for(const operation of ['verify','cancel-checkout'])for(const scenario of ['anonymous','suspended','malformed','invalid-id']){
  test(`booking ${operation} rejects ${scenario} before payment work`,async()=>{
    const {POST}=load(`src/app/api/bookings/${operation}/route.ts`,{
      '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:scenario==='anonymous'?null:{id:'buyer'}},error:scenario==='suspended'?{status:403}:null})},
      '@/lib/booking-payments':{BookingCheckoutError:class extends Error{},verifyBookingCheckout:()=>{throw new Error('Unauthorized payment access');},cancelBookingCheckout:()=>{throw new Error('Unauthorized payment access');}},
    });
    const response=await POST(new Request('https://qa.invalid/api/bookings/'+operation,{method:'POST',body:scenario==='malformed'?'{':JSON.stringify({bookingId:'invalid',transactionId:'invalid'})}));
    assert.equal(response.status,scenario==='anonymous'?401:scenario==='suspended'?403:400);
  });
}

for (const scenario of ['no-profile', 'no-phone', 'incomplete-profile', 'anonymous', 'onboarding-next', 'external-next', 'completed-no-phone', 'password-recovery']) {
  test(`auth callback preserves password recovery and onboarding boundaries: ${scenario}`, async () => {
    let queries = 0;
    const profile = scenario === 'no-profile' ? null : {
      id: 'qa-user',
      phone: ['no-phone', 'completed-no-phone'].includes(scenario) ? null : '2347000000001',
      profile_completed: scenario === 'completed-no-phone',
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: scenario === 'anonymous' ? null : { user: { id: 'qa-user', email: 'fixture@example.test' } } } }) },
      from: () => { queries++; return chain({ data: profile }); },
    };
    const { GET } = load('src/app/auth/callback/route.ts', {
      '@/lib/supabase-server': { createClient: async () => client },
      'next/server': { NextResponse: { redirect: url => new Response(null, { status: 307, headers: { location: String(url) } }) } },
    });
    const next = scenario === 'external-next' ? 'https://external.invalid/reset-password' : ['no-profile', 'no-phone', 'incomplete-profile', 'onboarding-next', 'completed-no-phone'].includes(scenario) ? '/marketplace' : '/reset-password';
    const response = await GET(new Request(`https://qa.invalid/auth/callback?next=${encodeURIComponent(next)}`));
    const target = new URL(response.headers.get('location'));
    assert.equal(target.origin, 'https://qa.invalid');
    const expectedPath = scenario === 'anonymous' ? '/login'
      : scenario === 'no-profile' || scenario === 'no-phone' ? '/onboarding/verify-phone'
      : scenario === 'incomplete-profile' || scenario === 'onboarding-next' || scenario === 'external-next' ? '/onboarding/profile'
      : scenario === 'completed-no-phone' ? '/marketplace'
      : '/reset-password';
    assert.equal(target.pathname, expectedPath);
    assert.equal(queries, ['anonymous', 'password-recovery'].includes(scenario) ? 0 : scenario === 'no-profile' ? 2 : 1);
  });
}

for (const operation of ['send', 'verify']) {
  for (const scenario of ['anonymous', 'invalid-token', 'revoked-session', 'session-unavailable', 'suspended', 'bad-input', 'rate-limit', 'provider-failure', 'success', ...(operation === 'verify' ? ['other-owner', 'wrong-phone', 'wrong-code', 'replay'] : ['save-failure'])]) {
    test(`phone OTP ${operation} enforces identity and challenge state: ${scenario}`, async () => {
      let handler, providerCalls = 0, saved, completed = 0;
      const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const phone = '2347000000001';
      const admin = {
        from: table => {
          if (table === 'users') return chain({ data: scenario === 'suspended' ? { is_suspended: true } : operation === 'send' ? [] : {} });
          assert.equal(table, 'phone_verification_challenges');
          return { insert: async row => { saved = row; return { error: scenario === 'save-failure' ? { code: 'database_failure' } : null }; } };
        },
        rpc: async name => {
          if (name === 'consume_rate_limit') return { data: scenario !== 'rate-limit' };
          if (name === 'claim_phone_verification_attempt') return { data: scenario === 'other-owner' ? null : phone };
          assert.equal(name, 'complete_phone_verification');
          completed++;
          return { data: scenario !== 'replay' };
        },
      };
      // authorize() uses a single profile row; duplicate-phone lookup uses an array.
      admin.from = table => {
        if (table !== 'users') return { insert: async row => { saved = row; return { error: scenario === 'save-failure' ? { code: 'database_failure' } : null }; } };
        const profile = chain({ data: scenario === 'suspended' ? { is_suspended: true } : {} });
        profile.in = () => chain({ data: [] });
        return profile;
      };
      const mocks = {
        'https://deno.land/std@0.168.0/http/server.ts': { serve: fn => { handler = fn; } },
        'https://esm.sh/@supabase/supabase-js@2': { createClient: (_url, key) => key === 'public-fixture' ? {
          auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: owner } : null } }) },
          rpc: async name => {
            assert.equal(name, 'is_current_session_active');
            return { data: scenario !== 'revoked-session', error: scenario === 'session-unavailable' ? { code: 'service_unavailable' } : null };
          },
        } : admin },
        globals: { Deno: { env: { get: name => ({ SUPABASE_URL: 'https://qa.invalid', SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'backend-fixture', TERMII_API_KEY: 'provider-fixture' })[name] } } },
        fetch: async (_url, options) => {
          providerCalls++;
          assert.equal(JSON.parse(options.body).api_key, 'provider-fixture');
          if (scenario === 'provider-failure') return Response.json({}, { status: 503 });
          return Response.json(operation === 'send' ? { smsStatus: 'Message Sent', pinId: 'fixture-challenge' }
            : { verified: scenario !== 'wrong-code', msisdn: scenario === 'wrong-phone' ? '2347000000002' : phone });
        },
      };
      load(`supabase/functions/${operation === 'send' ? 'send' : 'verify'}-phone-otp/index.ts`, mocks);
      const headers = scenario === 'anonymous' ? {} : { authorization: `Bearer ${scenario === 'invalid-token' ? 'invalid' : 'valid'}` };
      const body = scenario === 'bad-input' ? { phone: 123, pinId: 'fixture-challenge', pin: 123456 }
        : operation === 'send' ? { phone: '07000000001' } : { pinId: 'fixture-challenge', pin: '123456' };
      const response = await handler(new Request('https://qa.invalid', { method: 'POST', headers, body: JSON.stringify(body) }));
      const statuses = { anonymous: 401, 'invalid-token': 401, 'revoked-session': 401, 'session-unavailable': 401, suspended: 403, 'bad-input': 400, 'rate-limit': 429, 'provider-failure': 503, success: 200, 'other-owner': 400, 'wrong-phone': 400, 'wrong-code': 400, replay: 400, 'save-failure': 503 };
      assert.equal(response.status, statuses[scenario]);
      if (['anonymous', 'invalid-token', 'revoked-session', 'session-unavailable', 'suspended', 'bad-input', 'rate-limit', 'other-owner'].includes(scenario)) assert.equal(providerCalls, 0);
      if (operation === 'send' && scenario === 'success') assert.deepEqual(JSON.parse(JSON.stringify(saved)), { pin_id: 'fixture-challenge', user_id: owner, phone });
      if (operation === 'verify' && ['other-owner', 'wrong-phone', 'wrong-code'].includes(scenario)) assert.equal(completed, 0);
      assert.ok(!(await response.text()).includes('provider-fixture'));
    });
  }
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
  const { invokeServerFunction } = load('src/lib/notifications/server-functions.ts', {
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
  const { PayoutService } = load('src/lib/payments/payout-service.ts', {
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

function payoutHarness({ verifyStatus = 'success', walletBalance = 2500, earnings = 2500, otherReserved = 0, lostClaim = false, intentError = false } = {}) {
  const calls = [], updates = [];
  let payout;
  const account = { id:'bank',is_active:true,verification_status:'verified',account_updated_at:null,account_type:'bank_account',
    account_details:{bank_code:'001',account_number:'0000000000',account_name:'QA Seller'} };
  const admin = {
    from: table => {
      if (table === 'seller_accounts') return chain({data:account});
      if (table === 'escrow_transactions') return chain({data:[{seller_amount:earnings,status:'completed',item_type:'post',payment_provider:'payluk'}]});
      assert.equal(table,'payout_requests');
      const filters = []; let payload, single = false;
      const q = { select:()=>q, eq:(key,value)=>{filters.push([key,value]);return q;},
        single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},
        update:value=>{payload=value;return q;},
        then:(resolve,reject)=>Promise.resolve().then(()=>{
          if (payload) {
            if (!payout || filters.some(([key,value])=>payout[key]!==value) || (lostClaim && payload.status==='processing')) return {data:single?null:[]};
            Object.assign(payout,payload);updates.push({...payload});return {data:single?{id:payout.id}:[{id:payout.id}]};
          }
          return {data:single?payout&&{...payout,seller_account:account}:[...(payout?[{amount:payout.amount,status:payout.status}]:[]),...(otherReserved?[{amount:otherReserved,status:'processing'}]:[])]};
        }).then(resolve,reject) };
      return q;
    },
    rpc:async (name,args)=>{
      assert.equal(name,'reserve_seller_payout');assert.equal(args.p_amount,1200);
      payout={id:'owned-payout',seller_id:'seller',amount:1200,status:'pending'};return {data:payout.id};
    },
  };
  const {PaylukService} = load('src/lib/payments/payluk-service.ts',{'./payluk-onboarding':{},fetch:async (url,options)=>{
    calls.push(new URL(url).pathname);
    if (url.endsWith('/wallet')) return Response.json({status:200,data:{mainBalance:walletBalance}});
    if (url.endsWith('/create-intent')) {
      if (intentError) return Response.json({status:429,message:'Too many request'},{status:429});
      const input=JSON.parse(options.body);return Response.json({status:200,data:{amount:input.amount,fee:10.75,reference:input.reference}});
    }
    assert.ok(url.endsWith('/verify'));assert.equal(payout.execution_stage,'submitted');
    assert.equal(payout.transaction_reference,JSON.parse(options.body).reference);
    if (verifyStatus==='timeout') throw new Error('Verify response lost');
    return Response.json({status:200,data:{status:verifyStatus}});
  }});
  const {PayoutService} = load('src/lib/payments/payout-service.ts',{
    './supabase-admin':{supabaseAdmin:admin},'./payluk-service':{PaylukService},
    './payluk-onboarding':{getPaylukCustomerId:async()=>{calls.push('/v1/customer/get/validated');return 'customer';}},
    './server-notification-service':{NotificationService:{createPayoutProcessedNotification:async()=>{},createPayoutFailedNotification:async()=>{}}},
  });
  return {PayoutService,admin,calls,updates,account,get payout(){return payout;}};
}

test('one hosted withdrawal stays within seven provider calls and reserves before execution',async()=>{
  const h=payoutHarness();
  const {POST}=load('src/app/api/seller/payouts/request/route.ts',{
    '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:'seller'}}})},
    '@/lib/supabase-admin':{supabaseAdmin:h.admin},'@/lib/payout-service':{PayoutService:h.PayoutService},
  });
  const response=await POST(new Request('https://qa.invalid/api/seller/payouts/request',{method:'POST',body:JSON.stringify({amount:1200})}));
  assert.equal(response.status,200);assert.equal(h.payout.status,'completed');
  assert.equal(h.calls.length,7);assert.equal(h.calls.filter(x=>x.endsWith('/wallet')).length,2);
  assert.equal(h.calls.filter(x=>x.endsWith('/verify')).length,1);
  assert.equal(h.payout.amount,1200);const body=await response.json();
  assert.equal(body.amountSentToBank,1189.25);assert.equal(body.fee,10.75);assert.equal(body.totalDebited,1200);
});

for(const status of ['pending','timeout']) test(`payout ${status} retains its submitted marker and reserved balance`,async()=>{
  const h=payoutHarness({verifyStatus:status});const id=await h.PayoutService.reservePayout('seller','bank',1200);
  assert.equal((await h.PayoutService.processPayout(id)).success,false);
  assert.equal(h.payout.status,'processing');assert.equal(h.payout.execution_stage,'submitted');
  assert.equal((await h.PayoutService.getSellerLedgerBalance('seller')).pendingPayouts,1200);
  const before=h.calls.length;await h.PayoutService.processPayout(id);assert.equal(h.calls.length,before,'CAS rejects a second worker before provider calls');
});

test('withdrawal execution retains other reservations and rejects insufficient provider funds before staging',async()=>{
  const h=payoutHarness();const id=await h.PayoutService.reservePayout('seller','bank',1200);
  const {PaylukService}=load('src/lib/payments/payluk-service.ts',{'./payluk-onboarding':{},fetch:async url=>{
    assert.ok(url.endsWith('/wallet'),'No intent may be staged with insufficient wallet funds');
    return Response.json({status:200,data:{mainBalance:1199}});
  }});
  // The public executor independently checks wallet and the supplied earned limit.
  assert.equal((await PaylukService.withdrawToBank({sellerPaylukCustomerId:'customer',amount:1200,bankCode:'001',accountNumber:'0000000000',reference:id,yrdlyAvailableBalance:2500,onIntentReady:async()=>{throw new Error('No execution allowed');}})).outcome,'failed');
  const reserved=payoutHarness({earnings:2500,otherReserved:1400});
  await assert.rejects(reserved.PayoutService.reservePayout('seller','bank',1200),/INSUFFICIENT_BALANCE/);
});

test('a failed payout retry uses a fresh intent reference',async()=>{
  const h=payoutHarness({verifyStatus:'failed'});const id=await h.PayoutService.reservePayout('seller','bank',1200);
  await h.PayoutService.processPayout(id);const first=h.payout.transaction_reference;
  h.payout.status='pending';await h.PayoutService.processPayout(id);
  assert.notEqual(h.payout.transaction_reference,first);assert.equal(h.payout.status,'failed');
});

test('a provider limit before intent creation preserves proof that verification was never sent',async()=>{
  const h=payoutHarness({intentError:true});const id=await h.PayoutService.reservePayout('seller','bank',1200);
  await h.PayoutService.processPayout(id);
  assert.equal(h.payout.status,'failed');assert.equal(h.payout.execution_stage,'preparing');
  assert.equal(h.calls.some(x=>x.endsWith('/verify')),false);
});

test('a worker that loses the payout claim makes no provider calls',async()=>{
  const h=payoutHarness({lostClaim:true});const id=await h.PayoutService.reservePayout('seller','bank',1200);
  const before=h.calls.length;await h.PayoutService.processPayout(id);assert.equal(h.calls.length,before);
});

test('execution cannot spend funds reserved by another payout after reservation',async()=>{
  const h=payoutHarness();const id=await h.PayoutService.reservePayout('seller','bank',1200);
  h.PayoutService.getSellerLedgerBalance=async()=>({totalEarnings:2500,completedPayouts:0,pendingPayouts:2600,availableBalance:0});
  assert.equal((await h.PayoutService.processPayout(id)).success,false);
  assert.equal(h.payout.status,'failed');assert.equal(h.payout.execution_stage,'preparing');
  assert.equal(h.calls.some(x=>x.endsWith('/create-intent')),false);
});

for(const scenario of ['preparing-failed','preparing-processing','submitted-missing','legacy-missing','provider-failed','provider-success','stale-attempt']) {
  test(`payout retry requires durable attempt proof: ${scenario}`,async()=>{
    let history=0,requeues=0,executions=0;
    const payout={id:'payout',seller_id:'seller',amount:1200,status:scenario==='preparing-processing'?'processing':'failed',
      payment_provider:'payluk',transaction_reference:'observed-attempt',execution_stage:scenario.startsWith('preparing')?'preparing':scenario.startsWith('legacy')?null:'submitted'};
    const {POST}=load('src/app/api/seller/payouts/[payoutId]/retry/route.ts',{
      '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:'seller'}}})},
      '@/lib/supabase-admin':{supabaseAdmin:{from:()=>{const q=chain({data:payout});q.update=()=>chain({data:[{id:payout.id}]});return q;},rpc:async(name,args)=>{
        requeues++;assert.equal(name,'requeue_seller_payout');assert.equal(args.p_expected_reference,'observed-attempt');assert.equal(args.p_expected_status,payout.status);
        return {data:scenario!=='stale-attempt'};
      }}},
      '@/lib/payluk-service':{PaylukService:{getWithdrawalStatus:async()=>{history++;return scenario==='provider-success'?'success':['provider-failed','stale-attempt'].includes(scenario)?'failed':'pending';}}},
      '@/lib/payluk-onboarding':{getPaylukCustomerId:async()=> 'customer'},
      '@/lib/payout-service':{PayoutService:{getSellerBalance:async()=>({availableBalance:2500,pendingPayouts:0}),processPayout:async()=>{executions++;return {success:true};}}},
    });
    const response=await POST(new Request('https://qa.invalid',{method:'POST',headers:{authorization:'Bearer test'}}),{params:Promise.resolve({payoutId:'payout'})});
    assert.equal(history,scenario==='preparing-failed'?0:1);
    const mayExecute=['preparing-failed','provider-failed'].includes(scenario);
    assert.equal(executions,mayExecute?1:0);assert.equal(requeues,mayExecute||scenario==='stale-attempt'?1:0);
    assert.equal(response.status,mayExecute||scenario==='provider-success'?200:409);
  });
}

test('authenticated GET sends no request body', async () => {
  const { authenticatedFetch } = load('src/lib/auth/authenticated-fetch.ts', {
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
      '@/lib/dispute-settlement': { saveDisputePlan:async()=>({status:'COMPLETED',additionalFeeRefundable:false}),applyDisputeSettlement:async()=>{finalized=true;return true;} },
      '@/lib/payluk-service': { PaylukService: { verifyEscrow:async()=>({}),resolveDispute: async (id, params) => {
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

for (const status of ['REFUNDED', 'COMPLETED', 'SPLIT']) {
  test(`dispute resolution sends allocation fields only for SPLIT: ${status}`, async () => {
    let finalized = false, sent;
    const refund = status === 'REFUNDED' ? 1000 : status === 'SPLIT' ? 400 : 0;
    const seller = 1000 - refund;
    const service = load('src/lib/payments/payluk-service.ts', { './payluk-onboarding': {}, fetch: async (_url, options) => {
      if (options.method === 'GET') return Response.json({status:200,data:{id:'owned-escrow',status}});
      sent = options.body;
      const hasAllocation = sent.has('sellerAmount') || sent.has('buyerAmount');
      if (sent.get('status') !== 'SPLIT' && hasAllocation) return Response.json({ status: 400, message: 'sellerAmount and buyerAmount are only valid on a SPLIT resolution' }, { status: 400 });
      return Response.json({ status: 200, data: { id: 'owned-escrow', status } });
    } });
    const { POST } = load('src/app/api/admin/disputes/[disputeId]/resolve/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'admin' } } }) },
      '@/lib/payluk-service': service,
      '@/lib/dispute-settlement': { saveDisputePlan:async()=>({status,additionalFeeRefundable:status!=='COMPLETED',buyerAmount:refund*0.98,sellerAmount:seller*0.98}),applyDisputeSettlement:async()=>{finalized=true;return true;} },
      '@/lib/server-notification-service': { NotificationService: { createDisputeResolvedNotification: async () => {} } },
      '@/lib/supabase-admin': { supabaseAdmin: {
        from: table => chain({ data: table === 'users' ? { is_admin: true } : table === 'disputes' ? { transaction_id: 'owned-transaction' } : { id: 'owned-transaction', payment_provider: 'payluk', payluk_escrow_id: 'owned-escrow' } }),
        rpc: async name => {
          if (name === 'begin_dispute_resolution') return { data: { newly_created: true, operation: { id: 'operation', refund_amount: refund, seller_amount: seller, resolution: 'QA ruling' } } };
          if (name === 'finish_dispute_resolution') finalized = true;
          return {};
        },
      } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ resolution: 'QA ruling', refundAmount: refund, sellerAmount: seller }) }), { params: Promise.resolve({ disputeId: 'owned-dispute' }) });
    assert.equal(response.status, 200); assert.equal(finalized, true); assert.equal(sent.get('status'), status);
    assert.equal(sent.has('sellerAmount'), status === 'SPLIT'); assert.equal(sent.has('buyerAmount'), status === 'SPLIT');
    if (status === 'SPLIT') { assert.equal(Number(sent.get('buyerAmount')), refund*0.98); assert.equal(Number(sent.get('sellerAmount')), seller*0.98); }
  });
}

test('marketplace message writes once to messages without requiring item_chats', async () => {
  const writes = [];
  const { SupabaseChatService } = load('src/lib/supabase/supabase-chat-service.ts', {
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
  const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ data: { phone: '08012345678', phone_verified: false } }) } },
    './payluk-service': { PaylukService: {} },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /Verify your phone/);
});

test('stored Payluk identity with a different phone is rejected without remapping', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => { reads++; return chain({ data: { phone: '08012345678', phone_verified: true, payluk_customer_id: 'existing' } }); } } },
    './payluk-service': { PaylukService: { getCustomerById: async () => ({ customerId: 'existing', phone: '08098765432' }) } },
  });
  await assert.rejects(ensurePaylukCustomer('buyer'), /identity could not be verified/);
  assert.equal(reads, 1);
});

test('Payluk mapping held by another Yrdly user is rejected', async () => {
  let reads = 0;
  const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
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
  const { payoutAccountError } = load('src/lib/payments/payout-account.ts');
  assert.match(payoutAccountError({ is_active: true, verification_status: 'pending' }), /verified/);
  assert.match(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: new Date().toISOString() }), /24 hours/);
  assert.equal(payoutAccountError({ is_active: true, verification_status: 'verified', account_updated_at: null }), null);
});

module.exports = { load, chain };

for (const [status, expected] of [['pending','pending'],['failed','failed'],['success','success'],['successful','pending'],[undefined,'pending']]) {
  test(`withdrawal envelope 200 with ${status} yields ${expected}`, async () => {
    let persisted = false;
    let executions = 0;
    const { PaylukService } = load('src/lib/payments/payluk-service.ts', {
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
  const { PaylukService } = load('src/lib/payments/payluk-service.ts', { './payluk-onboarding': {}, fetch: async (url, options) => {
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

for (const bankCode of ['999992', '044', 'provider-bank-code']) {
  test(`bank-list code ${bankCode} survives account resolution, preview and withdrawal`, async () => {
    let intents = 0, executions = 0;
    const { PaylukService } = load('src/lib/payments/payluk-service.ts', {
      './payluk-onboarding': {},
      fetch: async (url, options) => {
        if (url.endsWith('/v1/payment/bank-list')) return Response.json({ status: 200, data: [{ name: 'QA Bank', code: bankCode }] });
        if (url.endsWith('/v1/wallet')) return Response.json({ status: 200, data: { mainBalance: 5000 } });
        const input = JSON.parse(options.body);
        if (url.endsWith('/v1/payment/verify-account')) {
          assert.equal(input.bankCode, bankCode, 'Use the selected provider bank code verbatim');
          return Response.json({ status: 200, data: { accountName: 'QA Seller', accountNumber: input.accountNumber } });
        }
        if (url.endsWith('/v1/payment/create-intent')) {
          assert.equal(input.withdrawalDetails.bankCode, bankCode, 'Never rewrite a provider bank code');
          intents++;
          return Response.json({ status: 200, data: { amount: input.amount, fee: 10.75, reference: input.reference } });
        }
        assert.ok(url.endsWith('/v1/payment/verify'));
        executions++;
        return Response.json({ status: 200, data: { status: 'success' } });
      },
    });
    const [bank] = await PaylukService.getBankList();
    assert.equal((await PaylukService.resolveAccount('0123456789abcdef01234567', '0000000000', bank.code)).valid, true);
    const params = { sellerPaylukCustomerId: 'customer', amount: 1200, bankCode: bank.code,
      accountNumber: '0000000000', reference: 'qa-bank-code', onIntentReady: async () => {} };
    assert.equal((await PaylukService.previewWithdrawal(params)).success, true);
    assert.equal(executions, 0, 'Preview cannot execute a payout');
    assert.equal((await PaylukService.withdrawToBank(params)).success, true);
    assert.equal(intents, 4);
    assert.equal(executions, 1);
  });
}

test('suspension lookup errors fail closed', async () => {
  const { isUserSuspendedOrBanned } = load('src/lib/moderation/user-suspension.ts', {
    './supabase-admin': { supabaseAdmin: { from: () => chain({ error: { message: 'database unavailable' } }) } },
  });
  await assert.rejects(isUserSuspendedOrBanned('user'), /could not be verified/);
});

test('provider references never get compared with a UUID id column', () => {
  const { paymentReferenceFilter } = load('src/lib/payments/payment-state.ts');
  assert.equal(paymentReferenceFilter('provider-123', ['id','payment_reference']), 'payment_reference.eq.provider-123');
  assert.throws(() => paymentReferenceFilter('x,amount.gt.0', ['id','payment_reference']), /Invalid payment reference/);
});

test('organizer-paid commission preserves ticket price and verifies the provider fee allocation', () => {
  const { paylukAmountsMatch, paylukEscrowPrincipal } = load('src/lib/payments/payment-state.ts');
  const ticket = { amount: 2500, commission: 75, metadata: { payluk_fee_mode: 'seller_commission_v1' } };
  assert.equal(paylukEscrowPrincipal(ticket), 2425);
  assert.equal(paylukAmountsMatch(ticket, { amount: 2425, additionalFee: 75, whoPays: 'seller' }), true);
  assert.equal(paylukAmountsMatch(ticket, { amount: 2500, additionalFee: 75, whoPays: 'seller' }), false);
  assert.equal(paylukAmountsMatch(ticket, { amount: 2425, additionalFee: 0, whoPays: 'seller' }), false);
  assert.equal(paylukAmountsMatch(ticket, { amount: 2425, additionalFee: 75, whoPays: 'buyer' }), false);
  assert.equal(paylukEscrowPrincipal({ amount: 2500, commission: 75 }), 2500);
  assert.throws(() => paylukEscrowPrincipal({ ...ticket, commission: 2501 }), /Invalid stored/);
});

for (const scenario of ['released', 'held', 'legacy', 'claim-timeout-confirmed']) {
test(`event payout ${scenario} includes USED tickets and only withdraws released net proceeds`, async () => {
  const updates = [];
  let withdrawals = 0, claims = 0;
  const paymentId = '11111111-1111-4111-a111-111111111111';
  const transaction = { id: paymentId, amount: 2000, commission: 60, seller_amount: 1901.20, status: 'paid', payluk_tx_ref: 'owned-token', payment_provider: 'payluk', metadata: { event_id: 'event', quantity: 1, ...(scenario === 'legacy' ? {} : { payluk_fee_mode: 'seller_commission_v1' }) } };
  const admin = { from(table) {
    const operations = [];
    const query = {};
    for (const method of ['select','eq','in','is','single','maybeSingle','delete','insert','update']) query[method] = (...args) => { operations.push([method,...args]); return query; };
    query.then = (resolve, reject) => {
      let data;
      if (table === 'tickets') {
        const allowed = operations.find(([op]) => op === 'in')[2];
        data = [{ status: 'USED', amount_paid: 2000, payment_provider: 'payluk', settlement_mode: 'held', payment_tx_ref: paymentId }].filter(ticket => allowed.includes(ticket.status));
      } else if (table === 'seller_accounts') data = { account_details: { bank_code: '044', account_number: '0000000000' }, updated_at: '2026-01-01' };
      else if (table === 'escrow_transactions') data = [transaction];
      else if (operations.some(([op]) => op === 'insert')) {
        assert.equal(operations.find(([op]) => op === 'insert')[1].gross_amount, 2000);
        assert.equal(operations.find(([op]) => op === 'insert')[1].commission_amount, 60);
        assert.equal(operations.find(([op]) => op === 'insert')[1].net_amount, 1901.20);
        data = { id: 'payout' };
      } else data = null;
      const update = operations.find(([op]) => op === 'update');
      if (table === 'event_payouts' && update) data = [{ id:'payout' }];
      if (update) updates.push({ table, ...update[1] });
      return Promise.resolve({ data, error: null }).then(resolve,reject);
    };
    return query;
  } };
  const { EventEscrowService } = load('src/lib/events/event-escrow-service.ts', {
    '@supabase/supabase-js': { createClient: () => admin },
    './payluk-service': { PaylukService: {
      verifyEscrow: async token => { assert.equal(token, 'owned-token'); return { status: scenario === 'held' || (scenario === 'claim-timeout-confirmed' && !claims) ? 'ONGOING' : 'COMPLETED', amount: 1940, fee: 38.80, additionalFee: 60, whoPays: 'seller' }; },
      claimFunds: async (customer, token) => { claims++; assert.equal(customer, 'customer'); assert.equal(token, 'owned-token'); throw new Error('Simulated claim timeout'); },
      withdrawToBank: async params => {
      withdrawals++; assert.equal(params.amount, 1901.20);
      await params.onIntentReady('intent'); return { outcome: 'pending', success: false };
    } } },
    './payluk-onboarding': { getPaylukCustomerId: async () => 'customer' },
  });
  await assert.rejects(EventEscrowService.processEventPayout('event','organizer'), scenario === 'legacy' ? /reconciliation/ : scenario === 'held' ? /not confirmed released/ : /pending/);
  assert.equal(withdrawals, ['released', 'claim-timeout-confirmed'].includes(scenario) ? 1 : 0);
  assert.equal(updates.some(update => update.table === 'events'), false);
  assert.equal(updates.some(update => update.status === 'PROCESSING'), ['released', 'claim-timeout-confirmed'].includes(scenario));
  assert.equal(updates.some(update => update.status === 'COMPLETED'), false);
});
}


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


for (const scenario of ['buyer', 'seller', 'retry-buyer']) {
  test(`marketplace checkout reports phone verification instead of 502: ${scenario}`, async () => {
    let abandoned = 0, escrowReads = 0;
    const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
      './supabase-admin': { supabaseAdmin: { from: () => chain({ data: { phone: null, phone_verified: false } }) } },
      './payluk-service': { PaylukService: {} },
    });
    const { POST } = load('src/app/api/payment/initialize/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer', email: 'buyer@example.test' } } }) },
      '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
      '@/lib/payluk-onboarding': { getPaylukCustomerId: id => id === (scenario === 'seller' ? 'seller' : 'buyer') ? ensurePaylukCustomer(id) : Promise.resolve(`provider-${id}`) },
      '@/lib/escrow-payment': {},
      '@/lib/payment-reconciliation': { flagPayment: () => assert.fail('No escrow was created; no reconciliation required') },
      '@/lib/payluk-service': { PaylukService: {
        verifyEscrow: async () => ({ status: 'PENDING', state: 'AWAITING_PAYMENT' }),
        updateCustomerPermissions: () => assert.fail('Phone verification must precede provider writes'),
        createEscrow: () => assert.fail('No charge or escrow may be created'),
      } },
      '@/lib/supabase-admin': { supabaseAdmin: {
        rpc: async name => {
          if (name === 'abandon_checkout_reservation') abandoned++;
          return { data: name === 'consume_rate_limit' ? true : 'local-tx' };
        },
        from: table => chain({ data: table === 'posts'
          ? { id: 'item', user_id: 'seller', title: 'Item', price: 2500, is_sold: false, category: 'For Sale', moderation_status: 'approved' }
          : escrowReads++ === 0
            ? scenario === 'retry-buyer' ? [{ id: 'prior', buyer_id: 'buyer', status: 'pending', payluk_tx_ref: 'token', payluk_escrow_id: 'remote' }] : []
            : { id: 'local-tx' } }),
      } },
    });
    const response = await POST(new Request('https://qa.invalid', { method: 'POST', body: JSON.stringify({ itemId: 'item', buyerId: 'buyer', sellerId: 'seller', price: 2500 }) }));
    assert.equal(response.status, 409);
    const data = await response.json();
    assert.equal(data.error, scenario === 'seller' ? 'SELLER_PHONE_UNVERIFIED' : 'PHONE_VERIFICATION_REQUIRED');
    assert.match(data.message, scenario === 'seller' ? /seller/i : /verify your phone/i);
    assert.equal(abandoned, scenario === 'retry-buyer' ? 0 : 1);
  });
}

test('checkout retry reconciles a funded prior escrow without cancelling or charging again', async () => {
  let writes = 0;
  const { POST } = load('src/app/api/payment/initialize/route.ts', {
    '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer',email:'test@example.invalid' } } }) },
    '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended:false }) },
    '@/lib/payluk-onboarding': {},
    '@/lib/escrow-payment': { applyEscrowPayment: async id => { assert.equal(id,'prior');return true; } },
    '@/lib/payment-reconciliation': { flagPayment: async () => {} },
    '@/lib/payluk-service': { PaylukService: { verifyEscrow: async token => { assert.equal(token,'token'); return { status:'ONGOING',state:'OPENED' }; },createEscrow: () => { throw Error('Must not charge twice'); } } },
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

for (const scenario of ['pending', 'funded', 'new-buyer']) {
  test(`last catalog item checkout retry ${scenario} respects the existing reservation`, async () => {
    let applied = 0, verified = 0;
    const { POST } = load('src/app/api/payment/initialize/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer', email: 'buyer@example.test' } } }) },
      '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async id => { assert.equal(id, 'buyer'); return 'provider-buyer'; } },
      '@/lib/escrow-payment': { applyEscrowPayment: async id => { assert.equal(id, 'prior'); applied++; } },
      '@/lib/payment-reconciliation': {},
      '@/lib/payluk-service': { PaylukService: {
        verifyEscrow: async token => { verified++; assert.equal(token, 'owned-token'); return { status: scenario === 'funded' ? 'ONGOING' : 'PENDING', state: 'AWAITING_PAYMENT' }; },
        createEscrow: () => { throw new Error('Retry must not create another escrow'); },
      } },
      '@/lib/supabase-admin': { supabaseAdmin: {
        rpc: async name => { assert.equal(name, 'consume_rate_limit'); return { data: true }; },
        from: table => {
          const data = table === 'catalog_items' ? { id: 'item', in_stock: false, price: 1234.56, title: 'Last item', business_id: 'business' }
            : table === 'businesses' ? { owner_id: 'seller' }
            : scenario === 'new-buyer' ? [] : [{ id: 'prior', buyer_id: 'buyer', status: 'pending', payluk_tx_ref: 'owned-token', payluk_escrow_id: 'owned-escrow', total_amount: 1271.60 }];
          const query = chain({ data });
          query.insert = query.update = () => { throw new Error('Retry must preserve the existing reservation'); };
          return query;
        },
      } },
    });
    const response = await POST(new Request('https://qa.invalid', { method: 'POST', body: JSON.stringify({ itemId: 'item', itemType: 'catalog_item', buyerId: 'buyer', sellerId: 'seller', price: 1 }) }));
    assert.equal(response.status, scenario === 'new-buyer' ? 400 : 200);
    if (scenario !== 'new-buyer') {
      const result = await response.json();
      assert.equal(result.transactionId, 'prior'); assert.equal(result.totalAmount, 1271.60);
      if (scenario === 'pending') assert.equal(result.paylukPaymentToken, 'owned-token');
      else assert.equal(result.alreadyPaid, true);
    }
    assert.equal(verified, scenario === 'new-buyer' ? 0 : 1);
    assert.equal(applied, scenario === 'funded' ? 1 : 0);
  });
}

test('late payment is held for reconciliation instead of reporting success', async () => {
  const { applyEscrowPayment } = load('src/lib/payments/escrow-payment.ts', {
    './supabase-admin': { supabaseAdmin: { rpc: async () => ({ data:'review' }) } },
    './payment-reconciliation': {},
  });
  await assert.rejects(applyEscrowPayment('cancelled','payluk','reference'),/reconciliation/);
});

for (const [lock, price] of [['permissions', 2500], ['customers', 2500], ['currency', 2001.11], ['currency', 1234.56]]) {
  test(lock === 'currency' ? `marketplace checkout preserves commission and total kobo at NGN ${price}` : `marketplace checkout succeeds when Payluk rejects overlapping ${lock} writes`, async () => {
    const expectedCommission = Math.round(price * 0.03 * 100) / 100;
    let permissionBusy = false, permissionCalls = 0, escrowReads = 0, proceedsWrites = 0;
    const { POST } = load('src/app/api/payment/initialize/route.ts', {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer', email: 'qa@example.invalid' } } }) },
      '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
      '@/lib/escrow-payment': {},
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async id => {
        if (lock === 'customers') {
          assert.equal(permissionBusy, false, 'Provider returns HTTP 423 for overlapping customer creates');
          permissionBusy = true;
          await new Promise(resolve => setImmediate(resolve));
          permissionBusy = false;
        }
        return `provider-${id}`;
      } },
      '@/lib/payment-reconciliation': { flagPayment: async () => assert.fail('Successful setup must not require reconciliation') },
      '@/lib/payluk-service': { PaylukService: {
        updateCustomerPermissions: async () => {
          assert.equal(permissionBusy, false, 'Provider returns HTTP 423 for overlapping writes');
          permissionBusy = true;
          permissionCalls++;
          await new Promise(resolve => setImmediate(resolve));
          permissionBusy = false;
        },
        createEscrow: async (seller, params) => { assert.equal(seller, 'provider-seller'); assert.equal(params.amount, price); return { id: 'remote-id', paymentToken: 'PY_TOKEN', fee: 50 }; },
        addAdditionalFee: async (token, fee) => { assert.equal(token, 'PY_TOKEN'); assert.equal(fee, expectedCommission); },
      } },
      '@/lib/supabase-admin': { supabaseAdmin: {
        rpc: async name => ({ data: name === 'consume_rate_limit' ? true : 'local-tx' }),
        from: table => {
          const q = chain({ data: table === 'posts' ? { id: 'item', user_id: 'seller', price, is_sold: false, category: 'For Sale', moderation_status: 'approved' }
            : escrowReads++ === 0 ? [] : { id: 'local-tx' } });
          q.update = row => { if (Object.hasOwn(row, 'seller_amount')) { proceedsWrites++; assert.equal(row.seller_amount, Math.round((price - 50) * 100) / 100); } return q; };
          return q;
        },
      } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ itemId: 'item', buyerId: 'buyer', sellerId: 'seller', price: 1 }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).totalAmount, Math.round((price + expectedCommission) * 100) / 100);
    assert.equal(permissionCalls, 2);
    assert.equal(proceedsWrites, 1);
  });
}

for (const route of ['src/app/api/payluk/confirm-delivery/route.ts', 'src/app/api/transactions/[id]/complete/route.ts']) {
  test(`delivery timeout recovers using the stored payment token: ${route}`, async () => {
    let reads = 0, verified = 0, walletReads = 0;
    const tx = { id: 'local-tx', buyer_id: 'buyer', seller_id: 'seller', status: 'paid', payment_provider: 'payluk', payluk_escrow_id: 'remote-id', payluk_tx_ref: 'PY_TOKEN', amount: 2500, seller_amount: 2500 };
    const { POST } = load(route, {
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } } }) },
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async id => `provider-${id}` },
      '@/lib/payluk-service': { PaylukService: {
        confirmDelivery: async (_buyer, id) => { assert.equal(id, 'remote-id'); throw new Error('Provider response lost after release'); },
        verifyEscrow: async token => { verified++; assert.equal(token, 'PY_TOKEN'); return { status: 'COMPLETED', state: 'CLOSED' }; },
        getCustomerWallet: async () => { walletReads++; return { mainBalance: 100 }; },
      } },
      '@/lib/payout-service': { PayoutService: { initiateAutoPayout: async () => {} } },
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => chain({ data: reads++ === 0 ? tx : [{ id: 'local-tx' }] }) } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ transactionId: 'local-tx' }) }), { params: Promise.resolve({ id: 'local-tx' }) });
    assert.equal(response.status, 200);
    assert.equal(verified, 1);
    assert.equal(walletReads, 0, 'Delivery must preserve escrow proceeds when the wallet balance differs');
  });
}

test('legacy payment success webhook verifies escrowDetails.paymentToken', async () => {
  let verified = 0;
  const { POST } = load('src/app/api/webhooks/payluk/route.ts', {
    '@/lib/payluk-service': { PaylukService: { verifyEscrow: async token => { verified++; assert.equal(token, 'PY_TOKEN'); return { status: 'PENDING' }; } } },
    '@/lib/booking-payments': { handlePaylukWebhookEvent: async () => {} },
    '@/lib/supabase-admin': {}, '@/lib/escrow-payment': {}, '@/lib/payment-reconciliation': {},
    '@/lib/server-notification-service': {}, '@/lib/ticket-service': {}, '@/lib/payout-service': {}, '@/lib/server-push-notification': {},
  });
  const body = JSON.stringify({ event: 'payment.success', data: { transactionType: 'escrow', status: 'success', escrowDetails: { id: 'remote-id', paymentToken: 'PY_TOKEN' } } });
  const signature = require('node:crypto').createHmac('sha512', 'test-only').update(body).digest('hex');
  const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'x-payluk-signature': signature }, body }));
  assert.equal(response.status, 200);
  assert.equal(verified, 1);
});

test('payment write failure records a durable reconciliation flag before returning failure', async () => {
  let flagged = false;
  const { applyEscrowPayment } = load('src/lib/payments/escrow-payment.ts', {
    './supabase-admin': { supabaseAdmin: { rpc: async () => ({ error:{ code:'db-error' } }) } },
    './payment-reconciliation': { flagPayment: async () => { flagged = true; } },
  });
  await assert.rejects(applyEscrowPayment('tx','payluk','reference'),/reconciliation/);
  assert.equal(flagged,true);
});


test('auth redirect rejects backslashes and external origins', () => {
  const { safeRelativePath,authCookieDomain } = load('src/lib/auth/auth-navigation.ts');
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
    const { fetchSafeImage } = load('src/lib/media/safe-image-fetch.ts', { fetch:async (_url,options) => {
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

for (const scenario of ['found', 'missing', 'bad-phone', 'unauthorized', 'locked', 'server-error']) {
  test(`Payluk phone lookup distinguishes absent customers from provider failures: ${scenario}`, async () => {
    const http = { found: 200, missing: 400, 'bad-phone': 400, unauthorized: 401, locked: 423, 'server-error': 500 }[scenario];
    const { PaylukService, PaylukRequestError } = load('src/lib/payments/payluk-service.ts', {
      './payluk-onboarding': {},
      fetch: async () => Response.json(scenario === 'found'
        ? { status: 200, data: { data: [{ customerId: 'fixture-customer', phone: '+2348012345678' }] } }
        : { status: false, message: scenario === 'bad-phone' ? 'Invalid phone number' : 'No customer found with the provided phone' }, { status: http }),
    });
    if (scenario === 'found') assert.equal((await PaylukService.getCustomerByPhone('08012345678')).customerId, 'fixture-customer');
    else if (scenario === 'missing') assert.equal(await PaylukService.getCustomerByPhone('08012345678'), null);
    else await assert.rejects(PaylukService.getCustomerByPhone('08012345678'), error => error instanceof PaylukRequestError && error.httpStatus === http);
  });
}

test('new payment identity is created from confirmed Auth email and bound to the verified phone', async () => {
  let reads = 0, created = 0;
  const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
    './supabase-admin': { supabaseAdmin: {
      from: () => chain({ data: ++reads === 1 ? { phone: '08012345678', phone_verified: true, legal_name: 'Fixture Buyer' } : reads === 2 ? [] : { payluk_customer_id: 'new-customer' } }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'confirmed@example.test', email_confirmed_at: '2026-10-10' } } }) } },
    } },
    './payluk-service': { PaylukService: {
      getCustomerByPhone: async () => null,
      createCustomer: async params => {
        created++;
        assert.equal(params.email, 'confirmed@example.test');
        assert.equal(params.phone, '08012345678');
        return { customerId: 'new-customer', phone: '+2348012345678' };
      },
    } },
  });
  assert.equal(await ensurePaylukCustomer('fixture-buyer'), 'new-customer');
  assert.equal(created, 1);
  assert.equal(reads, 3);
});

test('onboarding has an overall deadline and never scans customer pages', async () => {
  let lookups = 0;
  const { ensurePaylukCustomer } = load('src/lib/payments/payluk-onboarding.ts', {
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
  const media = load('src/lib/media/private-media.ts');
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
    const { validatePrivateMediaPath } = load('src/lib/media/private-media.ts');
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
    assert.throws(()=>load('src/lib/supabase/supabase-admin.ts', {
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
  const { PrivateMediaImage } = load('src/components/media/PrivateMedia.tsx', {
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
    const { StorageService } = load('src/lib/media/storage-service.ts', {
      env:{ NEXT_PUBLIC_PRIVATE_MEDIA_REFERENCES:String(enabled) },
      './supabase':{ supabase:{ storage:{ from:bucket=>({ getPublicUrl:objectPath=>{
        publicUrls++; return { data:{ publicUrl:`https://api.yrdly.ng/storage/v1/object/public/${bucket}/${objectPath}` } };
      } }) } } },
    });
    const source = StorageService.getPublicUrl('chat-images', `${mediaConversation}/photo.png`);
    assert.equal(source.startsWith('storage://'), enabled);
    assert.equal(publicUrls, enabled ? 0 : 1);
    const parsed = load('src/lib/media/private-media.ts').parsePrivateMediaReference(source);
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

for (const scenario of ['missing', 'unsupported', 'other-buyer', 'pending', 'amount-mismatch', 'confirmed', 'replay', 'organizer-commission', 'organizer-fee-mismatch', 'concurrent-callback']) {
  test(`Payluk ticket verification ${scenario}`, async () => {
    let verified = 0, fulfilled = 0, updated = 0, flagged = 0;
    const tx = { id: '00000000-0000-0000-0000-000000000001', buyer_id: scenario === 'other-buyer' ? 'other' : 'buyer',
      item_type: 'ticket', payment_provider: scenario === 'unsupported' ? 'retired-provider' : 'payluk',
      payluk_tx_ref: 'PY_TOKEN', status: scenario === 'replay' ? 'paid' : 'pending', amount: 2000,
      ...(scenario.startsWith('organizer-') ? { commission: 60, metadata: { payluk_fee_mode: 'seller_commission_v1' } } : {}) };
    const { TicketService } = load('src/lib/events/ticket-service.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => {
        const q = chain({ data: scenario === 'missing' ? null : tx });
        q.update = () => { updated++; if (scenario === 'concurrent-callback') { tx.status = 'paid'; return chain({ data: null }); } return chain({ data: { ...tx, status: 'paid' } }); };
        return q;
      } } },
      '@/lib/resend-service': { ResendEmailService: {} }, '@/lib/server-push-notification': {},
      '@/lib/payluk-service': { PaylukService: { verifyEscrow: async token => {
        verified++; assert.equal(token, 'PY_TOKEN');
        return { status: scenario === 'pending' ? 'PENDING' : 'CLAIMED', amount: scenario.startsWith('organizer-') ? 1940 : scenario === 'amount-mismatch' ? 1000 : 2000,
          ...(scenario.startsWith('organizer-') ? { additionalFee: scenario === 'organizer-fee-mismatch' ? 59 : 60, whoPays: 'seller' } : {}) };
      } } },
      './payment-reconciliation': { flagPayment: async () => { flagged++; } },
    });
    TicketService.processTicketPaymentFromTransaction = async paid => { fulfilled++; assert.equal(paid.status, 'paid'); return { id: 'ticket' }; };
    if (['confirmed', 'replay', 'organizer-commission', 'concurrent-callback'].includes(scenario)) {
      assert.equal((await TicketService.verifyAndProcessTicket('order-reference', 'buyer')).id, 'ticket');
    } else {
      await assert.rejects(TicketService.verifyAndProcessTicket('order-reference', 'buyer'), new RegExp({
        missing: 'payment_not_found', unsupported: 'payment_requires_review', 'other-buyer': 'ticket_buyer_mismatch',
        pending: 'payment_pending', 'amount-mismatch': 'payment_requires_review', 'organizer-fee-mismatch': 'payment_requires_review',
      }[scenario]));
    }
    assert.equal(fulfilled, ['confirmed', 'replay', 'organizer-commission', 'concurrent-callback'].includes(scenario) ? 1 : 0);
    assert.equal(updated, ['confirmed', 'organizer-commission', 'concurrent-callback'].includes(scenario) ? 1 : 0);
    assert.equal(verified, ['pending', 'amount-mismatch', 'confirmed', 'organizer-commission', 'organizer-fee-mismatch', 'concurrent-callback'].includes(scenario) ? 1 : 0);
    assert.equal(flagged, ['amount-mismatch', 'organizer-fee-mismatch'].includes(scenario) ? 1 : 0);
  });
}

for (const scenario of ['success', 'provider-failure', 'commission-failure', 'onboarding-failure', 'lost-claim', 'retry', 'mismatch', 'uncertain']) {
  test(`ticket checkout reserves before provider calls and handles ${scenario}`, async () => {
    let created = 0, fees = 0, released = 0, flags = 0;
    const tx = { id: 'owned-order', buyer_id: 'buyer', seller_id: 'organizer', amount: 4000, commission: 120, total_amount: 4000, seller_amount: 3880,
      status: scenario === 'uncertain' ? 'reconciling' : 'pending', payment_reference: 'evt-owned',
      metadata: { payluk_fee_mode: 'seller_commission_v1', quantity: 2, event_id: 'event', tier_id: 'tier' },
      ...(['retry','mismatch'].includes(scenario) ? { payluk_tx_ref: 'PY_TOKEN', payluk_escrow_id: 'escrow-id' } : {}) };
    const admin = {
      rpc: async (name, args) => {
        if (name === 'reserve_ticket_checkout') return { data: { transaction: tx, newly_created: !['retry','mismatch','uncertain'].includes(scenario) } };
        assert.equal(name, 'release_ticket_checkout'); assert.equal(args.p_before_provider, true); released++; tx.status = 'cancelled'; return { error: null };
      },
      from: table => {
        if (table === 'ticket_checkout_reservations') return chain({ data: [] });
        assert.equal(table, 'escrow_transactions'); const q = chain({ data: tx });
        q.update = payload => {
          if (scenario === 'lost-claim') return chain({ data: null });
          Object.assign(tx, payload); return chain({ data: { id: tx.id } });
        }; return q;
      },
    };
    const { createTicketCheckout } = load('src/lib/events/ticket-checkout.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: admin },
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async id => { if (scenario === 'onboarding-failure') throw new Error('Phone verification required'); return 'provider-' + id; } },
      '@/lib/ticket-service': { TicketService: {} },
      '@/lib/payment-reconciliation': { flagPayment: async () => { flags++; } },
      '@/lib/payluk-service': { PaylukService: {
        updateCustomerPermissions: async () => {},
        verifyEscrow: async () => ({ status: 'PENDING', state: 'AWAITING_PAYMENT', amount: 3880, whoPays: 'seller', additionalFee: scenario === 'mismatch' ? 119 : 120 }),
        createEscrow: async (seller, details) => {
          assert.equal(tx.status, 'creating_escrow'); created++; assert.equal(seller, 'provider-organizer');
          assert.equal(details.amount, 3880); assert.equal(details.totalQuantity, 1);
          if (scenario === 'provider-failure') throw new Error('Unknown provider outcome');
          return { id: 'escrow-id', paymentToken: 'PY_TOKEN', fee: 77.60 };
        },
        addAdditionalFee: async (token, fee) => {
          assert.equal(tx.payluk_escrow_id, 'escrow-id'); assert.equal(token, 'PY_TOKEN'); assert.equal(fee, 120); fees++;
          if (scenario === 'commission-failure') throw new Error('Unknown fee outcome');
        },
      } },
    });
    const run = () => createTicketCheckout({ event_id: 'event', tier_id: 'tier', buyer_id: 'buyer', quantity: 2, attendee_name: 'Buyer', attendee_email: 'buyer@example.test', attendee_phone: null }, 'QA tickets', new Date(Date.now()+86400000).toISOString());
    if (['success','retry'].includes(scenario)) {
      const result = await run(); assert.equal(result.paylukPaymentToken, 'PY_TOKEN'); assert.equal(result.totalAmount, 4000); assert.equal(tx.status, 'pending');
      if (scenario === 'success') { assert.equal(tx.seller_amount, 3802.40); assert.equal(tx.metadata.payluk_fee, 77.60); }
    } else await assert.rejects(run());
    assert.equal(created, ['success','provider-failure','commission-failure'].includes(scenario) ? 1 : 0);
    assert.equal(fees, ['success','commission-failure'].includes(scenario) ? 1 : 0);
    assert.equal(released, scenario === 'onboarding-failure' ? 1 : 0);
    assert.equal(flags, ['provider-failure','commission-failure','mismatch'].includes(scenario) ? 1 : 0);
    if (['provider-failure','commission-failure'].includes(scenario)) assert.equal(tx.status, 'reconciling');
    if (scenario === 'commission-failure') assert.equal(tx.payluk_tx_ref, 'PY_TOKEN');
  });
}

for (const scenario of ['unpaid', 'read-timeout', 'delete-timeout', 'paid', 'outsider', 'in-flight']) {
  test(`ticket cancellation protects funds and seats: ${scenario}`, async () => {
    let deleted = 0, released = 0, flags = 0;
    const tx = { id: 'order', item_type: 'ticket', buyer_id: 'buyer', seller_id: 'organizer', status: scenario === 'in-flight' ? 'creating_escrow' : 'pending',
      payluk_escrow_id: 'escrow', payluk_tx_ref: 'PY_TOKEN', amount: 4000, commission: 120, metadata: { payluk_fee_mode: 'seller_commission_v1' } };
    const { cancelTicketCheckout } = load('src/lib/events/ticket-checkout.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: {
        from: () => { const q = chain({ data: tx }); q.update = payload => { Object.assign(tx,payload); return chain({ data: { id:tx.id } }); }; return q; },
        rpc: async (name,args) => { assert.equal(name,'release_ticket_checkout'); assert.equal(args.p_deleted_escrow_id,'escrow'); released++; tx.status='cancelled'; return {error:null}; },
      } },
      '@/lib/payluk-onboarding': { getPaylukCustomerId: async () => 'provider-organizer' },
      '@/lib/ticket-service': { TicketService: { verifyAndProcessTicket: async () => { tx.status='paid'; return {id:'ticket'}; } } },
      '@/lib/payment-reconciliation': { flagPayment: async () => { flags++; } },
      '@/lib/payluk-service': { PaylukService: {
        verifyEscrow: async () => { if (scenario==='read-timeout') throw new Error('Read timeout'); return {status:scenario==='paid'?'ONGOING':'PENDING',state:'AWAITING_PAYMENT',amount:3880,additionalFee:120,whoPays:'seller'}; },
        deleteEscrow: async () => { deleted++; if (scenario==='delete-timeout') throw new Error('Unknown deletion result'); },
      } },
    });
    const run = () => cancelTicketCheckout('order',scenario==='outsider'?'outsider':'buyer');
    if(scenario==='unpaid') await run(); else await assert.rejects(run());
    assert.equal(deleted,['unpaid','delete-timeout'].includes(scenario)?1:0);
    assert.equal(released,scenario==='unpaid'?1:0);assert.equal(flags,scenario==='delete-timeout'?1:0);
    assert.equal(tx.status,{'unpaid':'cancelled','read-timeout':'pending','delete-timeout':'reconciling','paid':'paid','outsider':'pending','in-flight':'creating_escrow'}[scenario]);
  });
}

for (const quantity of ['NaN', 0, -1, 1.5, true, null, 6]) {
  test(`ticket checkout rejects malformed quantity before database/payment work: ${JSON.stringify(quantity)}`, async () => {
    const { POST } = load('src/app/api/events/tickets/purchase/route.ts', {
      '@/lib/ticket-checkout': { TicketCheckoutError: class extends Error {}, createTicketCheckout: () => { throw new Error('Invalid input reached checkout'); } },
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: { id: 'buyer' } } }) },
      '@/lib/user-suspension': { isUserSuspendedOrBanned: async () => ({ suspended: false }) },
      '@/lib/resend-service': { ResendEmailService: {} }, '@/lib/server-push-notification': {},
      '@/lib/payluk-service': {}, '@/lib/payluk-onboarding': {},
      '@/lib/supabase-admin': { supabaseAdmin: { from: () => { throw new Error('Invalid input reached database'); } } },
    });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ event_id: '11111111-1111-4111-a111-111111111111', tier_id: '22222222-2222-4222-a222-222222222222', attendee_name: 'Buyer', attendee_email: 'buyer@example.com', quantity }) }));
    assert.equal(response.status, 400);
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

for (const scenario of ['matching', 'wrong-principal']) {
  test(`organizer-paid ticket refund webhook ${scenario} reconciles gross ledger allocation`, async () => {
    let applied = 0, flagged = 0;
    const tx = { id: 'owned-ticket-payment', amount: 2500, commission: 75, payment_provider: 'payluk', item_type: 'ticket', metadata: { payluk_fee_mode: 'seller_commission_v1' } };
    const { POST } = load('src/app/api/webhooks/payluk/route.ts', {
      '@/lib/supabase-admin': { supabaseAdmin: { from: table => chain({ data: table === 'escrow_transactions' ? tx : null }), rpc: async (name, args) => {
        assert.equal(name, 'apply_escrow_refund'); applied++;
        assert.equal(args.p_refund_amount, 2500); assert.equal(args.p_transaction_id, tx.id);
        return { data: false };
      } } },
      '@/lib/escrow-payment': {}, '@/lib/payment-reconciliation': { flagPayment: async () => { flagged++; } },
      '@/lib/ticket-service': {}, '@/lib/server-notification-service': {}, '@/lib/payluk-service': {}, '@/lib/payout-service': {}, '@/lib/server-push-notification': {},
      '@/lib/booking-payments': { handlePaylukWebhookEvent: async () => {} },
    });
    const body = JSON.stringify({ event: 'escrow.refunded', data: { id: 'owned-escrow', paymentToken: 'OWNED_TOKEN', amount: scenario === 'matching' ? 2425 : 2500 } });
    const signature = require('node:crypto').createHmac('sha512', 'test-only').update(body).digest('hex');
    const response = await POST(new Request('https://qa.invalid', { method: 'POST', body, headers: { 'x-payluk-signature': signature } }));
    assert.equal(response.status, scenario === 'matching' ? 200 : 500);
    assert.equal(applied, scenario === 'matching' ? 1 : 0); assert.equal(flagged, scenario === 'matching' ? 0 : 1);
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
  const { PaylukService } = load('src/lib/payments/payluk-service.ts', {
    env: { PAYLUK_SECRET_KEY: 'sk_test_fixture' }, './payluk-onboarding': {},
    fetch: async () => { throw new Error('Test provider unavailable'); },
  });
  assert.equal((await PaylukService.resolveAccount('0123456789abcdef01234567', '0000000000', 'opaque-code')).valid, false);
});


for (const [mode,amount,commission,fee,refund,seller,expectedBuyer,expectedSeller] of [
 ['buyer_commission_v1',2500,75,50,1250,1250,1225,1225],
 ['seller_commission_v1',2500,75,48.50,1250,1250,1188.25,1188.25],
 ['buyer_commission_v1',1234.56,37.04,24.69,617.28,617.28,604.94,604.93],
 ['buyer_commission_v1',2500,75,50,2500,0,2450,0],
 ['buyer_commission_v1',2500,75,50,0,2500,0,2450],
]) test(`dispute allocation conserves the actual pool: ${mode}/${refund}/${amount}`,()=>{
 const {planDisputeSettlement}=load('src/lib/disputes/dispute-settlement.ts',{'@/lib/supabase-admin':{},'@/lib/payluk-service':{}});
 const tx={id:'tx',amount,commission,payluk_escrow_id:'escrow',metadata:{payluk_fee_mode:mode}};
 const principal=mode==='seller_commission_v1'?amount-commission:amount;
 const plan=planDisputeSettlement(tx,{refund_amount:refund,seller_amount:seller},{id:'escrow',amount:principal,additionalFee:commission,fee,whoPays:'seller',settlementType:'STANDARD'});
 assert.equal(plan.buyerAmount,expectedBuyer);assert.equal(plan.sellerAmount,expectedSeller);
 assert.equal(Math.round((plan.buyerAmount+plan.sellerAmount)*100),Math.round(plan.pool*100));
 assert.equal(plan.additionalFeeRefundable,refund>0);
});
for(const scenario of ['foreign-escrow','principal','commission','fee','milestone','fractional-ruling'])test(`dispute plan rejects unverified allocation: ${scenario}`,()=>{
 const {planDisputeSettlement}=load('src/lib/disputes/dispute-settlement.ts',{'@/lib/supabase-admin':{},'@/lib/payluk-service':{}});
 const tx={id:'tx',amount:2500,commission:75,payluk_escrow_id:'escrow',metadata:{payluk_fee_mode:'buyer_commission_v1'}};
 const remote={id:scenario==='foreign-escrow'?'other':'escrow',amount:scenario==='principal'?2600:2500,fee:scenario==='fee'?2600:50,additionalFee:scenario==='commission'?0:75,whoPays:'seller',settlementType:scenario==='milestone'?'MILESTONE':'STANDARD'};
 assert.throws(()=>planDisputeSettlement(tx,{refund_amount:scenario==='fractional-ruling'?1250.001:1250,seller_amount:1250},remote));
});

for (const value of [0,950,1000,1053,1199.99,1200.001,NaN,Infinity,-1200,'1200',null]) {
  test(`paid price rejects ${String(value)}`, () => {
    const { isPaidPrice } = load('src/lib/marketplace/price-policy.ts');
    assert.equal(isPaidPrice(value),false);
  });
}
for (const value of [1200,1200.01,1234.56,2500]) {
  test(`paid price accepts ${value}`, () => {
    assert.equal(load('src/lib/marketplace/price-policy.ts').isPaidPrice(value),true);
  });
}
test('deposit policy checks the charged amount and full-payment priority', () => {
  const { servicePriceError } = load('src/lib/marketplace/price-policy.ts');
  assert.equal(servicePriceError({price:null}),null);
  assert.equal(servicePriceError({price:0}),null);
  assert.match(servicePriceError({price:1199.99}),/1,200/);
  assert.match(servicePriceError({price:2400,deposit_required:true,deposit_amount:1000}),/deposit/);
  assert.match(servicePriceError({price:1200,deposit_required:true,deposit_percent:50}),/deposit/);
  assert.equal(servicePriceError({price:2400,deposit_required:true,deposit_percent:50}),null);
  assert.equal(servicePriceError({price:1200,deposit_required:true,deposit_amount:1000,requires_full_payment:true}),null);
  assert.equal(servicePriceError({price:1200,deposit_required:true,deposit_amount:1000,escrow_enabled:true}),null);
  assert.match(servicePriceError({price:1200,deposit_percent:100.01}),/whole number/);
});

for (const mode of ['previewWithdrawal','withdrawToBank']) {
  for (const amount of [999.99,1000,1010.74,1010.75]) {
    test(`${mode} enforces the net bank minimum at debit budget ${amount}`, async () => {
      const created=[],executed=[];
      const { PaylukService } = load('src/lib/payments/payluk-service.ts', {
        './payluk-onboarding':{}, fetch:async(url,options)=>{
          if(url.endsWith('/v1/wallet'))return Response.json({status:200,data:{mainBalance:5000}});
          if(url.endsWith('/v1/payment/create-intent')){
            const input=JSON.parse(options.body);created.push(input.amount);
            assert.ok(input.amount>=1000,'Never stage a bank transfer below the minimum');
            return Response.json({status:200,data:{amount:input.amount,fee:10.75,reference:input.reference}});
          }
          assert.ok(url.endsWith('/v1/payment/verify'));executed.push(url);
          return Response.json({status:200,data:{status:'success'}});
        }
      });
      const result=await PaylukService[mode]({sellerPaylukCustomerId:'qa',amount,bankCode:'044',accountNumber:'0000000000',reference:'qa-minimum',onIntentReady:async()=>{}});
      if(amount<1010.75){
        assert.equal(result.success,false);
        assert.equal(executed.length,0);
        assert.equal(created.length,amount<1000?0:1);
      }else{
        assert.equal(result.success,true);
        assert.deepEqual(created,[1010.75,1000]);
        assert.equal(result.intentAmount,1000);
        assert.equal(executed.length,mode==='withdrawToBank'?1:0);
      }
    });
  }
}

for(const price of [950,1199.99,1200.001])test(`posts API rejects paid price ${price} before moderation or writes`,async()=>{
  const {POST}=load('src/app/api/posts/route.ts',{
    '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:'seller'}},error:null})},
    '@/lib/supabase-admin':{supabaseAdmin:{from:()=>{throw Error('Invalid prices must not reach profile, moderation or writes');}}},
    '@/lib/server-functions':{invokeServerFunction:()=>{throw Error('Unexpected moderation request');}}
  });
  const response=await POST(new Request('https://qa.test/api/posts',{method:'POST',body:JSON.stringify({post:{category:'For Sale',price}})}));
  assert.equal(response.status,400);
});

for (const [endpoint, query] of [
  ['https://attacker.invalid', 'input=Lagos'],
  ['place/nearbysearch/json', 'input=Lagos'],
  ['place/autocomplete/json', 'input=Lagos&input=Abuja'],
  ['place/autocomplete/json', 'input=Lagos&url=https://attacker.invalid'],
  ['place/autocomplete/json', 'input=%20%20'],
  ['place/autocomplete/json', `input=${'a'.repeat(201)}`],
  ['place/autocomplete/json', 'input=Lagos&types=invalid'],
  ['place/details/json', 'placeid=../invalid'],
  ['place/details/json', 'placeid=valid&place_id=another'],
  ['geocode/json', 'latlng=91,3'],
  ['geocode/json', 'latlng=6,181'],
  ['geocode/json', 'latlng=,3'],
  ['geocode/json', 'latlng=NaN,3'],
  ['geocode/json', 'latlng=6,3,4'],
]) test(`Maps proxy rejects unsafe address input: ${endpoint} ${query.slice(0, 45)}`, () => {
  const { buildMapsRequest } = load('src/lib/location/maps-proxy.ts');
  assert.throws(() => buildMapsRequest(endpoint.split('/'), new URLSearchParams(query)));
});

test('Maps proxy fixes host, Nigeria scope and billable details fields', () => {
  const { buildMapsRequest } = load('src/lib/location/maps-proxy.ts');
  const auto = buildMapsRequest(['place','autocomplete','json'], new URLSearchParams('input=Lagos&key=client-value&language=fr&components=country:us'));
  assert.equal(auto.origin, 'https://maps.googleapis.com');
  assert.equal(auto.searchParams.get('components'), 'country:ng');
  assert.equal(auto.searchParams.get('language'), 'en');
  assert.equal(auto.searchParams.has('key'), false);
  const details = buildMapsRequest(['place','details','json'], new URLSearchParams('placeid=place_123&fields=reviews,website'));
  assert.equal(details.searchParams.get('place_id'), 'place_123');
  assert.equal(details.searchParams.get('fields'), 'address_components,formatted_address,geometry,name,place_id');
});

for (const enabled of [false,true]) test(`web reverse geocoding preserves location matching with proxy ${enabled}`,async()=>{
  let requested;
  const query={select:()=>query,range:async()=>({data:[{state:'Lagos',lga:'Lagos Island',ward:'Ward',latitude:6,longitude:3}],error:null})};
  const {reverseGeocode}=load('src/lib/location/geocoding-service.ts',{
    env:{NEXT_PUBLIC_MAPS_PROXY_ENABLED:enabled?'true':'false',NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:'public-test-only'},
    '@/lib/supabase':{supabase:{from:table=>{assert.equal(table,'lga_wards');return query;}}},
    fetch:async(url,options)=>{
      requested=url;assert.ok(options.signal);
      return Response.json({status:'OK',results:[{formatted_address:'Lagos, Nigeria',address_components:[{long_name:'Nigeria',types:['country']}]}]});
    },
  });
  const result=await reverseGeocode(6,3);
  assert.equal(result.lga,'Lagos Island');assert.equal(result.displayAddress,'Lagos, Nigeria');
  if(enabled){assert.equal(requested,'/api/maps/geocode/json?latlng=6%2C3');assert.equal(requested.includes('key='),false);}
  else assert.ok(requested.startsWith('https://maps.googleapis.com/maps/api/geocode/json?'));
});

for (const scenario of ['anonymous','suspended','auth-unavailable','invalid','missing-key','limited','limit-unavailable','success','zero-results','provider-denied','provider-http','timeout']) {
  test(`Maps endpoint authenticates and fails safely: ${scenario}`, async () => {
    let quotaCalls = 0, providerCalls = 0;
    const { GET } = load('src/app/api/maps/[...path]/route.ts', {
      env: { GOOGLE_MAPS_SERVER_API_KEY: scenario === 'missing-key' ? '' : 'server-test-only' },
      '@/lib/supabase-server': { getAuthenticatedUser: async () => ({
        data: { user: ['anonymous','suspended','auth-unavailable'].includes(scenario) ? null : { id:'owned-user' } },
        error: scenario === 'suspended' ? {status:403} : scenario === 'auth-unavailable' ? {status:503} : null,
      }) },
      '@/lib/supabase-admin': { supabaseAdmin: { rpc: async (name, args) => {
        quotaCalls++; assert.equal(name,'consume_rate_limit'); assert.equal(args.p_user_id,'owned-user');
        assert.equal(args.p_endpoint,'/api/maps'); assert.equal(args.p_max_requests,60);
        return {data:scenario !== 'limited',error:scenario === 'limit-unavailable' ? {message:'private-db-error'} : null};
      } } },
      fetch: async (url, options) => {
        providerCalls++;
        assert.equal(url.origin,'https://maps.googleapis.com');
        assert.equal(url.searchParams.get('key'),'server-test-only');
        assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store'); assert.ok(options.signal);
        if (scenario === 'timeout') throw new Error('private-key-bearing-provider-url');
        if (scenario === 'provider-http') return new Response('private upstream content',{status:500});
        return Response.json({ status:scenario === 'provider-denied' ? 'REQUEST_DENIED' : scenario === 'zero-results' ? 'ZERO_RESULTS' : 'OK',
          error_message:'private provider details', results:[{formatted_address:'Lagos, Nigeria'}], debug:'private debug' });
      },
    });
    const request = new Request(`https://qa.test/api/maps/geocode/json?latlng=${scenario === 'invalid' ? '91,3' : '6,3'}`);
    request.nextUrl = new URL(request.url);
    const result = await GET(request,{params:Promise.resolve({path:['geocode','json']})});
    const expected = {anonymous:401,suspended:403,'auth-unavailable':503,invalid:400,'missing-key':503,limited:429,'limit-unavailable':503,success:200,'zero-results':200,'provider-denied':503,'provider-http':502,timeout:503}[scenario];
    assert.equal(result.status,expected);
    assert.equal(result.headers.get('cache-control'),'no-store');
    const body = await result.text(); assert.equal(/private|server-test-only/.test(body),false);
    assert.equal(quotaCalls,['anonymous','suspended','auth-unavailable','invalid','missing-key'].includes(scenario)?0:1);
    assert.equal(providerCalls,['success','zero-results','provider-denied','provider-http','timeout'].includes(scenario)?1:0);
  });
}

for (const endpoint of ['place/autocomplete/json','place/details/json']) test(`Maps endpoint keeps native response format: ${endpoint}`, async () => {
  const payload = endpoint.includes('autocomplete') ? {predictions:Array.from({length:12},(_,i)=>({description:`Place ${i}`}))} : {result:{geometry:{location:{lat:6,lng:3}}}};
  const { GET } = load('src/app/api/maps/[...path]/route.ts', {
    env:{GOOGLE_MAPS_SERVER_API_KEY:'server-test-only'},
    '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:'owned-user'}},error:null})},
    '@/lib/supabase-admin':{supabaseAdmin:{rpc:async()=>({data:true,error:null})}},
    fetch:async()=>Response.json({status:'OK',...payload}),
  });
  const request = new Request(`https://qa.test/api/maps/${endpoint}?input=Lagos&placeid=owned-place&key=server-proxy`);
  request.nextUrl = new URL(request.url);
  const response = await GET(request,{params:Promise.resolve({path:endpoint.split('/')})});
  assert.equal(response.status,200);
  const body = await response.json();
  if (body.predictions) assert.equal(body.predictions.length,10); else assert.deepEqual(body.result,payload.result);
});
