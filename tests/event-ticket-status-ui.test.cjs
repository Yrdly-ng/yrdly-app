const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function mount(options) {
  const state = [], effects = [], cleanups = [];
  let cursor = 0, first = true, tree;
  const jsx = (type, props) => ({ type, props: props || {} });
  const hook = (initial) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  };
  const mocks = {
    react: { useState: hook, useRef: (value) => hook({ current: value })[0], useEffect: (fn) => { if (first) effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useRouter: () => ({ back() {} }), useSearchParams: () => ({ get: () => null }) },
    'next/image': { __esModule: true, default: 'Image' },
    'next/link': { __esModule: true, default: 'Link' },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/components/events/TicketEntryCode': { TicketEntryCode: 'TicketEntryCode' },
    '@/components/events/EventPageIntro': { EventPageIntro: 'EventPageIntro' },
    '@/components/ui/badge': { Badge: 'Badge' },
    '@/components/ui/skeleton': { Skeleton: 'Skeleton' },
    '@/hooks/use-supabase-auth': { useAuth: () => ({ user: options.user === undefined ? { id: 'buyer' } : options.user }) },
    '@/lib/events/event-service': { getMyTickets: async (userId) => options.getMyTickets ? options.getMyTickets(userId) : options.tickets },
    '@/lib/auth/authenticated-fetch': { authenticatedFetch: async () => ({ success: true }) },
  };
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', source)((name) => {
      if (name in mocks) return mocks[name];
      if (name === '@/lib/events/event-ticket-presentation') return load('src/lib/events/event-ticket-presentation.ts');
      throw new Error('Unmocked import ' + name);
    }, module, module.exports);
    return module.exports;
  }
  const screen = load('src/app/(app)/my-tickets/page.tsx').default;
  const render = () => { cursor = 0; tree = screen(); first = false; return tree; };
  return {
    render,
    async ready() { render(); effects.splice(0).forEach((fn) => cleanups.push(fn())); await new Promise(setImmediate); render(); },
    async changeUser(user) {
      cleanups.splice(0).forEach((cleanup) => cleanup?.());
      options.user = user; first = true; render();
      effects.splice(0).forEach((fn) => cleanups.push(fn()));
      await new Promise(setImmediate); render();
    },
    get tree() { return tree; },
  };
}
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return (Array.isArray(node) ? node : [node.props?.children]).map(text).join('');
}
const ticket = {
  id: 'ticket-1', event_id: 'event-1', status: 'PAID', qr_data: 'entry-1', ticket_code: 'CODE-1',
  amount_paid: 3000, attendee_name: 'Test buyer',
  event: { title: 'Test event', status: 'PUBLISHED', start_time: '2099-01-01', end_time: '2099-01-02' },
};
async function open(data) {
  const app = mount({ tickets: [data] });
  await app.ready();
  const card = all(app.tree, (node) => node.type === 'button' && node.props.className?.includes('text-left'))[0];
  assert.ok(card);
  card.props.onClick(); app.render();
  return app;
}
test('valid web tickets offer an entry code and event contact route', async () => {
  const app = await open(ticket);
  assert.equal(all(app.tree, (node) => node.type === 'TicketEntryCode').length, 1);
  assert.ok(all(app.tree, (node) => node.type === 'Link' && node.props.href === '/events/event-1').length);
});
test('web ticket details block entry for all inactive and refund states', async () => {
  const cases = [
    [{ status: 'USED' }, /Used/],
    [{ status: 'CANCELLED' }, /Cancelled/],
    [{ status: 'REFUNDED', is_test_payment: true }, /Refunded/],
    [{ refund_status: 'processing' }, /Refund pending/],
    [{ refund_status: 'review' }, /Refund needs support/],
    [{ refund_status: 'processed' }, /Refunded/],
    [{ event: { ...ticket.event, status: 'CANCELLED' } }, /Event cancelled/],
    [{ expires_at: '2000-01-01' }, /Expired/],
    [{ event: { ...ticket.event, end_time: '2000-01-01' } }, /Expired/],
  ];
  for (const [changes, label] of cases) {
    const app = await open({ ...ticket, ...changes });
    assert.equal(all(app.tree, (node) => node.type === 'TicketEntryCode').length, 0, JSON.stringify(changes));
    assert.match(text(app.tree), label);
    if (changes.is_test_payment) assert.match(text(app.tree), /Sandbox/);
  }
});

test('web refresh replaces the selected ticket with the latest refund state', async () => {
  const options = { tickets: [ticket] };
  const app = mount(options);
  await app.ready();
  all(app.tree, (node) => node.type === 'button' && node.props.className?.includes('text-left'))[0].props.onClick();
  app.render();
  options.tickets = [{ ...ticket, refund_status: 'processing' }];
  all(app.tree, (node) => node.type === 'button' && text(node) === 'Refresh ticket status')[0].props.onClick();
  await new Promise(setImmediate); app.render();
  assert.match(text(app.tree), /Refund pending/);
  assert.equal(all(app.tree, (node) => node.type === 'TicketEntryCode').length, 0);
});

test('presentation handles free cancellation, multi-day events and expiry boundaries', () => {
  const module = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(fs.readFileSync('src/lib/events/event-ticket-presentation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
  const present = module.exports.getEventTicketPresentation;
  const now = Date.parse('2026-10-29T12:00:00Z');
  const active = { ...ticket, event: { ...ticket.event, start_time: '2026-10-27', end_time: '2026-10-30' } };
  assert.equal(present(active, now).isValid, true, 'multi-day event remains valid beyond start + 24 hours');
  assert.equal(present({ ...active, expires_at: '2026-10-29T12:00:00Z' }, now).isValid, false);
  assert.equal(present({ ...active, expires_at: 'invalid' }, now).isValid, false);
  assert.equal(present({ ...active, event: undefined }, now).isValid, false);
  assert.equal(present({ ...active, event: { status: 'PUBLISHED' }, expires_at: null }, now).isValid, false);
  assert.equal(present({ ...active, status: 'REFUNDED', amount_paid: 0 }, now).label, 'Cancelled');
  assert.equal(present({ ...active, event: { ...active.event, status: 'COMPLETED' } }, now).isValid, false);
});


test('an old-account refresh cannot repopulate tickets after switching accounts', async () => {
  const options = { tickets: [ticket] };
  const app = mount(options); await app.ready();
  let finishOld;
  options.getMyTickets = (userId) => userId === 'buyer' ? new Promise((resolve) => { finishOld = resolve; }) : [];
  all(app.tree, (node) => node.type === 'button' && text(node) === 'Refresh')[0].props.onClick();
  await app.changeUser({ id: 'another-buyer' });
  finishOld([ticket]); await new Promise(setImmediate); app.render();
  assert.equal(all(app.tree, (node) => node.type === 'button' && node.props.className?.includes('text-left')).length, 0);
  assert.equal(all(app.tree, (node) => node.type === 'TicketEntryCode').length, 0);
});
