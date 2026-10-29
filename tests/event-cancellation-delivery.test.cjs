const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function fixture(options = {}) {
  const rows = (options.rows || [{ id: 'delivery-1', event_id: 'event-1', buyer_id: 'buyer-1', notification_id: 'notice-1', event_title: 'Neighbourhood party', attendee_name: 'Ada', start_time: '2026-11-01T12:00:00Z', event_location: 'Lagos', email: 'ada@example.com', channel: 'email', status: 'pending', attempts: 0, retry_at: '2020-01-01T00:00:00Z', locked_until: null, first_attempt_at: null }]).map(r => ({ ...r }));
  const calls = { emails: [], pushes: [] };
  let failSentCheckpoint = !!options.failSentCheckpoint;
  const admin = { from(table) {
    assert.equal(table, 'event_cancellation_deliveries');
    const filters = [];
    let payload, max = Infinity, single = false;
    const q = {
      select: () => q, update: value => { payload = value; return q; },
      eq: (k, v) => { filters.push(r => r[k] === v); return q; },
      in: (k, v) => { filters.push(r => v.includes(r[k])); return q; },
      lte: (k, v) => { filters.push(r => r[k] <= v); return q; },
      or: () => { filters.push(r => !r.locked_until || r.locked_until < new Date().toISOString()); return q; },
      order: () => q, limit: n => { max = n; return q; },
      maybeSingle: () => { single = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (payload?.status === 'sent' && failSentCheckpoint) { failSentCheckpoint = false; return { data: null, error: { message: 'checkpoint unavailable' } }; }
        const selected = rows.filter(r => filters.every(f => f(r))).slice(0, max);
        if (payload) selected.forEach(r => Object.assign(r, payload));
        return { data: single ? selected[0] ? { ...selected[0] } : null : selected.map(r => ({ ...r })), error: null };
      }).then(resolve, reject); },
    };
    return q;
  } };
  const source = ts.transpileModule(fs.readFileSync('src/lib/events/event-cancellation-notifications.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const deps = {
    'server-only': {}, 'node:crypto': require('node:crypto'),
    '@/lib/supabase/supabase-admin': { supabaseAdmin: admin },
    '@/lib/email/resend-service': { ResendEmailService: { isConfigured: () => options.configured !== false, async sendEventCancellationEmail(...args) { calls.emails.push(args); if (options.emailFailure) throw Error('Email unavailable'); if (options.loseLease) rows[0].lease_token = 'other-worker'; } } },
    '@/lib/notifications/server-functions': { async invokeServerFunction(...args) { calls.pushes.push(args); return options.pushResult || { data: { success: true }, error: null }; } },
  };
  new Function('require', 'module', 'exports', source)(id => { assert.ok(id in deps, `Unmocked ${id}`); return deps[id]; }, module, module.exports);
  return { rows, calls, run: module.exports.deliverEventCancellationNotifications };
}

test('successful email is checkpointed and never resent on ordinary retry', async () => {
  const f = fixture(); await f.run('event-1'); await f.run('event-1');
  assert.equal(f.calls.emails.length, 1); assert.equal(f.rows[0].status, 'sent');
  assert.ok(f.calls.emails[0].at(-1).includes(f.rows[0].id));
});

test('email provider failure remains queued without losing its first attempt or key', async () => {
  const f = fixture({ emailFailure: true }); await f.run('event-1');
  assert.equal(f.rows[0].status, 'pending'); assert.ok(f.rows[0].first_attempt_at); assert.equal(f.rows[0].attempts, 1);
});

test('successful email with lost checkpoint retries using the same provider key', async () => {
  const f = fixture({ failSentCheckpoint: true }); await f.run('event-1');
  f.rows[0].retry_at = '2020-01-01T00:00:00Z'; f.rows[0].locked_until = null;
  await f.run('event-1'); assert.equal(f.calls.emails.length, 2);
  assert.deepEqual(f.calls.emails[0], f.calls.emails[1]); assert.equal(f.rows[0].status, 'sent');
});

test('uncertain email older than provider dedupe window requires review without resend', async () => {
  const f = fixture(); f.rows[0].first_attempt_at = new Date(Date.now() - 24 * 3600000).toISOString();
  await f.run('event-1'); assert.equal(f.calls.emails.length, 0); assert.equal(f.rows[0].status, 'review');
});

test('unconfigured email retries later without starting provider dedupe window', async () => {
  const f = fixture({ configured: false }); await f.run('event-1');
  assert.equal(f.calls.emails.length, 0); assert.equal(f.rows[0].status, 'pending'); assert.equal(f.rows[0].first_attempt_at, null);
});

test('push uses stable delivery and notification keys and is independent of failed email', async () => {
  const f = fixture({ emailFailure: true }); f.rows.unshift({ ...f.rows[0], id: 'push-1', channel: 'push', email: null });
  await f.run('event-1'); await f.run('event-1');
  assert.equal(f.calls.pushes.length, 1); assert.equal(f.rows[0].status, 'sent');
  assert.equal(f.rows[1].status, 'pending');
  const body = f.calls.pushes[0][2]; assert.equal(body.type, 'event_cancelled'); assert.equal(body.payload.data.notificationId, 'notice-1'); assert.ok(body.payload.data.deliveryKey.includes('push-1'));
});

for (const result of [{ data: { success: false, reason: 'no_token' }, error: null }, { data: { success: true, skipped: true }, error: null }]) {
  test(`push without eligible recipient finishes without futile retries ${JSON.stringify(result.data)}`, async () => {
    const f = fixture({ pushResult: result }); f.rows[0].channel = 'push'; await f.run('event-1'); assert.equal(f.rows[0].status, 'sent');
  });
}

test('push dispatch failure remains pending', async () => {
  const f = fixture({ pushResult: { data: null, error: { message: 'network failed' } } }); f.rows[0].channel = 'push'; await f.run('event-1'); assert.equal(f.rows[0].status, 'pending');
});

test('active leases prevent concurrent workers from sending', async () => {
  const f = fixture(); f.rows[0].status = 'processing'; f.rows[0].locked_until = new Date(Date.now() + 60000).toISOString(); await f.run('event-1'); assert.equal(f.calls.emails.length, 0);
});

test('stale worker cannot overwrite another worker lease', async () => {
  const f = fixture({ loseLease: true }); await f.run('event-1'); assert.equal(f.rows[0].lease_token, 'other-worker'); assert.notEqual(f.rows[0].status, 'sent');
});

test('event-scoped retries cannot send another event cancellation', async () => {
  const f = fixture(); await f.run('event-other'); assert.equal(f.calls.emails.length, 0);
});
