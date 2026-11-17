const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Source-level release gates only: these tests do not send live pushes or
// expose real user details. End-to-end receipt/device tests remain required.
const service = fs.readFileSync('src/lib/notifications/server-notification-service.ts', 'utf8');
const sender = fs.readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');

test('the trusted Next service and Deno sender remain valid TypeScript', () => {
  for (const [name, source] of [['trusted-service', service], ['edge-sender', sender]]) {
    const built = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
      fileName: name + '.ts',
    });
    assert.deepEqual(
      (built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
        .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
      name
    );
  }
});

test('sender identity for messages comes from trusted server-side profile lookup', () => {
  assert.match(service, /shouldNameSender && params\.senderId/);
  assert.match(service, /\.from\("users"\)\s*\.select\("name"\)\s*\.eq\("id", params\.senderId\)/);
  assert.match(service, /fromUserName =/);
  assert.match(service, /\(fromUserName \? \{ fromUserName \} : \{\}\)/);
  assert.match(service, /\(conversationId \? \{ conversationId \} : \{\}\)/);
  assert.match(sender, /"fromUserName"/);
  assert.match(sender, /\$\{fromUserName\} sent you a message\./);
  assert.match(sender, /\$\{fromUserName\} sent you \$\{messageCount\} messages\./);
});

test('sensitive messages do not include their content in lock-screen previews', () => {
  assert.match(sender, /const isPrivateMessage/);
  assert.match(sender, /const pushTitle = isPrivateMessage/);
  assert.match(sender, /\? isInquiry \? "Item inquiry" : "New message"/);
  assert.match(sender, /"You have a new message\."/);
  assert.doesNotMatch(sender, /isPrivateMessage\s*\?\s*payload\.body/);
});

test('private account updates use specific labels but never blindly show payment details', () => {
  for (const kind of ['marketplace_item_sold','payment_successful','payment_refunded',
    'item_shipped','delivery_confirmed','funds_released','payout_processed',
    'payout_failed','dispute_opened','dispute_resolved']) {
    assert.ok(sender.includes(kind + ': { title:'), kind);
  }
  assert.match(sender, /isPrivateAccountUpdate\s*\?\s*marketplaceCopy/);
  assert.match(sender, /purchasedBy/);
  assert.match(sender, /purchasedItem/);
  assert.match(sender, /isPrivateAccountUpdate\s*\? privateCopy\.title/);
  assert.match(sender, /"Account update"/);
});

test('native token ownership and user notification opt-outs remain enforced', () => {
  assert.match(sender, /current\.user_id === userId && current\.device_id === row\.device_id/);
  assert.match(sender, /userData\.notification_settings\[mappedKey\] === false/);
  assert.match(sender, /eligibleNativeTokenRows\.map/);
  assert.match(sender, /notification_type: type \?\? "unknown"/);
});
