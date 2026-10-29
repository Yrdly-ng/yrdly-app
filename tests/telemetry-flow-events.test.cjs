const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync('src/lib/telemetry/flow-events.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);const {flowEvent}=mod.exports;
test('payment telemetry distinguishes checkout from confirmed issuance and refund requests',()=>{
 assert.equal(flowEvent('/api/events/tickets/purchase','started'),'ticket_checkout_started');
 assert.equal(flowEvent('/api/events/tickets/purchase','succeeded',{success:true,authorizationUrl:'private'}),'ticket_checkout_opened');
 assert.equal(flowEvent('/api/events/tickets/purchase','succeeded',{success:true,free:true}),'ticket_issued');
 assert.equal(flowEvent('/api/events/tickets/verify','failed'),'ticket_verification_failed');
 assert.equal(flowEvent('/api/events/tickets/verify','succeeded',{success:true,ticket:{id:'private'}}),'ticket_issued');
 assert.equal(flowEvent('/api/events/tickets/refund','succeeded',{status:'processing'}),'ticket_refund_requested');
 assert.equal(flowEvent('/api/events/private-id/earnings/withdraw','succeeded'),'event_withdrawal_requested');
 assert.equal(flowEvent('/api/bookings/checkout','started'),'booking_checkout_started');
 assert.equal(flowEvent('/api/bookings/verify','succeeded',{success:false}),null);
 assert.equal(flowEvent('/api/bookings/verify','succeeded',{success:true}),'booking_payment_confirmed');
 assert.equal(flowEvent('/api/messages/send','succeeded'),null);
});
