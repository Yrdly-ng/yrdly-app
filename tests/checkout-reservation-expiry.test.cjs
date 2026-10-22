const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx:ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    const basename = path.basename(id).replace(/\.tsx?$/, '');
    const mockKey = Object.keys(mocks).find(key => path.basename(key).replace(/\.tsx?$/, '') === basename);
    if (mockKey) return mocks[mockKey];
    if (id === 'next/server') return { NextRequest: Request, NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id.endsWith('.ts') ? id : `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire,
    console, AbortSignal, Response, URL, URLSearchParams, Buffer, TextDecoder, TextEncoder, FormData, setTimeout, clearTimeout,
    process: { env: { PAYLUK_SECRET_KEY: 'test-only', ...mocks.env } },
    ...mocks.globals,
    fetch: mocks.fetch || (() => { throw new Error('Live network is prohibited in audit tests'); }),
  }, { filename });
  return module.exports;
}

function chain(result) {
  const query = {};
  for (const method of ['select','eq','neq','is','in','or','contains','limit','update','insert','single','maybeSingle','delete','order','gt','gte','lt','lte']) query[method] = () => query;
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function fixture({age=600001, owner='other-buyer', provider=true, remoteStatus='PENDING', deleteFails=false, status='pending', itemType='post'}={}) {
  const old={id:'prior',buyer_id:owner,seller_id:'seller',item_type:itemType,status,created_at:new Date(Date.now()-age).toISOString(),updated_at:new Date().toISOString(),total_amount:2575,
    payluk_tx_ref:provider?'old-token':null,payluk_escrow_id:provider?'old-escrow':null};
  let released=false,deleted=false,created=0,paid=0;
  const admin={rpc:async(name,args)=>{
    if(name==='consume_rate_limit')return{data:true};
    if(name==='expire_checkout_reservation') {assert.equal(args.p_transaction_id,'prior');if(provider)assert.equal(deleted,true); released=true;return{data:true};}
    if(name==='create_checkout_reservation'){assert.equal(released,true);return{data:'new-tx'};}
    throw Error('Unexpected RPC '+name);
  },from(table){
    const result=table==='posts'?{id:'item',user_id:'seller',price:2500,is_sold:false,category:'For Sale',moderation_status:'approved'}:
      table==='catalog_items'?{id:'item',business_id:'business',price:2500,in_stock:released}:
      table==='businesses'?{owner_id:'seller'}:released?[]:[old];
    const q=chain({data:result});q.update=()=>chain({data:{id:'new-tx'}});return q;
  }};
  const {POST}=load('src/app/api/payment/initialize/route.ts',{
    '@/lib/supabase-server':{getAuthenticatedUser:async()=>({data:{user:{id:'buyer',email:'buyer@example.test'}}})},
    '@/lib/supabase-admin':{supabaseAdmin:admin},
    '@/lib/user-suspension':{isUserSuspendedOrBanned:async()=>({suspended:false})},
    '@/lib/payluk-onboarding':{getPaylukCustomerId:async id=>'provider-'+id},
    '@/lib/payment-reconciliation':{flagPayment:async()=>{}},
    '@/lib/escrow-payment':{applyEscrowPayment:async()=>{paid++;}},
    '@/lib/payluk-service':{PaylukService:{
      verifyEscrow:async()=>({status:remoteStatus,state:remoteStatus==='PENDING'?'AWAITING_PAYMENT':'OPENED'}),
      deleteEscrow:async(id,token)=>{assert.equal(id,'provider-seller');assert.equal(token,'old-token');if(deleteFails)throw Error('Provider unavailable');deleted=true;},
      updateCustomerPermissions:async()=>{},createEscrow:async()=>{assert.equal(released,true);created++;return{id:'new-escrow',paymentToken:'new-token',fee:20};},addAdditionalFee:async()=>{},
    }},
  });
  return {run:()=>POST(new Request('https://qa.invalid',{method:'POST',body:JSON.stringify({itemId:'item',buyerId:'buyer',sellerId:'seller',price:2500,itemType})})),state:()=>({released,deleted,created,paid})};
}

test('another buyer can buy after ten minutes even if updated_at was refreshed',async()=>{
  const f=fixture();const response=await f.run();assert.equal(response.status,200);assert.deepEqual(f.state(),{released:true,deleted:true,created:1,paid:0});
});

test('reservation remains protected before ten minutes',async()=>{
  const f=fixture({age:599000});assert.equal((await f.run()).status,409);assert.equal(f.state().released,false);assert.equal(f.state().deleted,false);
});
test('expired provider checkout for the same buyer is replaced',async()=>{
  const f=fixture({owner:'buyer'});assert.equal((await f.run()).status,200);assert.equal(f.state().deleted,true);
});
test('failed provider cancellation cannot release stock or create another checkout',async()=>{
  const f=fixture({deleteFails:true});assert.equal((await f.run()).status,409);assert.equal(f.state().released,false);assert.equal(f.state().created,0);
});
test('paid provider escrow cannot expire into a second sale',async()=>{
  const f=fixture({remoteStatus:'ONGOING'});assert.equal((await f.run()).status,409);assert.equal(f.state().paid,1);assert.equal(f.state().deleted,false);assert.equal(f.state().released,false);
});
test('unlinked pending reservation expires but uncertain creation stays protected',async()=>{
  const f=fixture({provider:false});assert.equal((await f.run()).status,200);assert.equal(f.state().released,true);
  const uncertain=fixture({provider:false,status:'creating_escrow'});assert.equal((await uncertain.run()).status,409);assert.equal(uncertain.state().released,false);
});
