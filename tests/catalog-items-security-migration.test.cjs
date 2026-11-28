const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const sql = readFileSync('supabase/migrations/20261128131500_catalog_items_column_privileges.sql', 'utf8');

test('catalog migration removes wildcard public access and transaction identifiers', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.catalog_items FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(sql, /GRANT[^;]*transaction_id/i);
});

test('public catalog visibility is filtered to approved items and businesses', () => {
  assert.match(sql, /moderation_status = 'approved'/i);
  assert.match(sql, /businesses\.is_active = true/i);
  assert.match(sql, /businesses\.moderation_status = 'approved'/i);
  assert.match(sql, /businesses\.is_flagged = false/i);
});

test('owner access is session-checked and scoped to business ownership', () => {
  assert.match(sql, /DROP POLICY IF EXISTS "active_account_session"/i);
  assert.match(sql, /catalog owners manage own items[\s\S]*public\.is_current_session_active\(\)/i);
  assert.match(sql, /businesses\.owner_id = \(SELECT auth\.uid\(\)\)/i);
  assert.match(sql, /GRANT INSERT \([\s\S]*\) ON TABLE public\.catalog_items TO authenticated/i);
  assert.match(sql, /GRANT UPDATE \([\s\S]*\) ON TABLE public\.catalog_items TO authenticated/i);
});
