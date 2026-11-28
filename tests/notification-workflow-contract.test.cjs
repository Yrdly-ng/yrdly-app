const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const webhook = fs.readFileSync('src/app/api/webhooks/payluk/route.ts', 'utf8');
const bookingApi = fs.readFileSync('src/app/api/bookings/create/route.ts', 'utf8');
const bookingClient = fs.readFileSync('src/app/(app)/bookings/create/page.tsx', 'utf8');

test('booking and payment notification changes remain syntactically valid', () => {
  for (const [path,source] of [
    ['payment-webhook.ts',webhook],['booking-create.ts',bookingApi],['booking-create.tsx',bookingClient]
  ]) {
    const built = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve }, reportDiagnostics: true, fileName: path
    });
    assert.deepEqual((built.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
      .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')), [], path);
  }
});

test('confirmed marketplace payment notifies buyer and seller only after state transition',()=>{
  const ongoing = webhook.slice(webhook.indexOf('async function handleEscrowOngoing'),
    webhook.indexOf('async function notifyReleasedFunds'));
  assert.match(ongoing,/const applied = await applyEscrowPayment/);
  assert.match(ongoing,/if \(!applied\) return;/);
  assert.match(ongoing,/\['post', 'catalog_item'\]\.includes\(tx\.item_type\)/);
  assert.match(ongoing,/type: 'marketplace_item_sold'/);
  assert.match(ongoing,/type: 'payment_successful'/);
  assert.match(ongoing,/senderId: tx\.buyer_id/);
  assert.match(ongoing,/buyerName, itemTitle, itemId: tx\.item_id, transactionId: tx\.id/);
});

test('provider-confirmed settlement and refund create non-claiming notifications',()=>{
  const completed = webhook.slice(webhook.indexOf('async function handleEscrowCompleted'),
    webhook.indexOf('async function handleEscrowClaimed'));
  assert.match(completed,/if \(!transitioned\?\.length\)[^]*?return;/);
  assert.match(completed,/await notifyReleasedFunds\(tx\)/);
  assert.match(webhook,/type: 'funds_released'/);
  assert.match(webhook,/type: 'payment_refunded'/);
  assert.match(webhook,/const \{ data: applied, error: refundError \}/);
  assert.match(webhook,/if \(!applied\) return;/);
  assert.match(webhook,/funds are available to withdraw/i);
});

test('server-side booking notifications replace after-navigation client callbacks',()=>{
  assert.match(bookingApi,/const ownerId = data\.business\?\.owner_id/);
  assert.match(bookingApi,/type: 'booking_requested'/);
  assert.match(bookingApi,/senderId: user\.id/);
  assert.match(bookingApi,/relatedId: data\.id/);
  assert.match(bookingApi,/await NotificationService\.createNotification/);
  assert.doesNotMatch(bookingClient,/onBookingRequested/);
});
