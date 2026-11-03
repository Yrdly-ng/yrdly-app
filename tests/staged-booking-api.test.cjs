const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
function route({signedIn=true,permitted=true}={}){let calls=0;const e={};const code=ts.transpileModule(fs.readFileSync('src/app/api/bookings/[id]/milestones/approve/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const mocks={'next/server':{NextResponse:{json:(b,o)=>Response.json(b,o)}},'@/lib/supabase/supabase-server':{getAuthenticatedUser:async()=>({data:{user:signedIn?{id:'buyer'}:null}})},'@/lib/supabase/supabase-admin':{supabaseAdmin:{rpc:async()=>({data:permitted})}},'@/lib/bookings/milestone-release':{approveBookingMilestone:async(b,buyer,p)=>{calls++;assert.equal(buyer,'buyer');assert.equal(p,1);return{status:'released'};}},'@/lib/bookings/booking-payments':{BookingCheckoutError:class extends Error{}}};
 new Function('require','exports',code)(n=>mocks[n],e);return{calls:()=>calls,post:body=>e.POST(new Request('https://qa.invalid',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'00000000-0000-4000-8000-000000000001'})})};}
test('release API requires sign-in and explicit numeric milestone approval',async()=>{
 for(const body of [{position:1},{confirm:false,position:1},{confirm:true,position:3},{confirm:true,position:'1'}]){const f=route();assert.equal((await f.post(body)).status,400);assert.equal(f.calls(),0);}
 const f=route({signedIn:false});assert.equal((await f.post({confirm:true,position:1})).status,401);assert.equal(f.calls(),0);
});
test('throttled approval cannot reach provider-facing release code',async()=>{const f=route({permitted:false});const r=await f.post({confirm:true,position:1});assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');assert.equal(f.calls(),0);});
test('explicit approval forwards the authenticated buyer to the release service',async()=>{const f=route();assert.equal((await f.post({confirm:true,position:1})).status,200);assert.equal(f.calls(),1);});
function progressRoute({viewer='buyer',transactionStatus='paid',dispute=null,operation=null}={}){
 const e={};const db={from(table){const data={bookings:{customer_id:'buyer',business_id:'business',status:'completed',payment_status:'escrow_held'},businesses:{owner_id:'seller'},booking_milestone_releases:[{transaction_id:'tx',position:1,amount_kobo:150000,status:'released'},{transaction_id:'tx',position:2,amount_kobo:150000,status:'pending'}],escrow_transactions:{status:transactionStatus},disputes:dispute,dispute_resolution_operations:operation}[table];const q={select(){return q},eq(){return q},order(){return q},single(){return q},maybeSingle(){return q},then(resolve){return Promise.resolve({data}).then(resolve)}};return q;}};
 const mocks={'next/server':{NextResponse:{json:(b,o)=>Response.json(b,o)}},'@/lib/supabase/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:viewer}}})},'@/lib/supabase/supabase-admin':{supabaseAdmin:db},'@/lib/bookings/staged-booking-config':{stagedBookingPaymentsEnabled:()=>true,stagedBookingOperationsEnabled:()=>true}};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('src/app/api/bookings/[id]/milestones/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(n=>mocks[n],e);
 return ()=>e.GET(new Request('https://qa.invalid'),{params:Promise.resolve({id:'booking'})});
}
test('outsider cannot inspect milestone payment records',async()=>assert.equal((await progressRoute({viewer:'outsider'})()).status,403));
test('unresolved dispute suppresses all payment and approval actions',async()=>{
 const response=await progressRoute({transactionStatus:'disputed',dispute:{id:'dispute',status:'open'}})();const p=await response.json();assert.equal(p.financialHold,true);assert.equal(p.canPay,false);assert.ok(p.milestones.every(m=>m.canApprove===false));
});
test('settled refund preserves released label and offers no further approval',async()=>{
 const response=await progressRoute({transactionStatus:'completed',dispute:{id:'dispute',status:'resolved'},operation:{status:'succeeded'}})();const p=await response.json();assert.equal(p.settled,true);assert.equal(p.milestones[0].status,'released');assert.equal(p.milestones[1].status,'settled');assert.ok(p.milestones.every(m=>m.canApprove===false));assert.equal(p.milestones[0].transaction_id,undefined);
});
