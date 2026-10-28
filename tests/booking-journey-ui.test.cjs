const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://yrdly.test/bookings/booking' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
function compile(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  Function('require','module','exports',code)(name => mocks[name] || require(name), module, module.exports);
  return module.exports;
}
const id = '00000000-0000-4000-8000-000000000001';
async function mountDetail({ payment = 'unpaid', role = 'customer', ended = false, status = 'requested', priced = false, staged = false } = {}) {
  const routes = [];
  const row = {
    id, customer_id: 'customer', business_id: 'business', service_id: 'service', status,
    payment_status: payment,
    payment_flow: staged ? 'staged_50_50' : 'legacy', agreed_price: staged ? 3000 : null,
    appointment_time: new Date(Date.now() + (ended ? -120 : 120) * 60000).toISOString(),
    end_time: new Date(Date.now() + (ended ? -60 : 180) * 60000).toISOString(),
    service: { name: 'Consultation', price: priced ? 3000 : null, requires_full_payment: priced, duration_minutes: 60 },
    business: { name: 'Local Studio', owner_id: 'provider' }, customer: { name: 'Customer' },
  };
  const query = { select() { return this; }, eq() { return this; }, single: async () => ({ data: row, error: null }) };
  const Page = compile('src/app/(app)/bookings/[bookingId]/page.tsx', {
    'next/navigation': { useParams: () => ({ bookingId: id }), useRouter: () => ({ push: url => routes.push(url), back() {} }) },
    '@/hooks/use-supabase-auth': { useAuth: () => ({ user: { id: role } }) },
    '@/lib/bookings/booking-service': { BookingService: {}, CANCELLATION_WINDOW_HOURS: 5 },
    '@/lib/notifications/notification-triggers': { NotificationTriggers: {} },
    '@/lib/supabase/supabase': { supabase: { from: () => query } },
    '@/lib/auth/authenticated-fetch': { authenticatedFetch: async () => ({}) },
    '@/components/bookings/BookingReschedulePanel': { BookingReschedulePanel: () => React.createElement('div', {}, 'Reschedule controls') },
    '@/components/reviews/WriteBusinessReviewDialog': { WriteBusinessReviewDialog: () => React.createElement('button', {}, 'Review booking') },
  }).default;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Page)));
  return { container, routes, unmount: async () => { await act(() => root.unmount()); container.remove(); } };
}

test('unpriced booking details remain readable and customer can find booking history', async () => {
  const h = await mountDetail();
  try {
    assert.match(h.container.textContent, /Price on request/);
    const button = [...h.container.querySelectorAll('button')].find(node => node.textContent === 'My Bookings');
    await act(() => button.click());
    assert.deepEqual(h.routes, ['/bookings']);
  } finally { await h.unmount(); }
});
test('new payment waits for acceptance while pending legacy checkout can recover', async () => {
  for (const scenario of [
    { status: 'requested', payment: 'unpaid', payable: false },
    { status: 'requested', payment: 'failed', payable: false },
    { status: 'confirmed', payment: 'unpaid', payable: true },
    { status: 'requested', payment: 'deposit_pending', payable: true },
  ]) {
    const h = await mountDetail({ ...scenario, priced: true });
    try {
      const buttons = [...h.container.querySelectorAll('button')];
      assert.equal(buttons.some(node => node.textContent === 'Review booking payment'), scenario.payable);
      if (!scenario.payable) assert.match(h.container.textContent, /Waiting for the business to accept/);
    } finally { await h.unmount(); }
  }
});
test('accepted staged booking explains payment hold without offering a legacy full-release checkout', async () => {
  const h = await mountDetail({ status: 'confirmed', priced: true, staged: true });
  try {
    assert.match(h.container.textContent, /Agreed service price/);
    assert.match(h.container.textContent, /Staged payment setup pending/);
    assert.ok(![...h.container.querySelectorAll('button')].some(node => node.textContent === 'Review booking payment'));
  } finally { await h.unmount(); }
});
test('pending and paid booking cancellation use contextual support instead of a failing cancel action', async () => {
  for (const payment of ['deposit_pending', 'fully_paid', 'escrow_held']) {
    const h = await mountDetail({ payment });
    try {
      const buttons = [...h.container.querySelectorAll('button')];
      assert.ok(!buttons.some(node => node.textContent === 'Cancel Booking'));
      const support = buttons.find(node => node.textContent === 'Get booking support');
      assert.ok(support);
      await act(() => support.click());
      assert.match(h.routes[0], new RegExp(`booking_id=${id}`));
    } finally { await h.unmount(); }
  }
});
test('provider retains unpaid decline, paid requests do not offer unsafe decline, and inbox remains accessible', async () => {
  for (const payment of ['unpaid', 'fully_paid']) {
    const h = await mountDetail({ payment, role: 'provider' });
    try {
      const buttons = [...h.container.querySelectorAll('button')];
      assert.equal(buttons.some(node => node.textContent.trim() === 'Decline Request'), payment === 'unpaid');
      const inbox = buttons.find(node => node.textContent === 'All business bookings');
      await act(() => inbox.click());
      assert.equal(h.routes[0], '/businesses/business/bookings');
    } finally { await h.unmount(); }
  }
});
