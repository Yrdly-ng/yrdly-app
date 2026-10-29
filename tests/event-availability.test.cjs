const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync('src/lib/events/event-availability.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod, mod.exports);
const { getTicketSaleAvailability } = mod.exports;
const now = Date.parse('2026-10-29T12:00:00Z');
const event = { status: 'PUBLISHED', end_time: '2026-10-30T12:00:00Z' };
const tier = { is_visible: true, capacity: 10, sold: 2, sale_ends_at: null };
test('only published events with a future end time offer tickets', () => {
  assert.equal(getTicketSaleAvailability(event,tier,now).available,true);
  for(const status of ['DRAFT','CANCELLED','COMPLETED']) assert.equal(getTicketSaleAvailability({...event,status},tier,now).available,false);
  for(const end_time of [null,'bad','2026-10-29T12:00:00Z']) assert.equal(getTicketSaleAvailability({...event,end_time},tier,now).available,false);
  assert.equal(getTicketSaleAvailability({...event,is_archived:true},tier,now).available,false);
});
test('sale deadline and remaining capacity bound ticket quantity', () => {
  assert.equal(getTicketSaleAvailability(event,{...tier,sale_ends_at:'2026-10-29T12:00:00Z'},now).label,'Sales closed');
  assert.equal(getTicketSaleAvailability(event,{...tier,capacity:2},now).label,'Sold out');
  assert.equal(getTicketSaleAvailability(event,{...tier,is_visible:false},now).available,false);
  assert.equal(getTicketSaleAvailability(event,{...tier,sold:9},now).maxQuantity,1);
  assert.equal(getTicketSaleAvailability(event,{...tier,capacity:null},now).maxQuantity,5);
});
