#!/usr/bin/env node
/**
 * Fail-fast audit for the source migration history used to provision fresh
 * Supabase branches. Read-only: never connects to any database.
 *
 * This is intentionally conservative. It proves missing foundational tables,
 * not the completeness of a repaired schema. A clean Postgres migration replay
 * and security-policy comparison are still required before accepting a fix.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve('supabase/migrations');
const files = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
const essential = ['users', 'posts', 'events', 'ticket_tiers'];
const created = new Map();
const firstReference = new Map();
const malformedNames = [];

for (const file of files) {
  if (!/^\d{14}_[a-z\d_-]+\.sql$/i.test(file)) malformedNames.push(file);
  const sql = readFileSync(join(dir, file), 'utf8');
  // Ignore comments when looking for SQL table references.
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  for (const table of essential) {
    const name = `(?:public\\.)?["']?${table}["']?`;
    const create = new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`, 'i');
    const use = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES|ALTER\\s+TABLE)\\s+(?:ONLY\\s+)?${name}\\b`, 'i');
    const c = create.exec(code);
    const u = use.exec(code);
    if (u && !created.has(table) && (!c || u.index < c.index) && !firstReference.has(table)) {
      firstReference.set(table, file);
    }
    if (c && !created.has(table)) created.set(table, file);
  }
}

const findings = essential
  .filter(table => firstReference.has(table))
  .map(table => ({
    table: `public.${table}`,
    usedBeforeCreation: firstReference.get(table),
    firstCreate: created.get(table) || 'none in migration source',
  }));

console.log(JSON.stringify({
  migrationsInspected: files.length,
  essentialTableDependencyFailures: findings,
  invalidMigrationFilenames: malformedNames,
}, null, 2));

if (findings.length || malformedNames.length) {
  console.error('FAIL: fresh-branch migrations are not yet reproducibly bootstrapped.');
  process.exitCode = 1;
} else {
  console.log('Static table dependency preflight passed. Still run real clean-db replay.');
}
