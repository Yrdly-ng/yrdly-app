/**
 * Payluk staging-only integration smoke test.
 * The user authorised a funded SANDBOX test, never a live customer debit.
 *
 * This script is enabled only for the isolated QA preview ref, with Payluk
 * sk_test credentials and the allowlisted Supabase QA project. It never uses
 * a real bank or a production database.
 */
import { randomUUID, randomInt } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const QA_REF = 'jxgpvvehajxegeeozlnl';
const qaCommit = process.env.VERCEL_GIT_COMMIT_REF === 'feature/streamlined-onboarding-nov-2026';
if (!qaCommit) {
  console.log('SKIP: funded Payluk smoke test is restricted to the QA preview ref');
  process.exit(0);
}
if (process.env.VERCEL_ENV !== 'preview'
    || process.env.QA_ENVIRONMENT !== 'staging'
    || process.env.QA_EXPECTED_PROJECT_REF !== QA_REF
    || !new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.test').hostname.startsWith(QA_REF + '.')
    || !process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_')
    || !process.env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY?.startsWith('pk_test_')
    || process.env.PAYLUK_BASE_URL !== 'https://staging.api.payluk.ng') {
  throw new Error('Refusing funded QA: expected isolated Supabase/Payluk staging setup');
}

const api = 'https://staging.api.payluk.ng';
const secret = process.env.PAYLUK_SECRET_KEY;
async function request(method, path, { customerId, body, form } = {}) {
  const headers = { Authorization: 'Bearer ' + secret };
  if (customerId) headers['customer-id'] = customerId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(api + path, {
    method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(15000), redirect:'error',
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw Error('Provider returned a non-JSON response: HTTP ' + response.status); }
  // Never log customer, tokens, response bodies, or any credential.
  if (!response.ok || payload.status === false) {
    throw Error('Payluk staging ' + method + ' ' + path.split('?')[0].replace(/\/[a-f0-9]{24}/g,'/<id>') + ' failed: HTTP ' + response.status + ' (' + String(payload.message || 'unknown').slice(0,100) + ')');
  }
  return payload.data;
}
const unique = randomUUID();
const phone = () => '08000' + String(randomInt(1000000)).padStart(6,'0');
const create = async (role) => {
  const c = await request('POST','/v1/customer/create', {
    body: {firstname:'YRDLY',lastname:'QA '+role,
      email:'yrdly.qa.wallet.' + role + '.' + randomUUID() + '@example.test',
      phone:phone()},
  });
  assert.ok(c?.customerId, role + ' Payluk customer creation failed');
  await request('PUT','/v1/customer/permissions/' + encodeURIComponent(c.customerId),{
    body:role==='buyer'?{canBuy:true}:{canSell:true}
  });
  return c.customerId;
};
const seller = await create('seller');
const buyer = await create('buyer');
const form = new FormData();
form.append('amount','2300');
form.append('purpose','YRDLY-QA-wallet-recovery-' + unique);
form.append('whoPays','seller');
form.append('maxDelivery','1');
form.append('deliveryTimeline','days');
form.append('totalQuantity','1');
const draft = await request('POST','/v1/escrow/create',{customerId:seller,form});
assert.ok(draft?.id && draft?.paymentToken, 'Test escrow not created');
assert.equal(draft.status, 'PENDING');
assert.equal(draft.state, 'AWAITING_PAYMENT');
assert.equal(Number(draft.amount),2300);
const wallet = async () => {
  const b=await request('GET','/v1/wallet',{customerId:buyer});
  const bal=Number(b?.mainBalance ?? b?.availableBalance ?? b?.wallet?.mainBalance);
  assert.ok(Number.isFinite(bal), 'No numeric wallet balance');
  return bal;
};
const before = await wallet();
// Staging-only helper. Never invokes a real bank or payment service.
await request('POST','/v1/payment/topup',{customerId:buyer,body:{amount:2300}});
const credited = await wallet();
assert.ok(credited >= before + 2300 - 0.01, 'Sandbox wallet topup did not credit the full amount');
// Exercise the ACTUAL application API route with provider-backed sandbox calls.
 // Only auth/database dependencies are synthetic, with no production Supabase connection.
const buyerId = randomUUID(),txId = randomUUID();
const txRecord = {
  id:txId,buyer_id:buyerId,seller_id:randomUUID(),item_type:'catalog_item',
  status:'pending',payment_provider:'payluk',payluk_escrow_id:draft.id,
  payluk_tx_ref:draft.paymentToken,amount:2300,total_amount:2300,commission:69,
  created_at:new Date().toISOString(),metadata:{payluk_fee_mode:'native_commission_v1'}
};
const records = { row:txRecord, applied:0, flags:0, fundingCalls:0, authId:'unauthorized' };
const from = (table)=>{
  assert.equal(table,'escrow_transactions');
  const conditions=[];let mutation=null;
  const query={
    select(){return query;},
    eq(k,v){conditions.push([k,v]);return query;},
    update(value){mutation=value;return query;},
    async maybeSingle(){
      if(conditions.some(([k,v])=>records.row[k]!==v))return {data:null,error:null};
      if(mutation)Object.assign(records.row,mutation);
      return {data:structuredClone(records.row),error:null};
    }
  };
  return query;
};
const dependencies={
  'next/server': { NextResponse:{json:(body,options)=>Response.json(body,options)} },
  '@/lib/supabase/supabase-server': {
    getAuthenticatedUser:async()=>({data:{user:{id:records.authId}},error:null})
  },
  '@/lib/supabase/supabase-admin': {supabaseAdmin:{from}},
  '@/lib/payments/payluk-service': {PaylukService:{
    verifyEscrow:async(token)=>request('GET','/v1/escrow/verify/'+encodeURIComponent(token)),
    getCustomerWallet:async(id)=>{
      assert.equal(id,buyer);
      const w=await request('GET','/v1/wallet',{customerId:id});
      const mainBal=w.mainBalance ?? w.availableBalance ?? w.wallet?.mainBalance ?? w.main_balance ?? w.available_balance ?? w.balance ?? 0;
      const received = {mainBalance:Number(mainBal),escrowBalance:Number(w.escrowBalance ?? w.wallet?.escrowBalance ?? w.escrow_balance ?? 0),currency:w.currency||'NGN'};
      console.log('QA wallet check:',{currency:received.currency,amountSufficient:received.mainBalance>=2300,isFinite:Number.isFinite(received.mainBalance),hasCurrencyField:w.currency!==undefined,accountCreditedEarlier:credited>=2300});
      return received;
    },
    fundEscrowFromWallet:async(customerId,escrowId,amount,reference)=>{
      assert.equal(customerId,buyer);assert.equal(escrowId,draft.id);
      assert.equal(amount,2300);assert.equal(reference,'yrdly-wallet-'+txId);
      records.fundingCalls++;
      return request('POST','/v1/payment/escrow',{
        customerId,
        body:{amount,reference,transactionType:'escrow',gateway:'wallet',
          escrowDetails:{escrowId}}
      });
    }
  }},
  '@/lib/payments/payluk-onboarding':{getPaylukCustomerId:async(userId)=>{
    assert.equal(userId,buyerId);return buyer;
  }},
  '@/lib/payments/payment-state':{paylukAmountsMatch:(tx,escrow)=>
    Math.round(Number(tx.amount)*100)===Math.round(Number(escrow.amount)*100) &&
    escrow.whoPays==='seller'&&Number(escrow.additionalFee??0)===0},
  '@/lib/payments/checkout-reservation-expiry':{reservationHasExpired:()=>false},
  '@/lib/payments/escrow-payment':{applyEscrowPayment:async()=>{records.applied++;records.row.status='paid';return true;}},
  '@/lib/payments/payment-reconciliation':{flagPayment:async()=>{records.flags++;}}
};
const source=await readFile('src/app/api/payment/pay-with-wallet/route.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleHolder={exports:{}};
new Function('require','module','exports','process',compiled)((name)=>{
  assert.ok(Object.prototype.hasOwnProperty.call(dependencies,name),'Unexpected dependency '+name);
  return dependencies[name];
},moduleHolder,moduleHolder.exports,{env:{PAYLUK_WALLET_RECOVERY_ENABLED:'true'}});
const run=(id)=>moduleHolder.exports.POST(new Request('https://qa.invalid/api/payment/pay-with-wallet',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactionId:id})
}));
const unauthorized=await run(txId);
assert.equal(unauthorized.status,404,'Wrong buyer must never access wallet recovery');
assert.equal(records.fundingCalls,0,'Wrong buyer caused a provider charge');
records.authId=buyerId;
const paid=await run(txId);
const paidBody=await paid.json();
if(paid.status!==200) {
  // Report only high-level diagnostic fields; never wallet details or identities.
  console.error('QA wallet route response:', {status:paid.status, reason:paidBody.error || paidBody.message || 'unknown', flags:records.flags, providerChargeAttempted:records.fundingCalls>0});
}
assert.equal(paid.status,200,'Wallet route did not report confirmed settlement');
assert.equal(paidBody.success,true);
assert.equal(records.row.status,'paid');
assert.equal(records.fundingCalls,1,'Expected exactly one actual Payluk wallet debit');
assert.equal(records.applied,1,'Expected one transaction settlement');
const replay=await run(txId);
assert.equal(replay.status,200);
assert.equal(records.fundingCalls,1,'A second request must not debit the wallet again');
assert.equal(records.flags,0,'Successful wallet test requires no manual review flags');
const after = await wallet();
const funded = await request('GET','/v1/escrow/verify/' + encodeURIComponent(draft.paymentToken));
assert.equal(funded.id,draft.id);
assert.ok(['ONGOING','COMPLETED','CLAIMED'].includes(String(funded.status).toUpperCase()),
  'Provider did not settle the escrow');
assert.ok(after <= credited - 2300 + 0.01, 'Buyer wallet was not debited for escrow purchase');
console.log('PASS Payluk STAGING: full wallet API route integration, authorized settlement, replay protection, and provider wallet debit.');
