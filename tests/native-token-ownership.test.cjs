const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const sender = fs.readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/process-push-notification-outbox/index.ts', 'utf8');

// Static release-contract tests for the Deno runtime, which CI does not execute
// against production accounts or send to real Expo push tokens.
test('both deployed functions remain syntactically valid TypeScript', () => {
  for (const [name, source] of [['sender', sender], ['outbox', worker]]) {
    const result = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
      fileName: name + '.ts',
    });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], name);
  }
});

test('native sender queues only the newest matching account and installation owner', () => {
  assert.ok(sender.includes('.select("id, device_id, push_token")'));
  assert.ok(sender.includes('.in("push_token", uniqueTokens)'));
  assert.ok(sender.includes('.order("updated_at", { ascending: false })'));
  assert.ok(sender.includes('latestByToken.set(owner.push_token, owner)'));
  assert.ok(sender.includes('current.id === row.id'));
  assert.ok(sender.includes('current.user_id === userId && current.device_id === row.device_id'));
  assert.ok(sender.includes('eligibleNativeTokenRows.map((tokenRow) => ({'));
  assert.ok(!sender.includes('validTokenRows.map((tokenRow) => ({'));
  assert.ok(sender.includes('skippedNativeRegistrations = validTokenRows.length'));
  assert.ok(sender.includes('channel !== "web"'));
});

test('outbox fails closed on old device rows and cross-account shared tokens', () => {
  assert.ok(worker.includes('.eq("push_token", tokenRow.push_token)'));
  assert.ok(worker.includes('.order("updated_at", { ascending: false })'));
  assert.ok(worker.includes('ownershipError || !tokenOwners || tokenOwners.length >= 501'));
  assert.ok(worker.includes('currentOwner.id !== tokenRow.id'));
  assert.ok(worker.includes('currentOwner.user_id !== delivery.user_id'));
  assert.ok(worker.includes('currentOwner.device_id !== delivery.device_id'));
  assert.ok(worker.includes('Superseded native token registration; avoiding wrong-account or duplicate push'));
  assert.ok(worker.includes('status: "skipped"'));
  assert.ok(worker.includes('status: "queued"') && worker.includes('Could not verify native push token ownership'));
  assert.ok(worker.includes('DAILY_PROMPT_PUSH_ENABLED'));
  assert.ok(worker.includes('notification_settings'));
});

test('a single real token never belongs to ten simultaneous devices or two accounts', () => {
  const rows = [
    { id: 'old-a', user_id: 'a', device_id: 'install-1', push_token: 'token-1', updated_at: '2026-10-19T00:00:00Z' },
    { id: 'old-b', user_id: 'a', device_id: 'install-2', push_token: 'token-1', updated_at: '2026-10-20T00:00:00Z' },
    { id: 'new', user_id: 'b', device_id: 'install-3', push_token: 'token-1', updated_at: '2026-11-09T00:00:00Z' },
    { id: 'other', user_id: 'c', device_id: 'install-4', push_token: 'token-2', updated_at: '2026-11-01T00:00:00Z' },
  ];
  const byToken = new Map();
  for (const row of rows.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    if (!byToken.has(row.push_token)) byToken.set(row.push_token, row);
  const eligible = rows.filter(row => byToken.get(row.push_token).id === row.id);
  assert.deepEqual(eligible.map(x => x.id), ['new', 'other']);
  assert.equal(eligible.filter(x => x.push_token === 'token-1').length, 1);
});

test('old provider and daily-prompt protections are retained', () => {
  assert.ok(worker.includes('"SENDER_ID_MISMATCH"'));
  assert.ok(worker.includes('isPermanentExpoError'));
  assert.ok(worker.includes('"DeviceNotRegistered"'));
  assert.ok(sender.includes('DAILY_PROMPT_PUSH_ENABLED'));
  assert.ok(sender.includes('webSkippedStale: staleWebSubscriptions'));
});
