/**
 * Resume and verify ONE previously-approved Payluk QA event payout.
 * Executed only inside the isolated QA Vercel preview build.
 * This script never sees production DB credentials, endpoints or bank accounts.
 * Deployment mode defaults to inspect. Advance requires an explicit staged
 * environment switch and will never re-submit an uncertain transfer.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const localRequire = createRequire(import.meta.url);
const QA_PROJECT = 'jxgpvvehajxegeeozlnl';
const EVENT = 'd1083e8a-544e-47e2-b585-5777a56afef7';
const ORGANIZER = '0ff3988f-5caa-4ea7-b618-4f5c5aa18ea1';
const WITHDRAWAL = '4dfad4c5-8e2e-4cd4-ba12-2b43cbd24ccc';
const ORDER = 'cd0ab635-df12-470d-aeca-c1e5bdfee07b';
const REFERENCE = 'evt-plk-55b25848-06b8-4829-9369-dc4ca56a286b';
const MODE = process.env.QA_EVENT_PAYOUT_MODE || 'inspect';
if (process.env.VERCEL_GIT_COMMIT_REF !== 'feature/streamlined-onboarding-nov-2026') {
  console.log('SKIP: isolated Payluk event-payout QA only');
  process.exit(0);
}
assert.equal(process.env.VERCEL_ENV,'preview','Production payout QA is prohibited');
assert.equal(process.env.QA_ENVIRONMENT,'staging');
assert.equal(process.env.QA_EXPECTED_PROJECT_REF,QA_PROJECT);
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,`https://${QA_PROJECT}.supabase.co`);
assert.ok(process.env.QA_EVENT_PAYOUT_BRIDGE_TOKEN && process.env.QA_EVENT_PAYOUT_BRIDGE_TOKEN.length > 45,'Ephemeral QA bridge authentication is required');
assert.ok(process.env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'),'Test Payluk credentials only');
assert.equal(process.env.PAYLUK_BASE_URL,'https://staging.api.payluk.ng');
assert.ok(['inspect','advance'].includes(MODE),'Invalid payout QA mode');
if (MODE === 'advance') {
  for (const key of ['PAYLUK_EVENT_NATIVE_COMMISSION_CONFIRMED','PAYLUK_EVENT_FINANCE_ENABLED','PAYLUK_EVENT_WITHDRAWALS_ENABLED']) {
    assert.equal(process.env[key],'true',`Staging payout gate not enabled: ${key}`);
  }
  assert.notEqual(process.env.PAYLUK_EVENT_LIVE_APPROVED,'true');
}

const qaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const restrictedBridge = qaUrl + '/functions/v1/yrdly-qa-payout-bridge-20261111';
const bridgeFetch = async (input, options={}) => {
  const inputUrl = new URL(typeof input === 'string' ? input : input.url || input.toString());
  if(inputUrl.origin !== qaUrl || !inputUrl.pathname.startsWith('/rest/v1/')){
    throw Error('QA bridge cannot access non-staging database endpoints');
  }
  const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
  const response = await fetch(restrictedBridge,{
    method:'POST',
    headers:{'content-type':'application/json','x-yrdly-qa-token':process.env.QA_EVENT_PAYOUT_BRIDGE_TOKEN},
    body:JSON.stringify({method:options.method||'GET',path:inputUrl.pathname+inputUrl.search,
      headers,body:typeof options.body==='string'?options.body:null}),
    redirect:'error',signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) console.log('QA BRIDGE HTTP ERROR', JSON.stringify({status:response.status,path:inputUrl.pathname,method:options.method||'GET',body:(await response.clone().text()).slice(0,250)}));
  return response;
};
const db = createClient(qaUrl,'qa-temporary-read-write-bridge',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:bridgeFetch}
});
function ok(result, name) {
  if (result.error) throw Error(name+': '+JSON.stringify({code:result.error.code||null, name:result.error.name||null, message:String(result.error.message||'').slice(0,220)}));
  return result.data;
}
function moduleTS(file, deps={}) {
  const src=fs.readFileSync(file,'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',js)((name)=>{
    if (Object.prototype.hasOwnProperty.call(deps,name)) return deps[name];
    if (name==='node:crypto') return localRequire(name);
    if (name==='server-only') return {};
    throw Error('Unexpected QA module import: '+name);
  },mod,mod.exports);
  return mod.exports;
}
const rate = moduleTS('src/lib/payments/payluk-rate-limit.ts');
const state = moduleTS('src/lib/payments/payment-state.ts');
const getPaylukCustomerId=async(id)=>{
  assert.equal(id,ORGANIZER,'Unrecognized organizer identity');
  const user=ok(await db.from('users').select('payluk_customer_id,phone_verified').eq('id',id).single(),'QA organizer identity');
  assert.equal(user.phone_verified,true);
  assert.ok(user.payluk_customer_id);
  return user.payluk_customer_id;
};
const service=moduleTS('src/lib/payments/payluk-service.ts',{
  './payluk-rate-limit':rate,
  './payment-state':state,
  './payluk-onboarding':{getPaylukCustomerId}
}).PaylukService;
const config=moduleTS('src/lib/events/payluk-event-finance-config.ts');
const finance=moduleTS('src/lib/events/payluk-event-finance.ts',{
  '@/lib/supabase/supabase-admin':{supabaseAdmin:db},
  '@/lib/payments/payluk-service':{PaylukService:service},
  '@/lib/payments/payluk-onboarding':{getPaylukCustomerId},
  '@/lib/payments/payment-state':state,
  './event-finance-error':moduleTS('src/lib/events/event-finance-error.ts'),
  './payluk-event-finance-config':config
});
const provider=async()=>service.verifyEscrow('PY_Cu6GzdTQ1807');
const reads=async()=>{
  const row=ok(await db.from('payluk_event_withdrawals').select('*').eq('id',WITHDRAWAL).single(),'QA payout');
  const alloc=ok(await db.from('payluk_event_allocations').select('*').eq('withdrawal_id',WITHDRAWAL).single(),'QA allocation');
  const tx=ok(await db.from('escrow_transactions').select('id,item_type,payment_provider,payluk_tx_ref,payluk_escrow_id,status,amount,commission,seller_amount,metadata').eq('id',ORDER).single(),'QA ticket purchase');
  const event=ok(await db.from('events').select('id,title,status,end_time,organizer_id').eq('id',EVENT).single(),'QA event');
  const bank=ok(await db.from('seller_accounts').select('account_details,is_primary,is_active,verification_status').eq('user_id',ORGANIZER).eq('is_primary',true).single(),'QA bank');
  return {row,alloc,tx,event,bank};
};
let {row,alloc,tx,event,bank}=await reads();
assert.equal(row.event_id,EVENT);
assert.equal(row.organizer_id,ORGANIZER);
assert.equal(row.reference,REFERENCE);
assert.equal(row.domain,'test');
assert.equal(Number(row.amount_kobo),114000);
assert.equal(alloc.transaction_id,ORDER);
assert.equal(Number(alloc.amount_kobo),114000);
assert.equal(tx.payluk_tx_ref,'PY_Cu6GzdTQ1807');
assert.equal(tx.item_type,'ticket');
assert.equal(tx.payment_provider,'payluk');
assert.equal(tx.metadata?.payluk_environment,'test');
assert.equal(tx.metadata?.payluk_fee_mode,'native_commission_v1');
assert.equal(tx.metadata?.event_id,EVENT);
assert.equal(tx.payluk_escrow_id,'6ae8a9af39214a67094f24e8');
assert.equal(Number(tx.seller_amount),1140);
assert.equal(event.organizer_id,ORGANIZER);
assert.equal(event.status,'PUBLISHED');
assert.ok(Date.parse(event.end_time)+86400000 <= Date.now(),'Event 24h hold not satisfied');
assert.equal(bank.is_primary,true);
assert.equal(bank.is_active,true);
assert.equal(bank.verification_status,'verified');
assert.equal(bank.account_details.bank_name || bank.account_details.bankName,'Payluk Provider Test Bank');
assert.equal((bank.account_details.account_number || bank.account_details.accountNumber || '').slice(-4),'6789');
assert.equal(row.account_last_four,'6789');
assert.equal(row.bank_name,'Payluk Provider Test Bank');
assert.ok(!row.processing_token || !row.processing_until || Date.parse(row.processing_until)<Date.now(),'Current payout worker lease active');
const customer=await getPaylukCustomerId(ORGANIZER);
const buyer=await service.getCustomerById(customer);
assert.equal(buyer.customerId,customer,'QA merchant customer identity mismatch');
let escrow=await provider();
assert.equal(escrow.environment,'test');
assert.equal(escrow.id,tx.payluk_escrow_id);
assert.ok(state.paylukAmountsMatch(tx,escrow),'Provider principal / mode / merchant mismatched');
assert.equal(Math.round((Number(escrow.amount)-Number(escrow.fee))*100),114000,'Provider net proceeds do not match reserved payout');
const claimedAt=finance.paylukEventClaimAvailableAt(escrow);
console.log('QA PRECHECK:',JSON.stringify({
  mode:MODE,withdrawalStatus:row.status,releaseStatus:alloc.release_status,
  providerEscrow:escrow.status,providerEscrowState:escrow.state,
  claimNotBefore:claimedAt ? new Date(claimedAt).toISOString() : null,
  claimEligible:claimedAt!==null&&claimedAt<=Date.now(),
  bankKind:'Payluk Provider Test Bank',amountNaira:1140,
  providerReferencePresent:!!row.provider_reference,transferStarted:!!row.transfer_started_at
}));
if (MODE==='inspect') { const wallet=await service.getCustomerWallet(customer); const banks=await service.getBankList(); const bankCode=bank.account_details.bank_code||bank.account_details.bankCode; const match=Array.isArray(banks)?banks.find(b=>b.code===bankCode):null; console.log('QA WALLET/BANK:',JSON.stringify({mainBalance:wallet.mainBalance,escrowBalance:wallet.escrowBalance,withdrawalAmount:1140,bankListValid:Array.isArray(banks),bankCodeMatched:!!match,bankActive:match?.active,bankDeleted:match?.is_deleted})); process.exit(0); }
assert.equal(config.paylukEventEnvironment(),'test');
assert.equal(config.paylukEventWithdrawalsEnabled(),true);
assert.ok(claimedAt!==null,'Cannot infer provider claim eligibility');
if (escrow.status==='ONGOING' && claimedAt>Date.now()) {
  console.log('QA HELD: provider claim window has not matured; not forcing a payment release');
  process.exit(0);
}
if (row.status==='review') {
  console.log('QA HELD: withdrawal is in manual review; no automatic retries');
  process.exit(0);
}
// Process bounded, CAS-protected transitions through REAL YRDLY application code.
for(let attempt=1;attempt<=4;attempt++){
  ({row,alloc}=await reads());
  if(row.status==='review'||row.status==='success') break;
  if(row.status==='reserved' && row.next_attempt_at && Date.parse(row.next_attempt_at)>Date.now()) break;
  if(row.status==='reserved' && !!row.transfer_started_at && !row.provider_reference){
    console.log('QA HELD: unknown transfer submission boundary, no retry');
    break;
  }
  const pre=[row.status,alloc.release_status,row.provider_reference,row.transfer_started_at,row.next_attempt_at].join('|');
  await finance.advancePaylukEventWithdrawal(REFERENCE,ORGANIZER,EVENT);
  ({row,alloc}=await reads());
  console.log('QA STEP:',JSON.stringify({attempt,status:row.status,releaseStatus:alloc.release_status,
    providerReferencePresent:!!row.provider_reference,transferStarted:!!row.transfer_started_at,
    expectedDebitKobo:row.expected_debit_kobo,actualDebitKobo:row.actual_debit_kobo,
    nextAttemptAt:row.next_attempt_at}));
  const post=[row.status,alloc.release_status,row.provider_reference,row.transfer_started_at,row.next_attempt_at].join('|');
  if(pre===post)break;
}
({row,alloc}=await reads());
escrow=await provider();
if (alloc.release_status!=='released'||!['COMPLETED','CLAIMED'].includes(escrow.status)||
    escrow.state!=='CLOSED') {
  console.log('QA NOT COMPLETE: escrow release is not confirmed',JSON.stringify({status:row.status,release:alloc.release_status,escrow:escrow.status}));
  process.exitCode=2;
} else if(row.status==='success'){
  assert.ok(row.provider_reference);
  assert.ok(Number(row.expected_debit_kobo)>0&&Number(row.expected_debit_kobo)<=114000);
  assert.equal(Number(row.actual_debit_kobo),Number(row.expected_debit_kobo));
  const remote=await service.getWithdrawalDetails(customer,row.provider_reference);
  assert.equal(remote.outcome,'success','Provider bank transfer not independently confirmed');
  assert.equal(Math.round(Number(remote.debit)*100),Number(row.expected_debit_kobo));
  console.log('QA PASS: Payluk TEST escrow released and bank withdrawal confirmed; no live money involved');
} else {
  console.log('QA AWAITING / REVIEW:',JSON.stringify({status:row.status,escrow:escrow.status,release:alloc.release_status,providerReferencePresent:!!row.provider_reference}));
  process.exitCode=2;
}
