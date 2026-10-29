const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('src/app/(app)/events/[id]/EventPageClient.tsx', 'utf8');
const ast = ts.createSourceFile('event.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function find(node) {
  if(ts.isVariableDeclaration(node) && node.name.getText(ast)==='handleContactOrganizer') callback=node.initializer.getText(ast);
  ts.forEachChild(node,find);
}
find(ast);
assert.ok(callback,'event organiser is contactable');
function fixture({user={id:'buyer'},existing=[],lookupError=null,insertError=null}={}) {
  const queries=[],routes=[],alerts=[],busy=[];
  const query={
    select:()=>query,
    eq:(key,value)=>{queries.push(['eq',key,value]);return query;},
    contains:(key,value)=>{queries.push(['contains',key,value]);return query;},
    insert:(value)=>{queries.push(['insert',value]);return query;},
    single:async()=>({data:insertError?null:{id:'created'},error:insertError}),
    then:(resolve,reject)=>Promise.resolve({data:existing,error:lookupError}).then(resolve,reject),
  };
  const context={event:{id:'event',organizer_id:'organiser',title:'Neighbourhood gathering',cover_image_url:null},user,
    contactingOrganizer:false,setContactingOrganizer:value=>busy.push(value),
    supabase:{from:table=>{assert.equal(table,'conversations');return query;}},
    router:{push:path=>routes.push(path)},toast:value=>alerts.push(value)};
  const code=ts.transpileModule(`return ${callback}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const run=new Function(...Object.keys(context),code)(...Object.values(context));
  return {run,queries,routes,alerts,busy};
}
test('organiser contact uses an existing two-person event conversation',async()=>{
  const app=fixture({existing:[{id:'old',participant_ids:['buyer','organiser']}]});
  await app.run();
  assert.deepEqual(app.routes,['/messages/old']);
  assert.ok(app.queries.some(([kind,key,value])=>kind==='eq'&&key==='item_id'&&value==='event'));
  assert.ok(app.queries.some(([kind,key,value])=>kind==='contains'&&key==='participant_ids'&&value.join() === 'buyer,organiser'));
  assert.equal(app.queries.filter(([kind])=>kind==='insert').length,0);
});
test('contact creates an event-scoped conversation without sending a message',async()=>{
  const app=fixture();await app.run();
  const insert=app.queries.find(([kind])=>kind==='insert')[1];
  assert.equal(insert.type,'event');assert.equal(insert.item_id,'event');
  assert.deepEqual(insert.participant_ids,['buyer','organiser']);
  assert.deepEqual(app.routes,['/messages/created']);
});
test('failed conversation lookup never creates another conversation',async()=>{
  const app=fixture({lookupError:new Error('offline')});await app.run();
  assert.equal(app.queries.filter(([kind])=>kind==='insert').length,0);
  assert.equal(app.routes.length,0);assert.equal(app.alerts.length,1);assert.deepEqual(app.busy,[true,false]);
});
test('failed creation is visible and does not navigate to a missing chat',async()=>{
  const app=fixture({insertError:new Error('denied')});await app.run();
  assert.equal(app.routes.length,0);assert.equal(app.alerts.length,1);
});
test('signed-out contact opens sign-in, organiser cannot contact themselves',async()=>{
  const guest=fixture({user:null});await guest.run();assert.deepEqual(guest.routes,['/login']);assert.equal(guest.queries.length,0);
  const owner=fixture({user:{id:'organiser'}});await owner.run();assert.equal(owner.routes.length,0);assert.equal(owner.queries.length,0);
});
