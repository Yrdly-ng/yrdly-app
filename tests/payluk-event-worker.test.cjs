const {test}=require('node:test'); const assert=require('node:assert/strict');const fs=require('node:fs'); const ts=require('typescript');const crypto=require('node:crypto');
function fixture(){
 const owner='owner',event='event';const bank={bank_code:'001',account_number:'1234567890',account_name:'Organizer'};
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([bank.bank_code,bank.account_number,bank.account_name])).digest('hex');
 const state={events:[{id:event,organizer_id:owner,end_time:'2020-01-01T00:00:00Z',status:'PUBLISHED'}],seller_accounts:[{user_id:owner,is_primary:true,is_active:true,verification_status:'verified',account_details:bank}],payluk_event_withdrawals:[{id:'w',reference:'reference',organizer_id:owner,event_id:event,domain:'test',status:'submitting',amount_kobo:228000,bank_fingerprint:fingerprint}],payluk_event_allocations:[],payluk_event_refund_requests:[],escrow_transactions:[],tickets:[]};
 for(let i=1;i<=2;i++){const id=`tx${i}`;state.payluk_event_allocations.push({transaction_id:id,withdrawal_id:'w',amount_kobo:114000,release_status:'queued'});state.escrow_transactions.push({id,item_type:'ticket',payment_provider:'payluk',seller_id:owner,amount:1200,commission:36,seller_amount:1140,status:'paid',payluk_tx_ref:id,payluk_escrow_id:id,metadata:{event_id:event,payluk_environment:'test',payluk_fee_mode:'native_commission_v1',quantity:1,event_release_not_before:'2020-01-02T00:00:00Z'}});state.tickets.push({id:`ticket${i}`,event_id:event,payment_provider:'payluk',payment_tx_ref:id,status:'PAID',refund_status:null});}
 const window={paidAt:'1577836800',maxDelivery:1,deliveryTimeline:'days'};let withdrawalsEnabled=true;const calls={claim:[],bank:0,details:0};const closed=new Set(),pendingClaims=new Set();let delayedClaim=false,loseClaim=false,loseBank=false;
 const db={from(table){let filters=[],values=null;const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},gt(k,v){filters.push(x=>x[k]>v);return q},in(k,v){filters.push(x=>v.includes(x[k]));return q},contains(k,v){filters.push(x=>Object.entries(v).every(([a,b])=>x[k]?.[a]===b));return q},order(){return q},limit(){return q},not(k,op,v){filters.push(x=>x[k]!=null);return q},update(v){values=v;return q},single(){return q.then(x=>({...x,data:x.data[0]||null}))},maybeSingle(){return q.single()},then(resolve,reject){try{let rows=state[table].filter(x=>filters.every(f=>f(x)));if(values)rows.forEach(x=>Object.assign(x,values));return Promise.resolve({data:rows.map(x=>({...x})),error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q},async rpc(name,args){if(name==='lease_payluk_event_withdrawal'){const w=state.payluk_event_withdrawals[0];if(w.organizer_id!==args.p_owner||!['reserved','submitting','pending'].includes(w.status))return {data:null,error:null};Object.assign(w,{processing_token:args.p_token,processing_until:'2099-01-01T00:00:00Z'});return {data:{...w},error:null}}if(name==='checkpoint_payluk_event_release'){const a=state.payluk_event_allocations.find(x=>x.transaction_id===args.p_transaction);a.release_status=args.p_status;return {data:true,error:null}}throw Error(name)}};
 const provider={async verifyEscrow(token){return {...window,id:token,environment:'test',amount:1200,fee:60,status:closed.has(token)||pendingClaims.has(token)?'CLAIMED':'ONGOING',state:closed.has(token)?'CLOSED':'OPENED'}},async claimFunds(customer,token){calls.claim.push(token);if(delayedClaim)pendingClaims.add(token);else closed.add(token);if(loseClaim){loseClaim=false;throw Error('response lost')}},async withdrawToBank(input){calls.bank++;if(loseBank)throw Error('submission response lost');await input.onIntentReady('bank-ref',{amount:2260,fee:20});return {outcome:'pending'}},async getWithdrawalDetails(){calls.details++;return {outcome:'success',debit:2280}}};
 const module={exports:{}};const code=ts.transpileModule(fs.readFileSync('src/lib/events/payluk-event-finance.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const requireMock=n=>n==='server-only'?{}:n==='node:crypto'?crypto:n.includes('supabase-admin')?{supabaseAdmin:db}:n.endsWith('payluk-service')?{PaylukService:provider}:n.endsWith('payluk-onboarding')?{getPaylukCustomerId:async()=> 'customer'}:n.endsWith('payment-state')?{paylukAmountsMatch:()=>true}:n.endsWith('finance-config')?{paylukEventEnvironment:()=>'test',assertPaylukEventEnvironment:(tx,remote)=>{if(tx.metadata?.payluk_environment!=='test'||(remote&&remote.environment!=='test'))throw Error('environment mismatch');},paylukEventFinanceEnabled:()=>true,paylukEventWithdrawalsEnabled:()=>withdrawalsEnabled}:n.endsWith('event-finance-error')?{EventFinanceError:class extends Error{constructor(m,status){super(m);this.status=status}}}:require(n);
 new Function('require','module','exports',code)(requireMock,module,module.exports);
 return {state,calls,window,provider,disableWithdrawals:()=>withdrawalsEnabled=false,next:()=>module.exports.advanceNextPaylukEventWithdrawal(),claimAvailableAt:module.exports.paylukEventClaimAvailableAt,advance:()=>module.exports.advancePaylukEventWithdrawal('reference',owner,event),delayClaim:()=>delayedClaim=true,settleClaim:token=>{pendingClaims.delete(token);closed.add(token)},loseClaim:()=>loseClaim=true,loseBank:()=>loseBank=true,wrongOwner:()=>module.exports.advancePaylukEventWithdrawal('reference','other',event)};
}
test('batch resumes one escrow at a time, then submits and reconciles one bank intent',async()=>{const f=fixture();await f.advance();assert.deepEqual(f.calls.claim,['tx1']);assert.equal(f.calls.bank,0);await f.advance();assert.deepEqual(f.calls.claim,['tx1','tx2']);await f.advance();assert.equal(f.calls.bank,1);assert.equal(f.state.payluk_event_withdrawals[0].status,'pending');await f.advance();assert.equal(f.calls.bank,1);assert.equal(f.state.payluk_event_withdrawals[0].status,'success');});
test('CLAIMED and OPENED holds organiser funds until provider terminal settlement',async()=>{
 const f=fixture();f.delayClaim();
 await f.advance();
 assert.deepEqual(f.calls.claim,['tx1']);
 assert.equal(f.calls.bank,0);
 assert.equal(f.state.payluk_event_allocations[0].release_status,'claiming');
 assert.equal(f.state.payluk_event_withdrawals[0].status,'submitting');
 assert.ok(Date.parse(f.state.payluk_event_withdrawals[0].next_attempt_at)>Date.now());
 await f.advance();
 assert.deepEqual(f.calls.claim,['tx1'],'An outstanding claim cannot be submitted twice');
 assert.equal(f.calls.bank,0);
 assert.equal(f.state.payluk_event_allocations[0].release_status,'claiming');
 f.settleClaim('tx1');
 await f.advance();
 assert.equal(f.state.payluk_event_allocations[0].release_status,'released');
 assert.deepEqual(f.calls.claim,['tx1']);
 assert.equal(f.calls.bank,0);
});

test('lost claim response resumes by verifying the same escrow without claiming twice',async()=>{const f=fixture();f.loseClaim();await f.advance();assert.equal(f.state.payluk_event_allocations[0].release_status,'claiming');await f.advance();assert.equal(f.state.payluk_event_allocations[0].release_status,'released');assert.deepEqual(f.calls.claim,['tx1']);});
test('unknown bank submission is retained for review and never resubmitted',async()=>{const f=fixture();await f.advance();await f.advance();f.loseBank();await f.advance();await f.advance();await f.advance();assert.equal(f.calls.bank,1);assert.equal(f.state.payluk_event_withdrawals[0].status,'review');});
test('unauthorized owners, changed bank accounts and refund holds cannot initiate release',async()=>{const f=fixture();await assert.rejects(f.wrongOwner(),/not found/);f.state.tickets[0].refund_status='pending';await f.advance();assert.equal(f.calls.claim.length,0);f.state.tickets[0].refund_status=null;f.state.seller_accounts[0].account_details.account_number='9876543210';await f.advance();assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);});
test('withdrawals blocked by refund or bank changes leave the automatic queue for review',async()=>{
 for(const change of [f=>f.state.tickets[0].refund_status='pending',f=>f.state.seller_accounts[0].account_details.account_number='9876543210',f=>f.state.events[0].status='CANCELLED']){
  const f=fixture();change(f);await f.advance();
  assert.equal(f.state.payluk_event_withdrawals[0].status,'review');
  assert.equal(f.state.payluk_event_allocations.length,2,'Reserved funds remain protected');
  assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
 }
});

test('claim waits for the provider delivery window without consuming its release checkpoint',async()=>{
 const f=fixture();f.window.paidAt=new Date().toISOString();
 await f.advance();
 assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
 assert.equal(f.state.payluk_event_allocations[0].release_status,'queued');
 assert.equal(f.state.payluk_event_withdrawals[0].status,'submitting');
 assert.equal(Date.parse(f.state.payluk_event_withdrawals[0].next_attempt_at),Date.parse(f.window.paidAt)+2*86400000);
 f.window.paidAt='1577836800';await f.advance();
 assert.deepEqual(f.calls.claim,['tx1']);
});
test('provider claim dates accept Unix seconds, milliseconds and ISO dates with the extra day',()=>{
 const f=fixture(), at=Date.parse('2026-11-01T12:00:00Z');
 for(const paidAt of [at, String(at), at/1000, String(at/1000),new Date(at).toISOString()]){
  for(const [deliveryTimeline,unit] of [['minutes',60000],['hours',3600000],['days',86400000]]){
   assert.equal(f.claimAvailableAt({paidAt,maxDelivery:2,deliveryTimeline}),at+2*unit+86400000);
  }
 }
 for(const changed of [{paidAt:null},{paidAt:''},{paidAt:'bad'},{maxDelivery:0},{maxDelivery:366},{maxDelivery:1.5},{deliveryTimeline:'unknown'}]){
  assert.equal(f.claimAvailableAt({...f.window,...changed}),null);
 }
});
test('missing provider timing sends an order to review without attempting a claim',async()=>{
 const f=fixture();f.window.paidAt=null;await f.advance();
 assert.equal(f.state.payluk_event_withdrawals[0].status,'review');
 assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
});

test('event hold prevents release one millisecond before end plus 24 hours',async()=>{
 const f=fixture(),originalNow=Date.now,now=Date.parse('2026-11-01T12:00:00Z');
 Date.now=()=>now;
 try{
  f.state.events[0].end_time=new Date(now-86400000+1).toISOString();
  await f.advance();
  assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
  assert.equal(f.state.payluk_event_withdrawals[0].status,'review');
 }finally{Date.now=originalNow;}
});
test('event hold permits release exactly at end plus 24 hours when provider window has passed',async()=>{
 const f=fixture(),originalNow=Date.now,now=Date.parse('2026-11-01T12:00:00Z');
 Date.now=()=>now;
 try{
  f.state.events[0].end_time=new Date(now-86400000).toISOString();
  await f.advance();assert.deepEqual(f.calls.claim,['tx1']);assert.equal(f.calls.bank,0);
 }finally{Date.now=originalNow;}
});
test('rescheduling after the first release prevents the remaining batch from releasing',async()=>{
 const f=fixture();await f.advance();
 f.state.events[0].end_time=new Date(Date.now()+86400000).toISOString();
 await f.advance();assert.deepEqual(f.calls.claim,['tx1']);assert.equal(f.calls.bank,0);
 assert.equal(f.state.payluk_event_withdrawals[0].status,'review');
 assert.equal(f.state.payluk_event_allocations[0].release_status,'released');
 assert.equal(f.state.payluk_event_allocations[1].release_status,'queued');
});
test('provider refund, dispute or changed fee cannot be claimed or paid out',async()=>{
 for(const change of [{status:'REFUNDED',state:'CLOSED'},{status:'DISPUTED'},{fee:61}]){
  const f=fixture(),verify=f.provider.verifyEscrow;
  f.provider.verifyEscrow=async token=>({...await verify(token),...change});
  await f.advance();assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
  assert.equal(f.state.payluk_event_withdrawals[0].status,'review');
 }
});

test('disabled withdrawals still reconcile known bank references without a new claim or transfer',async()=>{
 const f=fixture();const row=f.state.payluk_event_withdrawals[0];
 Object.assign(row,{status:'pending',provider_reference:'existing-bank-ref',expected_debit_kobo:228000});
 f.disableWithdrawals();const result=await f.next();assert.equal(result.reconciled,1);
 assert.equal(row.status,'success');assert.equal(f.calls.details,1);assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
});
test('disabled withdrawals never advance an unsubmitted reservation',async()=>{
 const f=fixture();f.disableWithdrawals();assert.equal((await f.next()).processed,0);
 assert.equal(f.calls.details,0);assert.equal(f.calls.claim.length,0);assert.equal(f.calls.bank,0);
});
