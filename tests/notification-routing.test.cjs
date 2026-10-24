const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(
  path.join(__dirname, '../src/lib/notifications/notification-routing.ts'),
  'utf8'
);
const moduleResult = { exports: {} };
new Function(
  'module',
  'exports',
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
)(moduleResult, moduleResult.exports);
const r = moduleResult.exports;
const mobile = !!r.getMobileNotificationDestination;
const route = r.getMobileNotificationDestination || r.getNotificationDestination;
const choose = (web, native) => (mobile ? native : web);
const cases = [
  ...[
    'friend_request',
    'friend_request_accepted',
    'friend_request_declined',
    'new_follower',
    'profile_view',
  ].map((type) => [
    type,
    { fromUserId: 'actor' },
    '/profile/actor',
    '/profile/actor',
    'public_profiles',
    'actor',
  ]),
  ...['message', 'message_reaction', 'marketplace_message'].map((type) => [
    type,
    { conversationId: 'chat' },
    '/messages/chat',
    '/chat/chat',
    'conversations',
    'chat',
  ]),
  ...['post_like', 'post_comment', 'post_share', 'mention'].map((type) => [
    type,
    { postId: 'post' },
    '/posts/post',
    `/posts/post${type === 'post_comment' ? '?focusComments=true' : ''}`,
    'posts',
    'post',
  ]),
  ...['event_invite', 'event_reminder', 'event_updated', 'event_cancelled'].map((type) => [
    type,
    { eventId: 'event' },
    '/events/event',
    '/events/event',
    'events',
    'event',
  ]),
  ...['ticket', 'ticket_purchase', 'ticket_confirmed', 'event_rsvp'].map((type) => [
    type,
    { ticketId: 'ticket' },
    '/my-tickets',
    '/tickets',
    'tickets',
    'ticket',
  ]),
  ...['catalog_item_inquiry', 'catalog_item_out_of_stock'].map((type) => [
    type,
    { businessId: 'biz', itemId: 'item' },
    '/businesses/biz/catalog/item',
    '/businesses/catalog/item',
    'catalog_items',
    'item',
  ]),
  [
    'business_review_received',
    { businessId: 'biz' },
    '/businesses/biz?tab=reviews',
    '/businesses/biz?tab=reviews',
    'businesses',
    'biz',
  ],
  ...[
    'booking_requested',
    'booking_confirmed',
    'booking_declined',
    'booking_cancelled',
    'booking_late_cancelled',
    'booking_no_show',
    'booking_reminder',
    'appeal_decided',
  ].map((type) => [
    type,
    { bookingId: 'booking' },
    '/bookings/booking',
    '/bookings/booking',
    'bookings',
    'booking',
  ]),
  ...['quote_estimated', 'quote_converted'].map((type) => [type, {}, '/bookings', '/bookings']),
  ...['marketplace_item_sold', 'marketplace_item_interest'].map((type) => [
    type,
    { itemId: 'item' },
    '/marketplace/item',
    '/marketplace/item',
    'posts',
    'item',
  ]),
  ...[
    'payment_successful',
    'payment_refunded',
    'item_shipped',
    'delivery_confirmed',
    'funds_released',
  ].map((type) => [
    type,
    { transactionId: 'tx' },
    '/transactions/tx',
    '/transactions/tx',
    'escrow_transactions',
    'tx',
  ]),
  ...['dispute_opened', 'dispute_resolved'].map((type) => [
    type,
    { disputeId: 'dispute' },
    '/disputes/dispute',
    '/disputes/dispute',
    'disputes',
    'dispute',
  ]),
  ...['payout_processed', 'payout_failed'].map((type) => [
    type,
    {},
    '/profile/payouts',
    '/settings/payouts',
  ]),
  ...['safety_alert', 'alert'].map((type) => [
    type,
    { alertId: 'alert', id: 'notification' },
    '/alerts/alert',
    '/alert/alert',
    'alerts',
    'alert',
  ]),
  [
    'community_update',
    { communityId: 'community', postId: 'post' },
    '/communities/community/posts/post',
    '/communities/community/posts/post',
    'community_posts',
    'post',
  ],
  ...['welcome', 'system_announcement', 'unknown'].map((type) => [
    type,
    {},
    '/notifications',
    '/notifications',
  ]),
];
for (const [type, data, web, native, table, id] of cases) {
  test(`${type}: row, native push, and nested browser push resolve the same source`, () => {
    const expected = choose(web, native);
    assert.equal(route({ type, data }), expected);
    assert.equal(r.getPushNotificationDestination({ type, ...data }), expected);
    assert.equal(
      r.getPushNotificationDestination({ title: 'Yrdly', data: { type, ...data } }),
      expected
    );
    if (table) {
      const target = r.getNotificationTarget({ type, data });
      assert.equal(target.table, table);
      assert.equal(target.id, id);
    }
  });
}
test('actor conversation inquiries use related_type rather than treating chat IDs as items', () => {
  const row = {
    type: 'catalog_item_inquiry',
    related_id: 'conversation',
    related_type: 'conversation',
    data: {},
  };
  assert.equal(route(row), choose('/messages/conversation', '/chat/conversation'));
  assert.equal(r.getNotificationTarget(row).table, 'conversations');
});
test('review and appeal IDs never masquerade as business or booking IDs', () => {
  assert.equal(
    route({ type: 'business_review_received', relatedId: 'review' }),
    choose('/businesses', '/(tabs)/catalog')
  );
  assert.equal(route({ type: 'appeal_decided', relatedId: 'appeal' }), '/bookings');
  assert.equal(
    r.getNotificationTarget({ type: 'business_review_received', relatedId: 'review' }),
    null
  );
  assert.equal(r.getNotificationTarget({ type: 'appeal_decided', relatedId: 'appeal' }), null);
});
test('IDs override stale URLs; foreign origins and nonexistent routes are rejected', () => {
  for (const url of [
    'https://evil.example/posts/stale',
    '//evil.example/posts/stale',
    'javascript:alert(1)',
    '/missing/route',
    '/',
  ]) {
    assert.equal(
      r.getPushNotificationDestination({ type: 'post_like', postId: 'real', url }),
      '/posts/real'
    );
    assert.equal(r.getPushNotificationDestination({ url }), '/notifications');
  }
});
test('safe legacy URL-only notifications get source checks', () => {
  assert.equal(
    r.getPushNotificationDestination({ type: 'message', url: '/messages/chat' }),
    choose('/messages/chat', '/chat/chat')
  );
  assert.equal(r.getNotificationTarget({ type: 'message', url: '/messages/chat' }).id, 'chat');
  assert.equal(r.getNotificationTarget({ url: '/profile/payout-settings' }), null);
});
test('missing and inaccessible targets fall back; network errors stay retryable', async () => {
  const input = { type: 'post_like', postId: 'post' };
  const found = await r.resolveNotificationNavigation(input, async () => ({ found: true }));
  assert.deepEqual(found, { destination: '/posts/post', unavailable: false, failed: false });
  const missing = await r.resolveNotificationNavigation(input, async () => ({ found: false }));
  assert.equal(missing.destination, choose('/home', '/(tabs)'));
  assert.equal(missing.unavailable, true);
  const failure = await r.resolveNotificationNavigation(input, async () => ({
    found: false,
    error: new Error('offline'),
  }));
  assert.equal(failure.failed, true);
  assert.equal(failure.unavailable, false);
});
test('both alert tables are supported without confusing notification IDs', async () => {
  const calls = [];
  const result = await r.resolveNotificationNavigation(
    { type: 'alert', alertId: 'alert', id: 'notification' },
    async (table, id) => {
      calls.push([table, id]);
      return { found: table === 'safety_alerts' };
    }
  );
  assert.deepEqual(calls, [
    ['alerts', 'alert'],
    ['safety_alerts', 'alert'],
  ]);
  assert.equal(result.unavailable, false);
});

