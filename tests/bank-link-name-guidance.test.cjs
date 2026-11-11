const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');

const guidance='Your bank name needs to match your YRDLY display name. Kindly change your name in Profile to match your bank name.';

function setup({profileName='Yrdly Test User',legalName='',bankOwner='Ada Adaeze',enteredName='Ada Adaeze',resolution=true,loggedIn=true}={}){
  let writes=0,providerCalls=0;
  const profile={name:profileName,legal_name:legalName};
  const query=()=>({
    select(){return this;},eq(){return this;},update(){return this;},insert(){writes++;return Promise.resolve({error:null});},
    single(){return Promise.resolve({data:profile,error:null});},
    then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
  });
  const deps={
    'next/server':{NextRequest:Request,NextResponse:{json:(body,opt)=>Response.json(body,opt)}},
    '@/lib/supabase/supabase-server':{getAuthenticatedUser:async()=>({data:{user:loggedIn?{id:'buyer-uuid'}:null},error:null})},
    '@/lib/supabase/supabase-admin':{supabaseAdmin:{from:()=>query()}},
    '@/lib/payments/payluk-service':{PaylukService:{resolveAccount:async()=>{providerCalls++;return resolution?{valid:true,accountName:bankOwner}:{valid:false};}}}
  };
  const source=fs.readFileSync('src/app/api/seller/setup-account/route.ts','utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};new Function('require','module','exports',js)((id)=>{assert.ok(Object.hasOwn(deps,id),'Unexpected dependency '+id);return deps[id]},m,m.exports);
  async function invoke(){return m.exports.POST(new Request('https://qa.invalid/api/seller/setup-account',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({bankCode:'001',accountNumber:'1234567890',accountName:enteredName})}));}
  return {invoke,stats:()=>({writes,providerCalls})};
}
test('verified bank vs YRDLY profile mismatch returns actionable guidance, not generic ownership claim',async()=>{
  const h=setup();const res=await h.invoke();const data=await res.json();
  assert.equal(res.status,422);assert.equal(data.code,'OWNERSHIP_MISMATCH');assert.equal(data.error,guidance);
  assert.equal(h.stats().writes,0,'Mismatch must never save a bank account');
});
test('legal-name ownership check remains active',async()=>{
  const h=setup({profileName:'Ada Adaeze',legalName:'Different Legal Owner'});const res=await h.invoke();const data=await res.json();
  assert.equal(res.status,422);assert.equal(data.code,'OWNERSHIP_MISMATCH');assert.equal(h.stats().writes,0);
});
test('valid bank owner still links account successfully',async()=>{
  const h=setup({profileName:'Ada Adaeze'});const res=await h.invoke();
  assert.equal(res.status,200);assert.equal((await res.json()).success,true);assert.equal(h.stats().writes,1);
});
test('entered account name mismatch preserves its distinct reason',async()=>{
  const h=setup({profileName:'Ada Adaeze',enteredName:'Another Account Holder'});const res=await h.invoke();const data=await res.json();
  assert.equal(res.status,422);assert.equal(data.code,'NAME_MISMATCH');assert.notEqual(data.error,guidance);assert.equal(h.stats().writes,0);
});
test('provider cannot verify bank details: do not misdiagnose as profile mismatch',async()=>{
  const h=setup({profileName:'Ada Adaeze',resolution:false});const res=await h.invoke();const data=await res.json();
  assert.equal(res.status,422);assert.match(data.error,/Could not verify account details/);assert.equal(data.code,undefined);assert.equal(h.stats().writes,0);
});
test('anonymous users cannot trigger account lookup',async()=>{
  const h=setup({loggedIn:false});const res=await h.invoke();assert.equal(res.status,401);assert.equal(h.stats().providerCalls,0);
});
