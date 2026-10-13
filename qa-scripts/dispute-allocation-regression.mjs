// Real QA database operations; the synthetic references never reach Payluk.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, readOutput, createAdminClient, QA_PREFIX } from './qa-common.mjs';

const {env,projectRef}=await readQaEnv();
const seed=await readOutput(), admin=createAdminClient(env), fixtures=[],results=[];
await mkdir('.qa-artifacts',{recursive:true});
const ok=r=>{if(r.error)throw Error(`QA database operation failed: ${r.error.code} ${r.error.message}`);return r.data;};
const check=async(name,run)=>{await run();results.push({name,passed:true});console.log(`PASS ${name}`);};
async function fixture() {
  const f={post:randomUUID(),tx:randomUUID(),dispute:randomUUID()};fixtures.push(f);
  ok(await admin.from('posts').insert({id:f.post,user_id:seed.users.seller,author_name:QA_PREFIX,author_image:'',category:'For Sale',title:`${QA_PREFIX} database-only split`,text:QA_PREFIX,price:2500,is_sold:false,moderation_status:'approved'}));
  ok(await admin.from('escrow_transactions').insert({id:f.tx,buyer_id:seed.users.buyer,seller_id:seed.users.seller,item_id:f.post,item_type:'post',amount:2500,commission:75,total_amount:2575,seller_amount:2450,status:'disputed',payment_method:'card',delivery_details:{},payment_provider:'payluk',payluk_escrow_id:`qa-database-${f.tx}`,metadata:{payluk_fee_mode:'buyer_commission_v1'}}));
  ok(await admin.from('posts').update({is_sold:true,transaction_id:f.tx,sold_to_user_id:seed.users.buyer,sold_at:new Date().toISOString()}).eq('id',f.post));
  ok(await admin.from('disputes').insert({id:f.dispute,transaction_id:f.tx,opened_by:seed.users.buyer,dispute_reason:QA_PREFIX,provider_submission_status:'submitted',provider_seller_reply_status:'submitted'}));
  return f;
}
const begin=(f,buyer=1250,seller=1250,actor=seed.users.admin)=>admin.rpc('begin_dispute_resolution',{p_dispute_id:f.dispute,p_admin_id:actor,p_resolution:QA_PREFIX,p_refund_amount:buyer,p_seller_amount:seller});
const planFor=(f,status='SPLIT')=>({escrowId:`qa-database-${f.tx}`,status,principal:2500,fee:50,whoPays:'seller',additionalFee:75,additionalFeeRefundable:status!=='COMPLETED',pool:2450,buyerAmount:status==='REFUNDED'?2450:1225,sellerAmount:status==='REFUNDED'?0:1225});
const save=(operation,plan)=>admin.rpc('save_payluk_dispute_plan',{p_operation_id:operation,p_plan:plan});
const apply=(f,plan)=>admin.rpc('apply_payluk_dispute_settlement',{p_transaction_id:f.tx,p_settlement:plan});
try {
  for(const role of ['buyer','seller','admin'])assert.equal(ok(await admin.auth.admin.getUserById(seed.users[role])).user.user_metadata.qa_prefix,QA_PREFIX);
  const f=await fixture();let operation;
  await check('dispute ruling rejects non-admin and sub-kobo allocations',async()=>{
    assert.equal((await begin(f,1250,1250,seed.users.seller)).error?.code,'42501');
    assert.equal((await begin(f,1250.001,1249.999)).error?.code,'22023');
  });
  await check('concurrent dispute rulings claim one immutable operation',async()=>{
    const rows=await Promise.all([begin(f),begin(f)]);rows.forEach(ok);
    assert.equal(rows.filter(r=>r.data.newly_created).length,1);assert.equal(rows[0].data.operation.id,rows[1].data.operation.id);operation=rows[0].data.operation.id;
  });
  const plan=planFor(f);
  await check('gross split cannot be sent as the fee-adjusted pool',async()=>{
    assert.ok((await save(operation,{...plan,buyerAmount:1250,sellerAmount:1250,pool:2500})).error);
    assert.ok((await admin.rpc('finish_dispute_resolution',{p_operation_id:operation})).error,'Unverified provider outcome must not credit earnings');
    assert.deepEqual(ok(await save(operation,plan)),plan);
  });
  await check('saved provider allocation cannot change on retry',async()=>{
    assert.ok((await save(operation,{...plan,fee:100,pool:2400,buyerAmount:1200,sellerAmount:1200})).error);
  });
  await check('mismatched signed/provider allocation leaves the dispute held',async()=>{
    assert.ok((await apply(f,{...plan,buyerAmount:1224,sellerAmount:1226})).error);
    assert.equal(ok(await admin.from('escrow_transactions').select('status').eq('id',f.tx).single()).status,'disputed');
  });
  await check('verified settlement reconciles timeout and concurrent replays exactly once',async()=>{
    ok(await admin.rpc('flag_dispute_resolution_reconciliation',{p_operation_id:operation,p_error_message:'QA simulated timeout'}));
    const rows=await Promise.all([apply(f,plan),apply(f,plan)]);rows.forEach(r=>assert.equal(ok(r),true));
    const tx=ok(await admin.from('escrow_transactions').select('status,seller_amount').eq('id',f.tx).single());
    assert.equal(tx.status,'completed');assert.equal(Number(tx.seller_amount),1225);
  });
  await check('gross ruling and actual buyer/seller credits remain distinguishable',async()=>{
    const d=ok(await admin.from('disputes').select('refund_amount,seller_amount,provider_settlement').eq('id',f.dispute).single());
    assert.equal(Number(d.refund_amount),1250);assert.equal(Number(d.seller_amount),1250);
    assert.equal(d.provider_settlement.buyerCredit,1300);assert.equal(d.provider_settlement.sellerAmount,1225);
    assert.equal(ok(await admin.from('posts').select('is_sold').eq('id',f.post).single()).is_sold,true);
  });
  await check('full refund records zero seller proceeds and restores the listing once',async()=>{
    const full=await fixture(), op=ok(await begin(full,2500,0)).operation.id,p=planFor(full,'REFUNDED');
    ok(await save(op,p));ok(await apply(full,p));ok(await apply(full,p));
    const row=ok(await admin.from('escrow_transactions').select('status,seller_amount').eq('id',full.tx).single());
    assert.equal(row.status,'cancelled');assert.equal(Number(row.seller_amount),0);
    assert.equal(ok(await admin.from('posts').select('is_sold').eq('id',full.post).single()).is_sold,false);
  });
  await check('anonymous callers cannot plan or apply financial settlement',async()=>{
    const client=createClient(env.SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
    assert.equal((await client.rpc('save_payluk_dispute_plan',{p_operation_id:operation,p_plan:plan})).error?.code,'42501');
    assert.equal((await client.rpc('apply_payluk_dispute_settlement',{p_transaction_id:f.tx,p_settlement:plan})).error?.code,'42501');
  });
} finally {
  for(const f of fixtures) {
    ok(await admin.from('dispute_resolution_operations').delete().eq('dispute_id',f.dispute));
    ok(await admin.from('disputes').delete().eq('id',f.dispute));
    ok(await admin.from('posts').update({transaction_id:null,is_sold:false,sold_to_user_id:null,sold_at:null}).eq('id',f.post));
    ok(await admin.from('escrow_transactions').delete().eq('id',f.tx));
    ok(await admin.from('posts').delete().eq('id',f.post));
  }
  await writeFile('.qa-artifacts/dispute-allocation-regression.json',JSON.stringify({projectRef,checkedAt:new Date().toISOString(),results},null,2),{mode:0o600});
}
