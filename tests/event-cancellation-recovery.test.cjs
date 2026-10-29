const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function fixture({ authorized = true, recoveryError = false } = {}) {
  let recovery = 0, reminderQueries = 0;
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('src/app/api/cron/event-reminders/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ status: init.status || 200, body }) } },
    '@/lib/supabase/supabase-admin': { supabaseAdmin: { from(table) {
      assert.equal(table, 'events'); reminderQueries++;
      const q = {}; for (const k of ['select', 'in', 'gte', 'lte']) q[k] = () => q;
      q.then = (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return q;
    } } },
    '@/lib/notifications/server-push-notification': { sendPushNotification: async () => {} },
    '@/lib/events/event-cancellation-notifications': { async deliverEventCancellationNotifications() { recovery++; if (recoveryError) throw Error('Queue unavailable'); return { checked: 1, sent: 1, retrying: 0, review: 0 }; } },
  };
  new Function('require', 'module', 'exports', 'process', source)(id => { assert.ok(id in deps, id); return deps[id]; }, module, module.exports, { env: { CRON_SECRET: 'fixture' } });
  return { run: () => module.exports.GET({ headers: new Headers(authorized ? { authorization: 'Bearer fixture' } : {}) }), counts: () => ({ recovery, reminderQueries }) };
}

test('existing event cron recovers cancellation deliveries even without upcoming events', async () => {
  const f = fixture(); const r = await f.run();
  assert.equal(r.status, 200); assert.equal(r.body.cancellationDeliveries.sent, 1); assert.equal(r.body.remindersSent, 0);
  assert.equal(f.counts().recovery, 1);
});

test('unauthorized cron cannot send cancellation notices or read event data', async () => {
  const f = fixture({ authorized: false }); const r = await f.run(); assert.equal(r.status, 401);
  assert.deepEqual(f.counts(), { recovery: 0, reminderQueries: 0 });
});

test('queue failure is not reported as successful delivery', async () => {
  const f = fixture({ recoveryError: true }); const r = await f.run(); assert.equal(r.status, 500);
});
