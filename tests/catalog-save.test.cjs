const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function setup(uploadError) {
  const writes=[];
  const supabase={ auth:{getUser:async()=>({data:{user:{id:'owner'}}})},
    from(table) {
      const q={select(){return q;},eq(){return q;},
        insert(payload){writes.push(payload);return q;},update(payload){writes.push(payload);return q;},
        single:async()=>({data:table==='businesses'?{owner_id:'owner'}:{id:'item'},error:null}),
        then(resolve,reject){return Promise.resolve({data:{id:'item'},error:null}).then(resolve,reject);}};
      return q;
    }, storage:{from:()=>({upload:async()=>({error:uploadError}),getPublicUrl:()=>assert.fail('No URL expected after upload failure')})}};
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync('src/lib/catalog/catalog-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','module','exports',code)(()=>({supabase}),module,module.exports);
  return {service:module.exports.CatalogService,writes};
}
test('web catalog saves synchronize both stock fields and zero inventory is unavailable', async()=>{
  const h=setup();
  await h.service.createCatalogItem('biz',{title:'Item',description:'Description',price:1200,quantity:3});
  assert.equal(h.writes[0].quantity,3);
  assert.equal(h.writes[0].inventory_count,3);
  await h.service.updateCatalogItem('item','biz',{quantity:0,in_stock:true});
  assert.equal(h.writes[1].quantity,0);
  assert.equal(h.writes[1].inventory_count,0);
  assert.equal(h.writes[1].in_stock,false);
});
test('failed catalog photo uploads do not report success or write a partial product',async()=>{
  const h=setup(new Error('Upload rejected'));
  await assert.rejects(h.service.createCatalogItem('biz',{title:'Item',description:'Description',price:1200},[{name:'photo.jpg'}]),/Failed to create/);
  assert.equal(h.writes.length,0);
});
