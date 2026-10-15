// Read-only compatibility checks against the isolated QA backend and sibling mobile source.
// Native UI, camera and payment WebView rendering require a device separately.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { readQaEnv, ROOT } from './qa-common.mjs';

const mobile = resolve(process.env.MOBILE_SOURCE_DIR || resolve(ROOT, '../yrdly-mobile'));
const { env, projectRef } = await readQaEnv();
const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await client.auth.signInWithPassword({ email: env.QA_BUYER_EMAIL, password: env.QA_BUYER_PASSWORD });
if (error || !data.session) throw new Error('Owned QA login failed');
const results = [];
const queries = new Map();
async function visitDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await visitDirectory(path); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
    function tableOf(node) {
      if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
      if (node.expression.name.text === 'from') return literal(node.arguments[0]);
      return tableOf(node.expression.expression);
    }
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'select') {
        const select = literal(node.arguments[0]);
        const table = tableOf(node.expression.expression);
        if (select && table && (table === 'public_profiles' || select.includes('public_profiles'))) {
          const key = JSON.stringify([table, select]);
          const callers = queries.get(key)?.callers || [];
          callers.push(relative(mobile, path)); queries.set(key, { table, select, callers });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
try {
  await visitDirectory(resolve(mobile, 'src'));
  assert.ok(queries.size > 20, 'Expected the mobile profile compatibility queries');
  for (const { table, select, callers } of queries.values()) {
    const result = await client.from(table).select(select).limit(1);
    results.push({ table, callers, passed: !result.error, ...(result.error ? { code: result.error.code } : {}) });
    console.log(`${result.error ? 'FAIL' : 'PASS'} mobile profile contract: ${table} (${callers[0]})`);
  }
  // Execute the real dependency-free mobile API transport with an owned QA session.
  const output = ts.transpileModule(await readFile(resolve(mobile, 'src/lib/network/api-client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', output)(module, module.exports);
  const base = env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
  assert.equal(new URL(base).hostname, 'localhost');
  const api = module.exports.createApiClient(base, async () => ({
    authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json',
  }));
  await assert.rejects(api.post('/api/moderation/check', { type: 'text', content: '' }), failure => failure.status === 400);
  await assert.rejects(api.post('/api/events/checkin', { event_id: 'invalid', ticket_code: 'invalid' }), failure => failure.status === 400);
  results.push({ name: 'mobile transport preserves real server validation errors', passed: true });
} finally {
  // Other QA suites have independent sessions for this same owned fixture.
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  await mkdir(resolve(ROOT, '.qa-artifacts'), { recursive: true });
  await writeFile(resolve(ROOT, '.qa-artifacts/mobile-contract-regression.json'), JSON.stringify({ projectRef, checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
}
const failed = results.filter(result => !result.passed);
console.log(`Mobile live contracts: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
