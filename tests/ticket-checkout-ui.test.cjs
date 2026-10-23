const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Execute the real event drawer's handler, with network/provider boundaries stubbed.
function harness({ response, verify, sessionError } = {}) {
  const source = fs.readFileSync('src/app/(app)/events/[id]/EventPageClient.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handlePurchase') handler = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(handler);
  const initial = { step: 'form', tier: { id: 'tier', price: 2000 }, errorMsg: '' };
  let state = initial;
  let widget;
  const calls = [];
  const routes = [];
  const fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/purchase')) return response || Response.json({ success: true, paylukPaymentToken: 'PY_TOKEN', buyerPaylukId: 'buyer', transactionId: 'transaction', tx_ref: 'REF' });
    if (url.endsWith('/verify')) return verify ? await verify() : Response.json({ success: true, ticket: { id: 'ticket', event_id: 'event' } });
    if (url.endsWith('/cancel-checkout')) return Response.json({ success: true });
    throw new Error(`Unexpected URL ${url}`);
  };
  const supabase = { auth: { getSession: async () => {
    if (sessionError) throw sessionError;
    return { data: { session: { access_token: 'test-token' } } };
  } } };
  const cache = {};
  const load = (file) => {
    if (cache[file]) return cache[file];
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'fetch', output)((name) => {
      if (name.includes('/supabase')) return { supabase };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
      throw new Error(`Unexpected dependency ${name}`);
    }, module, module.exports, fetch);
    return (cache[file] = module.exports);
  };
  const authenticatedFetch = load('src/lib/auth/authenticated-fetch.ts').authenticatedFetch;
  const vars = {
    purchase: initial,
    purchaseInFlight: { current: false },
    form: { name: 'Guest', email: 'guest@example.test', phone: '', quantity: 1 },
    id: 'event', supabase, fetch, authenticatedFetch,
    setPurchase: (update) => { state = typeof update === 'function' ? update(state) : update; },
    router: { push: (route) => routes.push(route) },
    window: { location: { origin: 'https://app.yrdly.test' } },
    process: { env: { NEXT_PUBLIC_PAYLUK_PUBLIC_KEY: 'pk_test_example' } },
    setTimeout: (fn) => fn(),
  };
  const code = ts.transpileModule(`module.exports = ${handler};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ...Object.keys(vars), code)(module, module.exports, (name) => {
    assert.equal(name, 'payluk-escrow-inline-checkout');
    return { initEscrowCheckout: () => {}, pay: async (options) => { widget = options; } };
  }, ...Object.values(vars));
  return { run: module.exports, state: () => state, widget: () => widget, calls, routes };
}

test('Safari non-JSON purchase failures show a recoverable checkout message, not the raw pattern error', async () => {
  const h = harness({ response: {
    ok: false, status: 504, headers: new Headers({ 'content-type': 'text/html' }),
    json: async () => { throw new SyntaxError('The string did not match the expected pattern.'); },
    text: async () => '<html>FUNCTION_INVOCATION_TIMEOUT</html>',
  } });
  await h.run();
  assert.equal(h.state().step, 'form');
  assert.doesNotMatch(h.state().errorMsg, /expected pattern|<html>/);
  assert.match(h.state().errorMsg, /temporarily unavailable|could not|couldn't|check my tickets/i);
  assert.equal(h.widget(), undefined);
  assert.equal(h.routes.length, 0);
});

test('provider success and close arriving together verify once and never cancel a paid checkout', async () => {
  let resolve;
  const verification = new Promise((done) => { resolve = done; });
  const h = harness({ verify: () => verification });
  await h.run();
  const success = h.widget().callback();
  const close = h.widget().onClose();
  await new Promise((done) => setImmediate(done));
  assert.equal(h.calls.filter((c) => c.url.endsWith('/verify')).length, 1);
  resolve(Response.json({ success: true, ticket: { id: 'ticket', event_id: 'event' } }));
  await Promise.all([success, close]);
  assert.equal(h.calls.filter((c) => c.url.endsWith('/cancel-checkout')).length, 0);
  assert.equal(h.state().step, 'success');
  assert.equal(h.routes.length, 1);
});

test('unpaid close verifies then cancels once and never marks a ticket confirmed', async () => {
  const h = harness({ verify: async () => Response.json({ error: 'payment_pending' }, { status: 400 }) });
  await h.run();
  await h.widget().onClose();
  assert.deepEqual(h.calls.map((c) => c.url), ['/api/events/tickets/purchase', '/api/events/tickets/verify', '/api/events/tickets/cancel-checkout']);
  assert.equal(h.state().step, 'form');
  assert.match(h.state().errorMsg, /unpaid checkout cancelled/i);
  assert.equal(h.routes.length, 0);
});

test('unavailable verification on close preserves the reservation without attempting cancellation', async () => {
  const h = harness({ verify: async () => Response.json({ error: 'Service unavailable' }, { status: 503 }) });
  await h.run();
  await h.widget().onClose();
  assert.equal(h.calls.filter((c) => c.url.endsWith('/cancel-checkout')).length, 0);
  assert.match(h.state().errorMsg, /check my tickets/i);
  assert.equal(h.routes.length, 0);
});

test('authentication read failure returns the purchase form without an uncaught exception', async () => {
  const h = harness({ sessionError: new Error('Please sign in again.') });
  await h.run();
  assert.equal(h.state().step, 'form');
  assert.match(h.state().errorMsg, /sign in/i);
  assert.equal(h.calls.length, 0);
});

test('simultaneous taps submit one purchase request', async () => {
  const h = harness();
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.calls.filter((c) => c.url.endsWith('/purchase')).length, 1);
});

test('free tickets skip the provider and route to My Tickets', async () => {
  const h = harness({ response: Response.json({ success: true, free: true, ticket_id: 'free-ticket' }) });
  await h.run();
  assert.equal(h.widget(), undefined);
  assert.equal(h.state().step, 'success');
  assert.deepEqual(h.routes, ['/my-tickets?success=1']);
});
