const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture({failure,authorized=true}={}){const reported=[],writes=[];const mod={exports:{}};const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:authorized?{id:'follow'}:null,error:null}),single:async()=>({data:{name:'Fixture'},error:null})};
 const source=ts.transpileModule(fs.readFileSync('src/app/api/notifications/actor/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',source)(name=>{
  if(name==='next/server')return{NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('supabase-server'))return{getAuthenticatedUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}},error:null})};
  if(name.endsWith('supabase-admin'))return{supabaseAdmin:{from:()=>q,rpc:async()=>({data:true,error:null})}};
  if(name.endsWith('server-notification-service'))return{NotificationService:{createNotification:async body=>{writes.push(body);if(failure)throw failure;return'id'}}};
  if(name.endsWith('telemetry/sentry'))return{captureWebError:(...args)=>reported.push(args)};
  throw Error(name);
 },mod,mod.exports);
 return{reported,writes,run:body=>mod.exports.POST(new Request('https://fixture.invalid/api/notifications/actor',{method:'POST',body:JSON.stringify(body)}))};}
const body={type:'new_follower',userId:'22222222-2222-4222-8222-222222222222',relatedId:'11111111-1111-4111-8111-111111111111'};
test('notification persistence failure returns a recoverable response with a safe diagnostic context',async()=>{const app=fixture({failure:{code:'23514',message:'private database payload'}});const response=await app.run(body);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|23514/);assert.equal(app.reported[0][1].operation,'notification.actor');});
test('error handling preserves authorization and never writes an unsupported notification',async()=>{const app=fixture({authorized:false});assert.equal((await app.run(body)).status,403);assert.equal(app.writes.length,0);assert.equal(app.reported.length,0);});
