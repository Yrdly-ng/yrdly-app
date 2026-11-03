const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function fixture({end=Date.now()+86400000,cancelled=false,snapshot=Date.now()+86400000}={}){
 let writes=0;const tx={id:'tx',item_type:'ticket',amount:1200,commission:36,payluk_escrow_id:'escrow',payluk_tx_ref:'PY_token',metadata:{event_id:'event',payluk_fee_mode:'native_commission_v1',payluk_environment:'test',event_release_not_before:new Date(snapshot).toISOString()}};
 const db={from(table){assert.equal(table,'events');const q={select(){return q},eq(){return q},single:async()=>({data:{end_time:new Date(end).toISOString(),status:cancelled?'CANCELLED':'PUBLISHED'}})};return q;},rpc:async(name,args)=>{writes++;return{data:args.p_plan};}};
 const exports={};const mocks={'@/lib/supabase/supabase-admin':{supabaseAdmin:db},'@/lib/payments/payluk-service':{PaylukService:{verifyEscrow:async()=>({id:'escrow',amount:1200,fee:60,whoPays:'seller',settlementType:'STANDARD',status:'DISPUTED',state:'OPENED'})}},'@/lib/payments/payment-state':{paylukAmountsMatch:()=>true},'@/lib/events/payluk-event-finance-config':{assertPaylukEventEnvironment:()=>{}},'../bookings/milestone-refund-plan':{},'../bookings/staged-booking-config':{}};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/lib/disputes/dispute-settlement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>mocks[n]||require(n),exports);
 return {run:refund=>exports.saveDisputePlan(tx,{id:'operation',refund_amount:refund,seller_amount:1200-refund}),writes:()=>writes};
}
test('event disputes cannot release organizer money before current event hold or snapshot ends',async()=>{
 for(const refund of [0,600]){const f=fixture();await assert.rejects(f.run(refund),/event hold/i);assert.equal(f.writes(),0);}
 for(const options of [{end:Date.now()-172800000,snapshot:Date.now()+86400000},{end:Date.now()+86400000,snapshot:Date.now()-86400000}])await assert.rejects(fixture(options).run(600),/event hold/i);
});
test('full buyer refund is available during hold; matured split permitted; cancelled seller release blocked',async()=>{
 assert.equal((await fixture().run(1200)).status,'REFUNDED');
 assert.equal((await fixture({end:Date.now()-172800000,snapshot:Date.now()-86400000}).run(600)).status,'SPLIT');
 await assert.rejects(fixture({end:Date.now()-172800000,snapshot:Date.now()-86400000,cancelled:true}).run(600),/event hold/i);
});

test('database independently enforces event dispute hold and keeps the command private',async()=>{
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE events(id uuid primary key,end_time timestamptz,status text);
 CREATE TABLE escrow_transactions(id uuid primary key,item_type text,payment_provider text,metadata jsonb);
 CREATE TABLE disputes(id uuid primary key,transaction_id uuid);
 CREATE TABLE dispute_resolution_operations(id uuid primary key,dispute_id uuid);
 CREATE FUNCTION public.save_payluk_dispute_plan(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT $2';
 INSERT INTO events VALUES('00000000-0000-4000-8000-000000000001',now()+interval '1 day','PUBLISHED');
 INSERT INTO escrow_transactions VALUES('00000000-0000-4000-8000-000000000002','ticket','payluk',jsonb_build_object('event_id','00000000-0000-4000-8000-000000000001','payluk_fee_mode','native_commission_v1','payluk_environment','test','event_release_not_before',now()+interval '2 days'));
 INSERT INTO disputes VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
 INSERT INTO dispute_resolution_operations VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261102154631_enforce_event_dispute_release_hold.sql','utf8'));
 const run=seller=>db.query("SELECT public.save_payluk_event_dispute_plan('00000000-0000-4000-8000-000000000004',$1) AS plan",[{sellerAmount:seller}]);
 await assert.rejects(run(570),/event_dispute_release_hold/);await run(0);
 await db.exec("UPDATE events SET end_time=now()-interval '2 days'; UPDATE escrow_transactions SET metadata=jsonb_set(metadata,'{event_release_not_before}',to_jsonb((now()-interval '1 day')::text))");await run(570);
 await db.exec("UPDATE events SET status='CANCELLED'");await assert.rejects(run(570),/event_dispute_release_hold/);
 const privileges=(await db.query("SELECT has_function_privilege('anon','public.save_payluk_event_dispute_plan(uuid,jsonb)','execute') AS anon,has_function_privilege('authenticated','public.save_payluk_event_dispute_plan(uuid,jsonb)','execute') AS users")).rows[0];assert.equal(privileges.anon,false);assert.equal(privileges.users,false);
 }finally{await db.close();}
});
