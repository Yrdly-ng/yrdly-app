const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const sql = readFileSync(
  'supabase/migrations/20261128130600_lock_legacy_alerts_to_admins.sql',
  'utf8'
);

test('legacy alerts migration removes permissive select and session policies', () => {
  assert.match(sql, /DROP POLICY IF NOT EXISTS "Authenticated users can read alerts"/i);
  assert.match(sql, /DROP POLICY IF NOT EXISTS "active_account_session"/i);
});

test('legacy alerts denies anonymous and public table privileges', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.alerts FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.alerts TO authenticated/i);
});

test('all legacy alert operations require an active admin account', () => {
  for (const [operation, verb] of [['select', 'SELECT'], ['insert', 'INSERT'], ['update', 'UPDATE'], ['delete', 'DELETE']]) {
    const pattern = new RegExp('CREATE POLICY "legacy alerts admin ' + operation + '"\\s+ON public\\.alerts FOR ' + verb + ' TO authenticated', 'i');
    assert.match(sql, pattern);
  }
  const policyBlocks = sql.split('CREATE POLICY').slice(1);
  assert.equal(policyBlocks.length, 4);
  for (const block of policyBlocks) {
    assert.match(block, /public\.is_current_session_active\(\)/i);
    assert.match(block, /users\.is_admin = true/i);
  }
});

test('migration changes access rules only and does not mutate or remove alert records', () => {
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\.alerts\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\s+(?:TABLE\s+)?public\.alerts\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\s+public\.alerts\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.alerts\s+SET\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+public\.alerts\s+DROP\s+COLUMN\b/i);
});
