const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/lib/bookings/staged-booking-config.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const load=env=>{const e={};new Function('exports','process',code)(e,{env});return e;};
const env={PAYLUK_STAGED_COMMISSION_CONFIRMED:'true',QA_ENVIRONMENT:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://jxgpvvehajxegeeozlnl.supabase.co',PAYLUK_SECRET_KEY:'sk_test_fixture',PAYLUK_BASE_URL:'https://staging.api.payluk.ng'};
test('recovery can remain available while all new escrow creation is disabled',()=>{
 const c=load({...env,PAYLUK_STAGED_RECOVERY_ENABLED:'true'});assert.equal(c.stagedBookingPaymentsEnabled(),false);assert.equal(c.stagedBookingOperationsEnabled(),true);
 const off=load(env);assert.equal(off.stagedBookingPaymentsEnabled(),false);assert.equal(off.stagedBookingOperationsEnabled(),false);
});
test('checkout and recovery both reject live or wrong-project credentials',()=>{
 for(const change of [{PAYLUK_SECRET_KEY:'sk_live_fixture'},{PAYLUK_BASE_URL:'https://api.payluk.ng'},{NEXT_PUBLIC_SUPABASE_URL:'https://yoiyqxtpmxnrrbqqidcs.supabase.co'},{QA_ENVIRONMENT:'production'},{PAYLUK_STAGED_COMMISSION_CONFIRMED:'false'}]){
 const c=load({...env,PAYLUK_STAGED_BOOKINGS_ENABLED:'true',PAYLUK_STAGED_RECOVERY_ENABLED:'true',...change});assert.equal(c.stagedBookingOperationsEnabled(),false);assert.equal(c.stagedBookingPaymentsEnabled(),false);
 }
});
test('live mode needs explicit approval and matching production binding; flags stay independent',()=>{
 const live={...env,QA_ENVIRONMENT:'production',PAYLUK_STAGED_LIVE_APPROVED:'true',PAYLUK_STAGED_EXPECTED_PROJECT_REF:'yoiyqxtpmxnrrbqqidcs',NEXT_PUBLIC_SUPABASE_URL:'https://yoiyqxtpmxnrrbqqidcs.supabase.co',PAYLUK_SECRET_KEY:'sk_live_fixture',PAYLUK_BASE_URL:'https://api.payluk.ng',PAYLUK_STAGED_RECOVERY_ENABLED:'true'};
 assert.equal(load(live).stagedBookingEnvironment(),'live');assert.equal(load(live).stagedBookingOperationsEnabled(),true);assert.equal(load(live).stagedBookingPaymentsEnabled(),false);
 for(const change of [{PAYLUK_STAGED_LIVE_APPROVED:'false'},{PAYLUK_STAGED_EXPECTED_PROJECT_REF:'other'},{PAYLUK_SECRET_KEY:'sk_test_fixture'},{QA_ENVIRONMENT:'staging'}])assert.equal(load({...live,...change}).stagedBookingEnvironment(),null);
});
