const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function fixture(){
 let consent=false,submitted=false,released=false,lose=false,enabled=true,changed=false,readFailure=false,identityFailure=false;let calls=0,records=0,transactionEnvironment='test',providerEnvironment='test';
 const rows=[{id:'first',milestone_id:'first',amount_kobo:150000},{id:'final',milestone_id:'final',amount_kobo:150000}];
 const db={rpc:async(name,args)=>{
  if(name==='authorize_booking_milestone_release'){
   if(args.p_buyer!=='buyer')return {error:{message:'forbidden'}};
   const submit=!submitted;consent=true;return {data:{submit,release:{id:'first',transaction_id:'tx',escrow_id:'escrow',milestone_id:'first',amount_kobo:150000}}};
  }
  if(name==='claim_booking_milestone_submission'){assert.equal(args.p_buyer,'buyer');assert.equal(args.p_release,'first');assert.ok(consent);if(submitted)return {data:false};submitted=true;return {data:true};}
  assert.equal(name,'record_booking_milestone_release');assert.equal(args.p_amount,150000);assert.equal(args.p_milestone,'first');records++;return {data:true};
 },from(table){const q={select(){return q},eq(){return q},order(){return q},single(){return q},then(resolve){return Promise.resolve({data:table==='booking_milestone_releases'?rows:{payluk_tx_ref:'token',payluk_escrow_id:'escrow',amount:3000,metadata:{payluk_environment:transactionEnvironment}}}).then(resolve)}};return q;}};
 const provider={getMilestones:async()=>{if(readFailure){readFailure=false;throw Error('temporary provider read failure');}return rows.map(r=>({id:r.milestone_id,amount:changed?1499:1500,status:r.id==='first'&&released?'RELEASED':'PENDING',releasedAt:released?'1793500000':null}));},
 verifyEscrow:async()=>({id:'escrow',environment:providerEnvironment,state:'OPENED',status:'ONGOING',settlementType:'MILESTONE',whoPays:'buyer',amount:3000}),
 confirmMilestone:async()=>{calls++;released=true;if(lose){lose=false;throw Error('response lost');}}};
 const exports={};const moduleCode=ts.transpileModule(fs.readFileSync('src/lib/bookings/milestone-release.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const contract={};new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/bookings/milestone-contract.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(contract);
 new Function('require','exports',moduleCode)(n=>n==='server-only'?{}:n.endsWith('supabase-admin')?{supabaseAdmin:db}:n.endsWith('payluk-service')?{PaylukService:provider}:n.endsWith('payluk-onboarding')?{getPaylukCustomerId:async()=>{if(identityFailure){identityFailure=false;throw Error('temporary identity read failure');}return 'buyer-provider';}}:n.endsWith('staged-booking-config')?{stagedBookingOperationsEnabled:()=>enabled,stagedBookingEnvironment:()=>'test'}:n.endsWith('milestone-contract')?contract:n.endsWith('booking-payments')?{BookingCheckoutError:class extends Error{}}:require(n),exports);
 return {run:(buyer='buyer')=>exports.approveBookingMilestone('booking',buyer,1),lose:()=>lose=true,failRead:()=>readFailure=true,failIdentity:()=>identityFailure=true,disable:()=>enabled=false,change:()=>changed=true,setTransactionEnvironment:value=>transactionEnvironment=value,setProviderEnvironment:value=>providerEnvironment=value,stats:()=>({calls,records})};
}
test('lost release response is recovered through milestone reads without another confirmation',async()=>{
 const f=fixture();f.lose();await assert.rejects(f.run(),/response lost/);assert.deepEqual(f.stats(),{calls:1,records:0});
 assert.equal((await f.run()).status,'released');assert.deepEqual(f.stats(),{calls:1,records:1});
});
test('disabled rollout, wrong buyer and altered milestone cannot submit funds release',async()=>{
 for(const mode of ['disabled','buyer','changed']){const f=fixture();if(mode==='disabled')f.disable();if(mode==='changed')f.change();await assert.rejects(f.run(mode==='buyer'?'stranger':'buyer'));assert.equal(f.stats().calls,0);}
});

test('cross-environment transaction or provider response cannot confirm a milestone',async()=>{
 for(const source of ['transaction','provider']){
  const f=fixture();if(source==='transaction')f.setTransactionEnvironment('live');else f.setProviderEnvironment('live');
  await assert.rejects(f.run());assert.deepEqual(f.stats(),{calls:0,records:0});
 }
});

test('a temporary preflight read failure can recover and submit the original release once',async()=>{
 const f=fixture();f.failRead();await assert.rejects(f.run(),/temporary provider read failure/);assert.deepEqual(f.stats(),{calls:0,records:0});
 assert.equal((await f.run()).status,'released');assert.deepEqual(f.stats(),{calls:1,records:1});
});

test('a temporary identity preflight failure can recover before the submission boundary',async()=>{
 const f=fixture();f.failIdentity();await assert.rejects(f.run(),/temporary identity read failure/);assert.deepEqual(f.stats(),{calls:0,records:0});
 assert.equal((await f.run()).status,'released');assert.equal(f.stats().calls,1);
});
test('concurrent buyer approvals claim at most one provider confirmation',async()=>{
 const f=fixture();await Promise.all([f.run(),f.run()]);assert.equal(f.stats().calls,1);
});
