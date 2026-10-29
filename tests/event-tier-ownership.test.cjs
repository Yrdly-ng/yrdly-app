const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');
const file='src/app/(app)/events/[id]/EventPageClient.tsx';
function loadOwnership(tickets){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let render,effect;const listeners={};
 function find(node){
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('.from("tickets")')) effect=node.arguments[0].getText(ast);
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='map'&&node.arguments[0]?.getText(ast).includes('const availability = getTicketSaleAvailability(event, tier)')) render=node.arguments[0].getText(ast);
  ts.forEachChild(node,find);
 }find(ast);assert.ok(effect);assert.ok(render);
 const context={document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{}},window:{addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{},setInterval:()=>1,clearInterval:()=>{}},user:{id:'buyer'},id:'event',hasTicket:false,ownedTicketCounts:{},setHasTicket:v=>context.hasTicket=v,setOwnedTicketCounts:v=>context.ownedTicketCounts=v,
  event:{status:'PUBLISHED',end_time:'2099-01-01T00:00:00Z'},isOrganizer:false,handleSelectTier:()=>{},formatPrice:value=>'₦'+value,Button:'Button',
  getTicketSaleAvailability:()=>({available:true,label:'Get tickets',maxQuantity:5})};
 const filters=[];const q={select:value=>{filters.push(['select',value]);return q;},eq:(key,value)=>{filters.push([key,value]);return q;},in:(key,value)=>{filters.push([key,value]);return q;},limit:()=>q,maybeSingle:()=>q,then:fn=>Promise.resolve(fn({data:tickets,error:null}))};context.supabase={from:()=>q};
 function evaluate(source){const code=ts.transpileModule(`return ${source}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;return new Function('context','exports','require',`with(context){${code}}`)(context,{},()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}));}
 return {filters,focus:async()=>{listeners.focus();await new Promise(setImmediate);},ready:async()=>{evaluate(effect)();await new Promise(setImmediate);},card:tier=>evaluate(render)(tier)};
}
function nodes(node){if(!node||typeof node!=='object')return[];return Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return(Array.isArray(node)?node:[node.props?.children]).map(text).join('');}
const tier=id=>({id,name:id,is_visible:true,price:3000,capacity:20,sold:1});
test('buying Normal never marks VIP as purchased or blocks buying VIP',async()=>{
 const app=loadOwnership([{tier_id:'Normal'}]);await app.ready();
 const normal=app.card(tier('Normal')),vip=app.card(tier('VIP'));
 const normalButton=nodes(normal).find(n=>n.type==='Button'),vipButton=nodes(vip).find(n=>n.type==='Button');
 assert.match(text(normal),/1 ticket owned/);assert.equal(text(normalButton),'Get more');
 assert.doesNotMatch(text(vip),/ticket.*owned|Purchased|Get more/);assert.equal(text(vipButton),'Get tickets');assert.equal(vipButton.props.disabled,false);
 assert.ok(app.filters.some(([key,value])=>key==='select'&&value==='tier_id'));
});
test('five tickets disable only their own tier, keeping other tiers available',async()=>{
 const app=loadOwnership(Array.from({length:5},()=>({tier_id:'Normal'})));await app.ready();
 const normal=nodes(app.card(tier('Normal'))).find(n=>n.type==='Button');
 const vip=nodes(app.card(tier('VIP'))).find(n=>n.type==='Button');
 assert.equal(normal.props.disabled,true);assert.match(text(normal),/Limit reached/);assert.equal(vip.props.disabled,false);
});

test('returning to web refreshes ownership changed on another device',async()=>{
 const rows=[{tier_id:'Normal'}];const app=loadOwnership(rows);await app.ready();
 assert.match(text(app.card(tier('Normal'))),/1 ticket owned/);
 rows.splice(0,1,{tier_id:'VIP'});await app.focus();
 assert.doesNotMatch(text(app.card(tier('Normal'))),/ticket.*owned|Get more/);
 assert.match(text(app.card(tier('VIP'))),/1 ticket owned/);
});
