const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync('src/app/api/notifications/native-test/route.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
  fileName: 'native-test.ts',
});
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, 'Native push test route must parse');

const uuid = '071e3175-6ea0-4240-8d46-375013524001';
const deviceId = 'bd413f0b-7ddc-4a5d-9677-c5cf75123903';
const oldUser = '2b2d3753-0838-4aaf-b98f-3d096e903faa';

function setup({ authenticated = true, registered = true, rateAllowed = true, queued = 1, databaseError = false } = {}) {
  const calls = { auth: 0, lookedUp: [], rpc: [], sender: [] };
  const query = {
    select() { return this; },
    eq(name, value) { calls.lookedUp.push([name, value]); return this; },
    async maybeSingle() { return { data: registered ? { id: 'token-row' } : null, error: databaseError ? { message: 'offline' } : null }; },
  };
  const supabaseAdmin = {
    from(table) { assert.equal(table, 'user_push_tokens'); return query; },
    async rpc(name, params) { calls.rpc.push([name, params]); return { data: rateAllowed, error: null }; },
  };
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabase/supabase-server': {
      getAuthenticatedUser: async () => {
        calls.auth++;
        return { data: { user: authenticated ? { id: uuid } : null }, error: null };
      },
    },
    '@/lib/supabase/supabase-admin': { supabaseAdmin },
    '@/lib/notifications/server-functions': {
      invokeServerFunction: async (_client, name, body) => {
        assert.equal(_client, supabaseAdmin);
        calls.sender.push({ name, body });
        return { data: { queuedNativeDevices: queued }, error: null };
      },
    },
  };
  new Function('require', 'module', 'exports', compiled.outputText)((name) => {
    assert.ok(mocks[name], 'Unknown imported module ' + name);
    return mocks[name];
  }, module, module.exports);
  return {
    api: module.exports.POST,
    calls,
    request: async (body = { deviceId }) => ({ async json() { return body; } }),
  };
}

test('unregistered or unauthenticated accounts cannot request native pushes', async () => {
  const unknown = setup({ authenticated: false });
  const a = await unknown.api(await unknown.request());
  assert.equal(a.status, 401);
  assert.equal(unknown.calls.sender.length, 0);

  const unregistered = setup({ registered: false });
  const b = await unregistered.api(await unregistered.request());
  assert.equal(b.status, 409);
  assert.equal(unregistered.calls.sender.length, 0);

  const outage = setup({ databaseError: true });
  const c = await outage.api(await outage.request());
  assert.equal(c.status, 503);
  assert.equal(outage.calls.sender.length, 0);
});

test('native push test always targets authenticated account and one registered installation', async () => {
  const t = setup();
  const result = await t.api(await t.request({ userId: oldUser, deviceId }));
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.queued, 1);
  assert.deepEqual(t.calls.lookedUp, [['user_id', uuid], ['device_id', deviceId]]);
  assert.equal(t.calls.sender.length, 1);
  assert.equal(t.calls.sender[0].name, 'send-push-notification');
  const sent = t.calls.sender[0].body;
  assert.equal(sent.userId, uuid);
  assert.equal(sent.targetDeviceId, deviceId);
  assert.equal(sent.channel, 'native');
  assert.equal(sent.type, 'push_test');
  assert.equal(sent.payload.data.recipientId, uuid);
});

test('rate limit applies before native sender invocation', async () => {
  const t = setup({ rateAllowed: false });
  const result = await t.api(await t.request());
  assert.equal(result.status, 429);
  assert.equal(t.calls.sender.length, 0);
  assert.equal(t.calls.rpc[0][0], 'consume_rate_limit');
  assert.equal(t.calls.rpc[0][1].p_max_requests, 2);
});

test('native route never declares provider enqueue to be device receipt', async () => {
  const t = setup({ queued: 0 });
  const result = await t.api(await t.request());
  assert.equal(result.status, 503);
  assert.equal(result.body.success, false);
  const accepted = setup();
  const ok = await accepted.api(await accepted.request());
  assert.match(ok.body.note, /Queued for Expo/);
});

test('malformed devices and user provided push tokens cannot reach sender', async () => {
  const t = setup();
  const result = await t.api(await t.request({ deviceId: 'fake-device', pushToken: 'attempt' }));
  assert.equal(result.status, 400);
  assert.equal(t.calls.sender.length, 0);
});
