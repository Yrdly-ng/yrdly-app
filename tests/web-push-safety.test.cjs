const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// A valid-length uncompressed public point for the browser-mock transport;
// no production keys, push providers, or real user devices are used here.
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const publicBytes = Buffer.from(publicKey, 'base64url');
const source = fs.readFileSync('src/lib/notifications/web-push-client.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ permission = 'granted', ios = false, standalone = true, keyAvailable = true, oldKey = false } = {}) {
  const calls = { registered: 0, subscribed: 0, unsubscribed: 0, rows: [], deleted: [], permissions: 0 };
  const state = { subscription: null };
  const mockSubscription = (key) => ({
    endpoint: 'https://push.example.test/subscribe/example',
    options: { applicationServerKey: Uint8Array.from(key).buffer },
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'encrypted', auth: 'secret' } }; },
    async unsubscribe() { calls.unsubscribed++; state.subscription = null; return true; },
  });
  if (oldKey) state.subscription = mockSubscription(Buffer.alloc(65, 1));
  const registration = {
    pushManager: {
      async getSubscription() { return state.subscription; },
      async subscribe(options) {
        calls.subscribed++;
        assert.equal(options.userVisibleOnly, true);
        assert.deepEqual(Buffer.from(options.applicationServerKey), publicBytes);
        return (state.subscription = mockSubscription(publicBytes));
      },
    },
  };
  const navigator = {
    userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 Chrome',
    serviceWorker: {
      async register(path) { assert.equal(path, '/sw.js'); calls.registered++; return registration; },
      async getRegistration() { return registration; },
    },
  };
  const window = {
    Notification: {},
    PushManager: function PushManager() {},
    matchMedia: () => ({ matches: standalone }),
  };
  const Notification = { permission, async requestPermission() { calls.permissions++; return permission; } };
  const query = {
    select() { return this; },
    eq() { return this; },
    filter() { return this; },
    async maybeSingle() { return { data: null, error: null }; },
    async insert(row) { calls.rows.push(row); return { error: null }; },
    update() { return this; },
    delete() { return this; },
    abortSignal() { return this; },
    then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
  };
  const supabase = { from(name) {
    assert.equal(name, 'push_subscriptions');
    return Object.assign(Object.create(query), {
      delete() { calls.deleted.push(true); return this; },
    });
  } };
  const fetched = async (url) => {
    assert.equal(url, '/api/push/public-key');
    return { ok: keyAvailable, async json() { return { publicKey }; } };
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'navigator', 'Notification', 'fetch', 'atob', 'AbortSignal', 'console',
    compiled)(
    (id) => { assert.equal(id, '@/lib/supabase/supabase'); return { supabase }; },
    module, module.exports, window, navigator, Notification, fetched,
    (value) => Buffer.from(value, 'base64').toString('binary'), AbortSignal, console,
  );
  return { api: module.exports, calls, state };
}

test('browser registers the service worker and stores a complete subscription', async () => {
  const { api, calls } = harness();
  const result = await api.registerBrowserPush('user-a');
  assert.equal(result.ok, true);
  assert.equal(calls.registered, 1);
  assert.equal(calls.subscribed, 1);
  assert.equal(calls.rows.length, 1);
  assert.equal(calls.rows[0].user_id, 'user-a');
  assert.ok(calls.rows[0].subscription.keys.auth);
});

test('missing public-key endpoint fails closed without registering', async () => {
  const { api, calls } = harness({ keyAvailable: false });
  const result = await api.registerBrowserPush('user-a');
  assert.deepEqual(result, { ok: false, reason: 'vapid_unavailable' });
  assert.equal(calls.subscribed, 0);
});

test('changing the VAPID key removes stale subscription before registering fresh', async () => {
  const { api, calls } = harness({ oldKey: true });
  const result = await api.registerBrowserPush('user-a');
  assert.equal(result.ok, true);
  assert.equal(calls.unsubscribed, 1);
  assert.equal(calls.subscribed, 1);
});

test('denied permission and non-installed iOS never create subscriptions', async () => {
  const denied = harness({ permission: 'denied' });
  assert.equal((await denied.api.registerBrowserPush('user-a')).reason, 'permission_denied');
  assert.equal(denied.calls.subscribed, 0);
  const iphone = harness({ ios: true, standalone: false });
  assert.equal((await iphone.api.registerBrowserPush('user-a')).reason, 'ios_install_required');
  assert.equal(iphone.calls.subscribed, 0);
});

test('logout unsubscribes the browser and attempts to remove the old account row', async () => {
  const { api, calls } = harness();
  await api.registerBrowserPush('user-a');
  await api.unregisterBrowserPush('user-a');
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.unsubscribed, 1);
});

test('sender requires latest browser-endpoint owner and web test skips native', () => {
  const c = fs.readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');
  assert.ok(c.includes('.in("subscription->>endpoint", endpoints)'));
  assert.ok(c.includes('latestByEndpoint.get(row.subscription.endpoint)?.user_id === userId'));
  assert.ok(c.includes('Web push ownership check unavailable; browser delivery skipped'));
  assert.ok(c.includes('channel !== "web"'));
  assert.ok(c.includes('if (isDailyPrompt && Deno.env.get("DAILY_PROMPT_PUSH_ENABLED") !== "true")'));
});
