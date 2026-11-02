const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('fee recovery repairs only matching unallocated native orders and is inaccessible to clients',async()=>{const db=new PGlite();try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE escrow_transactions(id uuid primary key,item_type text,payment_provider text,metadata jsonb,payluk_escrow_id text,payluk_tx_ref text,status text,amount numeric,commission numeric,seller_amount numeric,updated_at timestamptz);
CREATE TABLE payluk_event_allocations(transaction_id uuid primary key);
INSERT INTO escrow_transactions VALUES('00000000-0000-4000-8000-000000000001','ticket','payluk','{"payluk_fee_mode":"native_commission_v1","payluk_environment":"test","payluk_fee":60}','escrow','PY_token','paid',1200,36,1164,now());`);
await db.exec(fs.readFileSync('supabase/migrations/20261102201132_reconcile_native_event_fee_evidence.sql','utf8'));
const run=(environment='test',fee=60,escrow='escrow')=>db.query("SELECT public.record_payluk_event_fee_evidence('00000000-0000-4000-8000-000000000001',$1,$2,1200,$3) AS result",[escrow,environment,fee]);
for(const params of [['live',60],['test',59],['test',60.001],['test',1201],['test',-1],['test',60,'different']])await assert.rejects(run(...params));
assert.equal((await run()).rows[0].result.seller_amount,1140);assert.equal((await run()).rows[0].result.seller_amount,1140);
await db.exec("INSERT INTO payluk_event_allocations VALUES('00000000-0000-4000-8000-000000000001')");await assert.rejects(run(),/already_allocated/);
const p=(await db.query("SELECT has_function_privilege('anon','public.record_payluk_event_fee_evidence(uuid,text,text,numeric,numeric)','execute') AS anon,has_function_privilege('authenticated','public.record_payluk_event_fee_evidence(uuid,text,text,numeric,numeric)','execute') AS users")).rows[0];assert.equal(p.anon,false);assert.equal(p.users,false);
}finally{await db.close();}});
