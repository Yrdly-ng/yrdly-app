const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
function service(file,rows){const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getMyTickets');assert.ok(fn);
 const q={select(fields){assert.match(fields,/\*/);assert.match(fields,/end_time/);assert.match(fields,/status/);return q;},eq(key,value){assert.equal(key,'buyer_id');this.buyer=value;return q;},order(){return Promise.resolve({data:rows.filter(row=>row.buyer_id===this.buyer),error:null});}};
 const mod={exports:{}};const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('supabase','module','exports',code)({from:table=>{assert.equal(table,'tickets');return q;}},mod,mod.exports);return mod.exports.getMyTickets;
}
test('web and mobile read the same persistent ticket ownership, tier and updated refund state',async()=>{
 const rows=[{id:'normal-ticket',buyer_id:'buyer',tier_id:'normal',status:'PAID',refund_status:null,event:{status:'PUBLISHED',end_time:'2099-01-01'}},{id:'private-ticket',buyer_id:'other',tier_id:'vip',status:'PAID'}];
 const web=service('src/lib/events/event-service.ts',rows),mobile=service(path.resolve('../yrdly-mobile/src/lib/events/event-service.ts'),rows);
 assert.deepEqual(await web('buyer'),await mobile('buyer'));assert.equal((await web('buyer')).length,1);assert.equal((await mobile('buyer'))[0].tier_id,'normal');
 rows[0].refund_status='processing';assert.equal((await web('buyer'))[0].refund_status,'processing');assert.deepEqual(await web('buyer'),await mobile('buyer'));
 rows[0].status='REFUNDED';rows[0].refund_status='processed';assert.equal((await mobile('buyer'))[0].status,'REFUNDED');assert.deepEqual(await web('buyer'),await mobile('buyer'));
});
