const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

const BUYER = 'b11d0000-0000-0000-0000-000000000001';
const TX = 'c22d0000-0000-0000-0000-000000000002';
const escrowId = 'payluk-escrow-qa';

function setup({ buyer = BUYER, balance = 2300, currency = 'NGN', status = 'pending', remoteStatus = 'PENDING',
                 wrongAmount = false, expired = false, uncertain = false, fundBeforeThrow = false } = {}) {
  let debits = 0, applied = 0, flags = 0, verified = 0;
  const row = {
    id: TX, buyer_id: BUYER, seller_id: 'seller', item_type: 'catalog_item',
    status, amount: 2300, total_amount: 2300, commission: 69,
    payment_provider: 'payluk', payluk_tx_ref: 'PY_qa', payluk_escrow_id: escrowId,
    created_at: new Date().toISOString(), metadata: { payluk_fee_mode: 'native_commission_v1' },
  };
  const escrow = { id: escrowId, state: remoteStatus === 'PENDING' ? 'AWAITING_PAYMENT' : 'OPENED',
                   status: remoteStatus, amount: wrongAmount ? 2299 : 2300, whoPays: 'seller', additionalFee: 0 };

  function from(table) {
    assert.equal(table, 'escrow_transactions');
    const conditions = []; let change;
    const q = {
      select() { return q; }, eq(key,value) { conditions.push([key,value]); return q; },
      update(value) { change=value; return q; },
      async maybeSingle() {
        if (conditions.some(([key,value]) => row[key] !== value)) return {data:null,error:null};
        if (change) Object.assign(row,change);
        return { data: structuredClone(row), error:null };
      },
    };
    return q;
  }

  const dependencies = {
    'next/server': { NextResponse: { json: (value,options) => Response.json(value,options) } },
    '@/lib/supabase/supabase-server': { getAuthenticatedUser: async() => ({data:{user:buyer?{id:buyer}:null},error:null}) },
    '@/lib/supabase/supabase-admin': { supabaseAdmin: { from } },
    '@/lib/payments/payluk-service': { PaylukService: {
      verifyEscrow: async () => { verified++;return structuredClone(escrow); },
      getCustomerWallet: async () => ({ mainBalance: balance, escrowBalance: 0, currency }),
      fundEscrowFromWallet: async (_buyer,escrowRef,amount,reference) => {
        debits++;
        assert.equal(escrowRef,escrowId);assert.equal(amount,2300);
        assert.equal(reference,'yrdly-wallet-'+TX);
        if (fundBeforeThrow) { escrow.status = 'ONGOING';escrow.state = 'OPENED'; }
        if (uncertain) throw new Error('Network timeout after submit');
        escrow.status='ONGOING';escrow.state='OPENED';
      },
    } },
    '@/lib/payments/payluk-onboarding': { getPaylukCustomerId: async () => 'buyer-payluk-id' },
    '@/lib/payments/payment-state': { paylukAmountsMatch: (tx,remote) =>
      tx.amount === remote.amount && remote.whoPays === 'seller' && remote.additionalFee === 0 },
    '@/lib/payments/checkout-reservation-expiry': { reservationHasExpired: () => expired },
    '@/lib/payments/escrow-payment': { applyEscrowPayment: async () => { applied++;row.status='paid';return true; } },
    '@/lib/payments/payment-reconciliation': { flagPayment: async () => { flags++; } },
  };
  const module = { exports: {} };
  const source = fs.readFileSync('src/app/api/payment/pay-with-wallet/route.ts','utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','process',compiled)((name)=>{
    if (!(name in dependencies)) throw Error('Unexpected dependency '+name);
    return dependencies[name];
  },module,module.exports,{ env: { PAYLUK_WALLET_RECOVERY_ENABLED: 'true' } });
  const invoke = () => module.exports.POST(new Request('https://qa.invalid/api/payment/pay-with-wallet',{
    method:'POST',body:JSON.stringify({transactionId:TX}),
  }));
  return { invoke, row, escrow, counters: () => ({debits,applied,flags,verified}) };
}

test('wallet checkout funds exactly the owned escrow once from existing balance',async()=>{
  const h=setup();
  const res=await h.invoke();
  assert.equal(res.status,200);
  assert.equal((await res.json()).success,true);
  assert.equal(h.counters().debits,1);
  assert.equal(h.counters().applied,1);
  const replay=await h.invoke();
  assert.equal(replay.status,200);
  assert.equal(h.counters().debits,1);
});

test('another user cannot spend buyer wallet',async()=>{
  const h=setup({buyer:'another-buyer'});
  const res=await h.invoke();
  assert.equal(res.status,404);
  assert.equal(h.counters().debits,0);
  assert.equal(h.counters().verified,0);
});

test('Payluk Nigerian wallet country code NG is accepted for NGN balance',async()=>{
  const h=setup({currency:'NG'});
  const res=await h.invoke();
  assert.equal(res.status,200);
  assert.equal(h.counters().debits,1);
  assert.equal(h.counters().applied,1);
});

test('non-Nigerian wallet currency cannot be charged',async()=>{
  const h=setup({currency:'USD'});
  const res=await h.invoke();
  assert.equal(res.status,409);
  assert.equal(h.counters().debits,0);
});

test('insufficient deposited wallet balance cannot charge or change the order',async()=>{
  const h=setup({balance:2299});
  const res=await h.invoke();
  assert.equal(res.status,409);
  assert.equal(h.counters().debits,0);
  assert.equal(h.row.status,'pending');
});

test('wrong escrow economics blocks buyer debit',async()=>{
  const h=setup({wrongAmount:true});
  assert.equal((await h.invoke()).status,409);
  assert.equal(h.counters().debits,0);
  assert.equal(h.counters().flags,1);
});

test('cancelled escrow is never silently marked paid or charged',async()=>{
  const h=setup({status:'cancelled'});
  assert.equal((await h.invoke()).status,409);
  assert.equal(h.counters().debits,0);
});

test('expired checkout must return for new escrow instead of funding an invalid link',async()=>{
  const h=setup({expired:true});
  assert.equal((await h.invoke()).status,409);
  assert.equal(h.counters().debits,0);
});

test('uncertain debit remains locked; second attempt never re-submits',async()=>{
  const h=setup({uncertain:true});
  const response=await h.invoke();
  assert.equal(response.status,202);
  assert.equal(h.row.status,'reconciling');
  assert.equal(h.counters().debits,1);
  assert.equal((await h.invoke()).status,409);
  assert.equal(h.counters().debits,1);
  assert.ok(h.counters().flags>0);
});

test('network timeout after successful provider debit is verified before reporting success',async()=>{
  const h=setup({uncertain:true,fundBeforeThrow:true});
  assert.equal((await h.invoke()).status,200);
  assert.equal(h.counters().debits,1);
  assert.equal(h.counters().applied,1);
});

test('reservation period spans multiple Payluk reconciliation cycles',()=>{
  const expiry=fs.readFileSync('src/lib/payments/checkout-reservation-expiry.ts','utf8');
  const migration=fs.readFileSync('supabase/migrations/20261111092106_extend_marketplace_checkout_reconciliation.sql','utf8');
  assert.match(expiry,/CHECKOUT_RESERVATION_TTL_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(migration,/lifetime := interval '2 hours'/);
  assert.match(migration,/lifetime := interval '10 minutes'/);
});