test('booking payments and converted quotes open bookings, not transaction or quote IDs', () => {
  for (const input of [
    { type: 'payment_successful', related_id: 'booking', related_type: 'booking', data: {} },
    { type: 'payment_successful', data: { bookingId: 'booking' } },
    {
      type: 'quote_converted',
      related_id: 'quote',
      related_type: 'quote',
      data: { bookingId: 'booking' },
    },
  ]) {
    assert.equal(route(input), '/bookings/booking');
    assert.equal(r.getNotificationTarget(input).table, 'bookings');
    assert.equal(r.getNotificationTarget(input).id, 'booking');
  }
});
test('alert rows use related alert ID rather than the notification row primary key', () => {
  const input = { id: 'notification', type: 'alert', related_id: 'alert', data: {} };
  assert.equal(route(input), choose('/alerts/alert', '/alert/alert'));
  assert.equal(r.getNotificationTarget(input).id, 'alert');
});
test('legacy catalog chat URLs resolve to an existing screen and validate the item', () => {
  const input = { url: '/businesses/business/catalog/item/chat' };
  assert.equal(
    r.getPushNotificationDestination(input),
    choose(input.url, '/businesses/catalog/item')
  );
  assert.equal(r.getNotificationTarget(input).table, 'catalog_items');
  assert.equal(r.getNotificationTarget(input).id, 'item');
});

