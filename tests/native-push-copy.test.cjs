const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Source-level release gates only: these tests do not send live pushes or
// expose real user details. End-to-end receipt/device tests remain required.
const service = fs.readFileSync('src/lib/notifications/server-notification-service.ts', 'utf8');
const sender = fs.readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');

function trustedService(messages, { shouldPush = true } = {}) {
  const pushed = [];
  const admin = {
    rpc: async () => ({ data: { id: 'notification', should_push: shouldPush }, error: null }),
    from(table) {
      const predicates = [];
      const query = {
        select() { return this; },
        eq(key, value) { predicates.push(row => row[key] === value); return this; },
        neq(key, value) { predicates.push(row => row[key] !== value); return this; },
        gte(key, value) { predicates.push(row => row[key] >= value); return this; },
        async maybeSingle() {
          return { data: table === 'users' ? { name: 'Caleb' } : { data: {} }, error: null };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: messages.filter(row => predicates.every(match => match(row))), error: null })
            .then(resolve, reject);
        },
        gte(key, value) { predicates.push(row => row[key] >= value); return this; },
        async maybeSingle() {
          return { data: table === 'users' ? { name: 'Caleb' } : { data: {} } };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: messages.filter(row => predicates.every(p => p(row))) })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  const mocks = {
    'server-only': {},
    './notification-service': { NotificationService: class {} },
    '../supabase/supabase-admin': { supabaseAdmin: admin },
    './server-push-notification': {
      sendPushNotification: async (...args) => pushed.push(args[2]),
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(service, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => {
    assert.ok(name in mocks, `Unexpected import: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { service: module.exports.NotificationService, pushed };
}

test('a named sender count excludes other group participants and read or old messages', async () => {
  const recent = new Date().toISOString();
  const row = { conversation_id: 'group', sender_id: 'caleb', read_by: [], created_at: recent };
  const app = trustedService([
    row, { ...row },
    { ...row, sender_id: 'another-participant' },
    { ...row, sender_id: 'recipient' },
    { ...row, read_by: ['recipient'] },
    { ...row, conversation_id: 'another-group' },
    { ...row, created_at: new Date(Date.now() - 120_000).toISOString() },
  ]);
  await app.service.createNotification({
    userId: 'recipient', senderId: 'caleb', type: 'message',
    title: 'New message', message: 'Private text', relatedId: 'group', relatedType: 'conversation',
    data: { messageId: 'message' },
  });
  assert.equal(app.pushed.length, 1);
  assert.equal(app.pushed[0].data.fromUserName, 'Caleb');
  assert.equal(app.pushed[0].data.messageCount, 2);
  assert.equal(app.pushed[0].data.conversationId, 'group');
});

test('a grouped notification suppressed by persistence does not send another push', async () => {
  const app = trustedService([], { shouldPush: false });
  await app.service.createNotification({
    userId: 'recipient', senderId: 'caleb', type: 'post_like',
    title: 'New like', message: 'Caleb liked your post.', relatedId: 'post', relatedType: 'post',
  });
  assert.equal(app.pushed.length, 0);
});

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
