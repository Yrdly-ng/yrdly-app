const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');

async function fixture(outcome, debit=1176) {
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean,payluk_customer_id text);
 CREATE TABLE payout_requests(id uuid PRIMARY KEY,seller_id uuid,amount numeric,status text,execution_stage text,payment_provider text,transaction_reference text,requested_at timestamptz,processed_at timestamptz,failure_reason text);
 CREATE TABLE notifications(user_id uuid,type text,title text,message text,related_id uuid,related_type text,is_read boolean,data jsonb);
 INSERT INTO users VALUES('00000000-0000-4000-8000-000000000001',false,'customer');
 INSERT INTO payout_requests VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',1176,'processing','submitted','payluk','reference',now()-interval '1 hour',null,null);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261022163313_reconcile_delayed_manual_withdrawals.sql','utf8'));
 let historyReads=0;
 const admin={async rpc(name,args={}) {const values=Object.values(args);const q=await db.query(`SELECT ${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,values);return {data:q.rows[0].value};},from(table){
  let payload, filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},single(){return q},update(v){payload=v;return q},async then(resolve,reject){try{
   if(table==='users')return resolve({data:{payluk_customer_id:'customer'}});
   const values=[];const bind=v=>(values.push(v),'$'+values.length);
   const set=Object.entries(payload).map(([k,v])=>k+'='+bind(v)).join(',');
   const where=filters.map(([k,v])=>k+'='+bind(v)).join(' AND ');
   const result=await db.query(`UPDATE payout_requests SET ${set} WHERE ${where} RETURNING id`,values);resolve({data:result.rows});
  }catch(e){reject(e)}}};return q;
 }};
 const code=ts.transpileModule(fs.readFileSync('src/lib/payments/withdrawal-reconciliation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,Date,require(name){
  if(name.includes('supabase-admin'))return {supabaseAdmin:admin};
  if(name==='./payluk-service')return {PaylukService:{async getWithdrawalDetails(customer,ref){assert.equal(customer,'customer');assert.equal(ref,'reference');historyReads++;if(outcome==='error')throw Error('network');return {outcome,debit};}}};
  throw Error('Unexpected dependency '+name);
 }});
 return {db,run:module.exports.reconcileDelayedWithdrawal,reads:()=>historyReads,close:()=>db.close()};
}
test('missing history stays held, escalates once, and subsequent checks are paced',async()=>{
 const h=await fixture('pending');try{
  assert.equal(await h.run(),'pending-review');assert.equal(await h.run(),'idle');assert.equal(h.reads(),1);
  assert.equal((await h.db.query('SELECT status FROM payout_requests')).rows[0].status,'processing');
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,1);
  await h.db.exec("UPDATE payout_requests SET reconciliation_due_at=now()-interval '1 minute'");await h.run();
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,1);
 }finally{await h.close()}
});
for(const outcome of ['success','failed','error'])test('read-only reconciliation handles '+outcome,async()=>{
 const h=await fixture(outcome);try{await h.run();assert.equal(h.reads(),1);assert.equal((await h.db.query('SELECT status FROM payout_requests')).rows[0].status,{success:'completed',failed:'failed',error:'processing'}[outcome]);}finally{await h.close()}
});
test('untrusted provider debit never completes or releases a withdrawal',async()=>{
 const h=await fixture('success',2000);try{await h.run();assert.equal((await h.db.query('SELECT status FROM payout_requests')).rows[0].status,'processing');}finally{await h.close()}
});
test('manual reference change prevents stale reconciliation and private RPCs reject clients',async()=>{
 const h=await fixture('pending');try{
  await h.db.exec("UPDATE payout_requests SET transaction_reference='changed'");
  assert.equal((await h.db.query("SELECT alert_delayed_withdrawal('00000000-0000-4000-8000-000000000002','reference') AS alerted")).rows[0].alerted,false);
  assert.equal((await h.db.query("SELECT has_function_privilege('anon','claim_delayed_withdrawal_check()','EXECUTE') AS allowed")).rows[0].allowed,false);
 }finally{await h.close()}
});
