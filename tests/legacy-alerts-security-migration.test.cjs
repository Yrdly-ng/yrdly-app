const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const sql = readFileSync(
  'supabase/migrations/20261128130600_lock_legacy_alerts_to_admins.sql',
  'utf8'
);

test('legacy alerts migration removes permissive select and session policies', () => {
  assert.match(sql, /DROP POLICY IF EXISTS "Authenticated users can read alerts"/i);
  assert.match(sql, /DROP POLICY IF EXISTS "active_account_session"/i);
});

test('legacy alerts denies anonymous and public table privileges', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.alerts FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.alerts TO authenticated/i);
});

test('all legacy alert operations require an active admin account', () => {
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`CREATE POLICY "legacy alerts admin ${operation}"\\s+ON public\\.alerts FOR ${operation.toUpperCase()} TO authenticated`, 'i'));
  }
  const policyBlocks = sql.split('CREATE POLICY').slice(1);
  assert.equal(policyBlocks.length, 4);
  for (const block of policyBlocks) {
    assert.match(block, /public\.is_current_session_active\(\)/i);
    assert.match(block, /users\.is_admin = true/i);
  }
});
