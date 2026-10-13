import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_PREFIX = 'YRDLY-QA';
export const QA_PROJECT_REF = 'jxgpvvehajxegeeozlnl';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = resolve(ROOT, '.env.qa');
export const OUTPUT_PATH = resolve(ROOT, 'qa-seed-output.json');
const LOCAL_ENV_PATH = resolve(ROOT, '.env.local');

export function deterministicUuid(label) {
  const hex = createHash('sha256').update(`${QA_PROJECT_REF}:${label}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function readQaEnv() {
  let raw;
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch {
    throw new Error('Missing yrdly-app/.env.qa');
  }
  const env = parse(raw);
  env.SUPABASE_URL ||= env.NEXT_PUBLIC_SUPABASE_URL;
  env.SUPABASE_SERVICE_ROLE_KEY ||= env.SUPABASE_SECRET_KEY;
  env.NEXT_PUBLIC_SUPABASE_URL ||= env.SUPABASE_URL;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= env.SUPABASE_PUBLISHABLE_KEY;
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required .env.qa values: ${missing.join(', ')}`);

  const target = new URL(env.SUPABASE_URL);
  const ref = target.hostname.endsWith('.supabase.co') ? target.hostname.split('.')[0] : '';
  if (target.protocol !== 'https:' || !ref) throw new Error('Refusing non-Supabase or non-HTTPS SUPABASE_URL');
  if (env.QA_ENVIRONMENT !== 'staging') throw new Error('Refusing to run: QA_ENVIRONMENT must be staging');
  if (env.QA_EXPECTED_PROJECT_REF !== ref || ref !== QA_PROJECT_REF) {
    throw new Error('Refusing to run: SUPABASE_URL does not match the allowlisted QA project ref');
  }

  try {
    const local = parse(await readFile(LOCAL_ENV_PATH, 'utf8'));
    const localUrl = local.NEXT_PUBLIC_SUPABASE_URL || local.SUPABASE_URL;
    if (localUrl && new URL(localUrl).hostname === target.hostname) {
      throw new Error('Refusing to run: QA and local Supabase URLs are the same project');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to run:')) throw error;
    // .env.local is optional; the exact QA project ref allowlist remains mandatory.
  }

  return { env, projectRef: ref };
}

export async function updateQaEnv(values) {
  let raw = await readFile(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (pattern.test(raw)) raw = raw.replace(pattern, () => line);
    else raw += `${raw.endsWith('\n') || raw.length === 0 ? '' : '\n'}${line}\n`;
  }
  await writeFile(ENV_PATH, raw, { mode: 0o600 });
  await chmod(ENV_PATH, 0o600);
}

export function createAdminClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function generatePassword() {
  return `QA-${randomBytes(24).toString('base64url')}-aA1!`;
}

export async function saveOutput(output) {
  const tempPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, OUTPUT_PATH);
  await chmod(OUTPUT_PATH, 0o600);
}

export async function readOutput() {
  const output = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  if (output.qaPrefix !== QA_PREFIX) throw new Error('Refusing cleanup: output file is not tagged as YRDLY QA data');
  const { projectRef } = await readQaEnv();
  if (output.projectRef !== projectRef) throw new Error('Refusing cleanup: output belongs to a different Supabase project');
  return output;
}