test('missing community posts only fall back to a community the user can still access', async () => {
  const input = { type: 'community_update', communityId: 'community', postId: 'post' };
  const publicParent = await r.resolveNotificationNavigation(input, async (table) => ({
    found: table === 'communities',
  }));
  assert.equal(publicParent.destination, '/communities/community');
  const privateParent = await r.resolveNotificationNavigation(input, async () => ({
    found: false,
  }));
  assert.equal(privateParent.destination, '/communities');
  assert.equal(privateParent.unavailable, true);
});
test('a partial alert lookup outage does not falsely report that an existing alert was deleted', async () => {
  const result = await r.resolveNotificationNavigation(
    { type: 'alert', alertId: 'alert' },
    async (table) => ({
      found: false,
      error: table === 'safety_alerts' ? new Error('offline') : null,
    })
  );
  assert.equal(result.failed, true);
  assert.equal(result.unavailable, false);
});
test('legacy database rows preserve sender and snake-case source IDs', () => {
  assert.equal(
    route({ type: 'friend_request', related_id: 'actor', sender_id: 'actor', data: {} }),
    '/profile/actor'
  );
  assert.equal(
    route({ type: 'message', data: { conversation_id: 'chat' } }),
    choose('/messages/chat', '/chat/chat')
  );
  assert.equal(
    route({ type: 'post_like', related_id: 'post', sender_id: 'actor', data: {} }),
    '/posts/post'
  );
});

test('legacy URLs cannot recursively reopen the notification guard', () => {
  const input = {
    url: '/posts/post?notificationTarget=%2Fposts%2Fpost&notificationId=old&recipientId=old&focusComments=true',
  };
  assert.equal(r.getPushNotificationDestination(input), '/posts/post?focusComments=true');
});

test('every generated destination and unavailable-target fallback has a real app route', () => {
  const root = path.join(__dirname, '../src/app', mobile ? '' : '(app)');
  function exists(destination) {
    const segments = destination.split(/[?#]/)[0].split('/').filter(Boolean);
    function match(directory, offset) {
      if (offset === segments.length) return fs.existsSync(path.join(directory, mobile ? 'index.tsx' : 'page.tsx'));
      const segment = segments[offset];
      if (mobile && offset === segments.length - 1 && fs.existsSync(path.join(directory, segment + '.tsx'))) return true;
      if (!fs.existsSync(directory)) return false;
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name === segment || /^\[[^\]]+\]$/.test(entry.name))) {
          if (match(path.join(directory, entry.name), offset + 1)) return true;
        }
        if (mobile && offset === segments.length - 1 && entry.isFile() && /^\[[^\]]+\]\.tsx$/.test(entry.name)) return true;
      }
      return false;
    }
    return match(root, 0);
  }
  for (const [type, data] of cases) {
    const input = { type, data };
    const destination = route(input);
    assert.ok(exists(destination), `${type} destination: ${destination}`);
    const target = r.getNotificationTarget(input);
    if (target) assert.ok(exists(target.fallback), `${type} fallback: ${target.fallback}`);
  }
});


test('event team invitations and access updates open assigned duties, never a guest ticket', () => {
  for (const type of ['event_team', 'event_team_invite', 'event_team_updated']) {
    assert.equal(route({ type, relatedId: 'event-id', data: { event_id: 'event-id' } }), '/events/team');
  }
});

test('organizer ticket-sale notifications open event management on web and mobile', () => {
  assert.equal(
    route({ type: 'ticket_purchase', data: { audience: 'organizer', eventId: 'event-id' } }),
    '/events/event-id/manage'
  );
});
