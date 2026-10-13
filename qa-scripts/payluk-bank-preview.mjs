// Stages sandbox payout intents only. Never submits /payment/verify or moves money.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { readQaEnv, createAdminClient, updateQaEnv, QA_PREFIX } from './qa-common.mjs';

const { env } = await readQaEnv();
assert.ok(env.PAYLUK_SECRET_KEY?.startsWith('sk_test_'), 'Sandbox credentials required');
for (const key of ['QA_PAYOUT_ACCOUNT_NUMBER','QA_PAYOUT_ACCOUNT_NAME']) assert.ok(env[key], `Missing ${key}`);
const state = { environment: 'sandbox', startedAt: new Date().toISOString(), results: [], responses: [] };
const save = () => writeFile('.qa-artifacts/payluk-bank-preview-private.json', JSON.stringify(state, null, 2), { mode: 0o600 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
async function provider(path, body, customer) {
  assert.ok(path !== '/v1/payment/verify', 'Preview cannot execute a transfer');
  await delay(Math.max(0, 7500 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  const r = await fetch(`https://staging.api.payluk.ng${path}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${env.PAYLUK_SECRET_KEY}`, 'content-type':'application/json', ...(customer ? { 'customer-id': customer } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  const response = await r.json();
  state.responses.push({ path, status: r.status, body: response }); await save();
  if (!r.ok) throw new Error(`Provider preview failed: HTTP ${r.status}`);
  return response.data;
}
async function check(name, run) { await run(); state.results.push({name,passed:true}); await save(); console.log(`PASS payout preview: ${name}`); }
try {
  const completed = JSON.parse(await readFile('.qa-artifacts/payluk-lifecycle-completed.json','utf8'));
  const admin = createAdminClient(env);
  const {data:auth,error:authError} = await admin.auth.admin.getUserById(completed.users.seller);
  assert.equal(authError,null); assert.equal(auth.user.user_metadata.qa_prefix,QA_PREFIX);
  const {data:profile,error:profileError} = await admin.from('users').select('payluk_customer_id').eq('id',auth.user.id).single();
  assert.equal(profileError,null); assert.ok(profile.payluk_customer_id);
  let bank, verifiedName;
  await check('current provider bank list identifies one OPay code',async()=>{
    const banks=await provider('/v1/payment/bank-list');
    const matches=banks.filter(b=>/opay|paycom/i.test(b.name)); assert.equal(matches.length,1);bank=matches[0];
    await updateQaEnv({QA_PAYOUT_BANK_CODE:bank.code});
  });
  await check('controlled beneficiary account resolves to its authorized name',async()=>{
    const result=await provider('/v1/payment/verify-account',{accountNumber:env.QA_PAYOUT_ACCOUNT_NUMBER,bankCode:bank.code},profile.payluk_customer_id);
    const words=s=>s.toLowerCase().replace(/[^a-z ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
    assert.ok(words(env.QA_PAYOUT_ACCOUNT_NAME).split(' ').every(word=>words(result.accountName).split(' ').includes(word)), 'Resolved name must include every authorized name word');
    verifiedName=result.accountName;
    if(result.accountNumber)assert.equal(result.accountNumber,env.QA_PAYOUT_ACCOUNT_NUMBER);
  });
  const intent = amount => provider('/v1/payment/create-intent', {
    amount, reference:`qa-preview-${randomUUID()}`, transactionType:'withdrawal',currency:'NGN',
    withdrawalDetails:{bankCode:bank.code,bankName:bank.name,accountNumber:env.QA_PAYOUT_ACCOUNT_NUMBER,accountName:verifiedName},
  },profile.payluk_customer_id);
  let quote;
  await check('1000-naira debit budget receives an authoritative fee quote without execution',async()=>{
    quote=await intent(1000);assert.equal(quote.amount,1000);assert.ok(Number.isFinite(quote.fee)&&quote.fee>=0);state.quote={amount:quote.amount,fee:quote.fee};
  });
  await check('provider rejects a bank amount below 1000 without execution',async()=>{
    const net=(100000-Math.round(quote.fee*100))/100;
    await assert.rejects(intent(net),/HTTP 400/);
    assert.match(state.responses.at(-1).body.message,/Minimum withdrawal amount is 1000/);
    state.netRejected=true;
  });
  await check('minimum bank amount plus its exact fee fits the debit budget',async()=>{
    const budget=(100000+Math.round(quote.fee*100))/100;
    const budgetQuote=await intent(budget);
    const net=(Math.round(budget*100)-Math.round(budgetQuote.fee*100))/100;
    assert.ok(net>=1000);
    const result=await intent(net);assert.equal(result.amount,net);assert.ok(Math.round((net+result.fee)*100)<=Math.round(budget*100));state.net={budget,amount:net,fee:result.fee};
  });
} catch(error) {
  state.failure = {message:error instanceof Error?error.message:'Preview failed'};
  console.error('Payout preview incomplete; account/provider details saved privately.');process.exitCode=1;
} finally {
  await save();
  await writeFile('.qa-artifacts/payluk-bank-preview-summary.json',JSON.stringify({environment:state.environment,checkedAt:new Date().toISOString(),results:state.results,quote:state.quote,net:state.net,transferExecuted:false},null,2),{mode:0o600});
}
