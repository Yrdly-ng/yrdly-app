const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

test('follows and DMs reach the actor API without a client profile or inbox lookup', async () => {
  const requests = [];
  const module = { exports: {} };
  const source = fs.readFileSync('src/lib/notifications/notification-triggers.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });

  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name === './notification-service') {
      return { NotificationService: { createNotification: async (payload) => requests.push(payload) } };
    }
    if (name === '../supabase/supabase') {
      return { supabase: { from: () => assert.fail('Unexpected client database lookup') } };
    }
    throw new Error(name);
  }, module, module.exports);

  const { NotificationTriggers } = module.exports;
  await NotificationTriggers.onNewFollower('sender', 'recipient');
  await NotificationTriggers.onMessageSent('recipient', 'conversation');
  await NotificationTriggers.onMessageSent('recipient', 'market-chat', 'marketplace_message');

  assert.deepEqual(
    requests.map(({ type, userId, relatedId }) => ({ type, userId, relatedId })),
    [
      { type: 'new_follower', userId: 'recipient', relatedId: 'sender' },
      { type: 'message', userId: 'recipient', relatedId: 'conversation' },
      { type: 'marketplace_message', userId: 'recipient', relatedId: 'market-chat' },
    ],
  );
});
