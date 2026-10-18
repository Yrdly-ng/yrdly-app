const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function loadRouting() {
  const module = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(fs.readFileSync('src/lib/notifications/notification-routing.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(module, module.exports);
  return module.exports;
}
const routing = loadRouting();
function worker() {
  const handlers = {}, shown = [], opened = [];
  const self = { location: { origin: 'https://app.yrdly.ng' }, addEventListener: (name, handler) => handlers[name] = handler,
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) } };
  const context = vm.createContext({ self, URL, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) },
    importScripts: () => vm.runInContext(fs.readFileSync('public/notification-routing.js', 'utf8'), context) });
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), context);
  return { handlers, shown, opened, self };
}
test('backend nested push data survives display and click, including recipient and notification IDs', async () => {
  const w = worker(); let pending;
  w.handlers.push({ data: { json: () => ({ title: 'New like', body: 'Someone liked your post', data: {
    type: 'post_like', postId: 'post', notificationId: 'notification', recipientId: 'recipient',
  } }) }, waitUntil: value => pending = value });
  await pending;
  assert.equal(w.shown[0].data.postId, 'post');
  w.handlers.notificationclick({ notification: { data: w.shown[0].data, close() {} }, waitUntil: value => pending = value });
  await pending;
  const url = new URL(w.opened[0]);
  assert.equal(url.pathname, '/posts/post');
  assert.equal(url.searchParams.get('notificationId'), 'notification');
  assert.equal(url.searchParams.get('recipientId'), 'recipient');
  assert.equal(url.searchParams.get('notificationTarget'), '/posts/post');
});
test('worker routing bundle matches the app resolver for every supported notification type', () => {
  const w = worker();
  const types = [...fs.readFileSync('src/lib/notifications/notification-routing.ts', 'utf8').matchAll(/case ['"]([^'"]+)['"]:/g)].map(match => match[1]);
  for (const type of types) {
    const data = { type, relatedId: 'related', relatedType: 'post', postId: 'post', conversationId: 'conversation', businessId: 'business', itemId: 'item', bookingId: 'booking', transactionId: 'tx', disputeId: 'dispute', alertId: 'alert', communityId: 'community', ticketId: 'ticket' };
    assert.equal(w.self.yrdlyNotificationRouting.getPushNotificationDestination(data), routing.getPushNotificationDestination(data), type);
  }
});
test('URL-only pushes use authenticated preflight and cannot open a foreign origin', async () => {
  for (const source of ['/posts/post', '//evil.example/posts/post', 'https://evil.example/posts/post']) {
    const w = worker(); let pending;
    w.handlers.notificationclick({ notification: { data: { url: source }, close() {} }, waitUntil: value => pending = value });
    await pending;
    const url = new URL(w.opened[0]);
    assert.equal(url.origin, 'https://app.yrdly.ng');
    assert.equal(url.searchParams.get('notificationTarget'), source === '/posts/post' ? '/posts/post' : '/notifications');
  }
});
function guard({ missing = false, unavailable = false, offline = false, recipient = 'user', legacy = false } = {}) {
  const effects = [], states = [], navigated = [], marked = [], toasts = [];
  const user = { id: 'user' };
  const search = new URLSearchParams(legacy ? { notificationTarget: '/posts/post', recipientId: recipient } : { notificationId: 'notification', recipientId: recipient });
  const builder = { select() { return this; }, eq() { return this; }, update() { marked.push(true); return this; },
    async maybeSingle() { return { data: missing ? null : { id: 'notification', type: 'post_like', related_id: 'post', data: {} }, error: null }; } };
  const mocks = {
    react: { useEffect: effect => effects.push(effect), useState: value => [value, update => states.push(update)] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'next/navigation': { usePathname: () => '/posts/post', useRouter: () => ({ replace: url => navigated.push(url) }), useSearchParams: () => search },
    '@/hooks/use-supabase-auth': { useAuth: () => ({ user }) },
    '@/hooks/use-toast': { useToast: () => ({ toast: value => toasts.push(value) }) },
    '@/lib/supabase/supabase': { supabase: { from: () => builder } },
    '@/lib/notifications/notification-navigation': { prepareNotificationNavigation: input => routing.resolveNotificationNavigation(input, async () => ({ found: !unavailable, error: offline ? new Error('offline') : null })) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('src/components/notifications/NotificationRouteGuard.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(id => { assert.ok(mocks[id], id); return mocks[id]; }, module, module.exports);
  const rendered = module.exports.NotificationRouteGuard({ children: 'detail' });
  const cleanup = effects[0]();
  return { rendered, navigated, marked, states, toasts, cleanup };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('push preflight blocks detail rendering and opens an existing owned source', async () => {
  const g = guard(); assert.equal(g.rendered.props.role, 'status');
  await flush(); assert.deepEqual(g.navigated, ['/posts/post']); assert.equal(g.marked.length, 1);
});
test('deleted and inaccessible targets go to a safe list with feedback', async () => {
  const g = guard({ unavailable: true }); await flush();
  assert.deepEqual(g.navigated, ['/home']); assert.equal(g.toasts.length, 1);
});
test('missing notifications and account mismatches do not mount the detail or acknowledge another account', async () => {
  for (const options of [{ missing: true }, { recipient: 'other' }]) {
    const g = guard(options); await flush();
    assert.deepEqual(g.navigated, ['/notifications']); assert.equal(g.marked.length, 0);
  }
});
test('offline push preflight leaves the notification unread and offers retry', async () => {
  const g = guard({ offline: true }); await flush();
  assert.equal(g.navigated.length, 0); assert.equal(g.marked.length, 0); assert.ok(g.states.length);
});
test('URL-only legacy push sources receive the same deleted-target handling', async () => {
  const g = guard({ legacy: true, unavailable: true }); await flush();
  assert.deepEqual(g.navigated, ['/home']); assert.equal(g.marked.length, 0);
});
test('an account switch or unmount cancels a pending push navigation', async () => {
  const g = guard(); g.cleanup(); await flush();
  assert.equal(g.navigated.length, 0); assert.equal(g.marked.length, 0);
});
test('the authenticated layout mounts one push guard and preserves the entire login return URL', () => {
  const source = fs.readFileSync('src/app/(app)/layout.tsx', 'utf8');
  assert.equal((source.match(/<NotificationRouteGuard>/g) || []).length, 1);
  assert.ok(source.includes('window.location.search'));
  assert.ok(source.includes('encodeURIComponent(next)'));
});
