const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),buyer=id(2),event=id(3),tx=id(4),ticket=id(5);
async function database() {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE users(id uuid PRIMARY KEY);
 CREATE TABLE events(id uuid PRIMARY KEY,organizer_id uuid,end_time timestamptz,status text);
 CREATE TABLE escrow_transactions(id uuid PRIMARY KEY,item_type text,payment_provider text,seller_id uuid,metadata jsonb,status text,seller_amount numeric,payluk_tx_ref text,payluk_escrow_id text);
 CREATE TABLE tickets(id uuid PRIMARY KEY,event_id uuid,payment_provider text,payment_tx_ref text,status text,refund_status text,amount_paid numeric,updated_at timestamptz);
 INSERT INTO users VALUES('${owner}'),('${buyer}');
 INSERT INTO events VALUES('${event}','${owner}',now()-interval '2 days','PUBLISHED');
 INSERT INTO escrow_transactions VALUES('${tx}','ticket','payluk','${owner}',jsonb_build_object('event_id','${event}','quantity',1,'payluk_environment','test','payluk_fee_mode','native_commission_v1','event_release_not_before',now()-interval '1 day'),'paid',2850,'PY_TEST','provider-id');
 INSERT INTO tickets VALUES('${ticket}','${event}','payluk','${tx}','PAID',NULL,3000,now());`);
 await db.exec(fs.readFileSync('supabase/migrations/20261031173533_payluk_event_finance.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261101183741_resumable_payluk_event_withdrawals.sql','utf8')); return db;
}
const withdraw=(db,who=owner)=>db.query('SELECT public.reserve_payluk_event_withdrawal($1,$2,$3,$4,$5,$6) AS result',[event,who,285000,'Bank','Organizer','1234']);
const refund=(db,who=owner)=>db.query('SELECT public.request_payluk_event_refund($1,$2,$3) AS result',[ticket,who,'Event cancelled by organizer']);
test('owner, period, environment and full ticket issuance gate withdrawal',async()=>{
 const db=await database();try{
 await assert.rejects(withdraw(db,buyer),/unavailable/);
 await db.exec("UPDATE events SET end_time=now()-interval '23 hours'"); await assert.rejects(withdraw(db),/unavailable/);
 await db.exec("UPDATE events SET end_time=now()-interval '2 days'; UPDATE escrow_transactions SET metadata=jsonb_set(metadata,'{payluk_environment}','\"live\"')"); await assert.rejects(withdraw(db),/balance_changed/);
 await db.exec("UPDATE escrow_transactions SET metadata=jsonb_set(jsonb_set(metadata,'{payluk_environment}','\"test\"'),'{quantity}','2')"); await assert.rejects(withdraw(db),/balance_changed/);
 await db.exec("UPDATE escrow_transactions SET metadata=jsonb_set(metadata,'{quantity}','1')");
 const row=(await withdraw(db)).rows[0].result;assert.equal(row.amount_kobo,285000);
 await assert.rejects(withdraw(db),/balance_changed/);await assert.rejects(refund(db),/already_reserved/);
 assert.equal((await db.query('SELECT count(*) FROM payluk_event_allocations')).rows[0].count,1);
 }finally{await db.close();}
});
test('refund requests preserve tickets and atomically hold the order; repeats reuse the reason',async()=>{
 const db=await database();try{
 await assert.rejects(refund(db,buyer),/forbidden/);
 const first=(await refund(db)).rows[0].result;const repeat=(await refund(db)).rows[0].result;assert.equal(first.ticket_id,repeat.ticket_id);
 assert.equal((await db.query('SELECT status,refund_status FROM tickets')).rows[0].status,'PAID');
 await assert.rejects(withdraw(db),/financial_hold/);
 const permissions=(await db.query("SELECT has_function_privilege('authenticated','public.reserve_payluk_event_withdrawal(uuid,uuid,bigint,text,text,text)','EXECUTE') AS invoke,has_table_privilege('anon','public.payluk_event_withdrawals','SELECT') AS read")).rows[0]; assert.equal(permissions.invoke,false);assert.equal(permissions.read,false);
 }finally{await db.close();}
});
test('disputes and postponed release snapshots block settlement',async()=>{
 const db=await database();try{
 await db.exec("UPDATE escrow_transactions SET status='disputed'");await assert.rejects(withdraw(db),/financial_hold/);
 await db.exec("UPDATE escrow_transactions SET status='paid',metadata=jsonb_set(metadata,'{event_release_not_before}',to_jsonb((now()+interval '1 day')::text))");await assert.rejects(withdraw(db),/balance_changed/);
 }finally{await db.close();}
});

test('worker leases fence concurrent work, throttle batches, and preserve release checkpoints', async () => {
 const db=await database(); try {
 const row=(await withdraw(db)).rows[0].result;
 const lease=(who,token)=>db.query('SELECT lease_payluk_event_withdrawal($1,$2,$3) AS result',[row.reference,who,token]);
 const checkpoint=(token,status)=>db.query('SELECT checkpoint_payluk_event_release($1,$2,$3,$4) AS result',[row.id,token,tx,status]);
 assert.equal((await lease(buyer,id(20))).rows[0].result,null);
 assert.equal((await lease(owner,id(20))).rows[0].result.status,'submitting');
 assert.equal((await lease(owner,id(21))).rows[0].result,null);
 assert.equal((await checkpoint(id(21),'released')).rows[0].result,false);
 assert.equal((await checkpoint(id(20),'claiming')).rows[0].result,true);
 await db.exec("UPDATE payluk_event_withdrawals SET processing_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second'; UPDATE payluk_event_worker_clock SET next_allowed_at=now()-interval '1 second'");
 assert.equal((await checkpoint(id(20),'released')).rows[0].result,false);
 assert.equal((await lease(owner,id(21))).rows[0].result.status,'submitting');
 assert.equal((await checkpoint(id(21),'released')).rows[0].result,true);
 assert.equal((await db.query('SELECT release_status FROM payluk_event_allocations')).rows[0].release_status,'released');
 assert.equal((await checkpoint(id(21),'claiming')).rows[0].result,false);
 const rights=(await db.query("SELECT has_function_privilege('authenticated','public.lease_payluk_event_withdrawal(text,uuid,uuid)','EXECUTE') AS lease,has_table_privilege('anon','public.payluk_event_worker_clock','SELECT') AS read")).rows[0];
 assert.equal(rights.lease,false);assert.equal(rights.read,false);
 } finally { await db.close(); }
});
