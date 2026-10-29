const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const eventId = '00000000-0000-4000-8000-000000000010';
const ownerId = '00000000-0000-4000-8000-000000000001';
function fixture(options = {}) {
  const calls = { rpc: [], after: [], delivered: [] };
  const admin = {
    rpc: async (...args) => { calls.rpc.push(args); return options.rpcError ? { error: options.rpcError } : { data: { success: true, alreadyCancelled: !!options.alreadyCancelled, refundsRequested: 0, notificationsQueued: 1 } }; },
    from(table) {
      let operation = 'select';
      const q = { select: () => q, eq: () => q, limit: () => q, update: () => { operation = 'update'; return q; }, single: () => q,
        then: resolve => Promise.resolve(table === 'events' ? { data: { id: eventId, organizer_id: ownerId, title: 'Test event', status: 'PUBLISHED' } } : { data: operation === 'select' ? [] : null }).then(resolve) };
      return q;
    },
  };
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) }, after: fn => calls.after.push(fn) },
    '@/lib/supabase/supabase-server': { getAuthenticatedUser: async () => ({ data: { user: options.unauthenticated ? null : { id: ownerId } }, error: null }) },
    '@/lib/supabase/supabase-admin': { supabaseAdmin: admin },
    '@/lib/events/event-cancellation-notifications': { deliverEventCancellationNotifications: async id => { calls.delivered.push(id); if (options.deliveryFails) throw Error('Provider unavailable'); } },
  };
  const source = ts.transpileModule(fs.readFileSync('src/app/api/events/[id]/cancel/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports','console',source)(name => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name]; },module,module.exports,{ error() {} });
  return { calls, run: () => module.exports.POST({}, { params: Promise.resolve({ id: eventId }) }) };
}

test('successful cancellation atomically queues notifications and schedules their delivery', async () => {
  const f=fixture(); const r=await f.run(); assert.equal(r.status,200);
  assert.deepEqual(f.calls.rpc, [['cancel_event_with_notifications',{p_event_id:eventId,p_organizer_id:ownerId}]]);
  assert.equal(f.calls.after.length,1); await f.calls.after[0](); assert.deepEqual(f.calls.delivered,[eventId]);
});

test('delivery failure cannot undo committed cancellation', async () => {
  const f=fixture({deliveryFails:true}); const r=await f.run(); assert.equal(r.status,200);
  assert.equal(f.calls.after.length,1); await f.calls.after[0]();
});

test('repeated cancellation can resume delivery without repeating the cancellation mutation', async () => {
  const f=fixture({alreadyCancelled:true}); const r=await f.run(); assert.equal(r.status,200); assert.equal(r.body.alreadyCancelled,true); assert.equal(f.calls.after.length,1);
});

for (const [code,status] of [['42501',403],['P0002',404],['P0001',409],['XX000',500]]) {
  test(`cancellation database error ${code} maps to ${status} without delivery`, async () => {
    const f=fixture({rpcError:{code,message:'private database details'}}); const r=await f.run(); assert.equal(r.status,status); assert.equal(f.calls.after.length,0); assert.doesNotMatch(JSON.stringify(r.body),/private database details/);
  });
}
test('unauthenticated cancellation cannot invoke privileged RPC', async()=>{const f=fixture({unauthenticated:true});assert.equal((await f.run()).status,401);assert.equal(f.calls.rpc.length,0)});
