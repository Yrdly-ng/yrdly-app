// Configure only the explicitly approved main-project sandbox. Keys use stdin.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const link = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
if (link.projectId !== 'prj_OzlnXKjvwAnaDjWqbtEl2gfLhPEx') throw new Error('Unexpected Vercel project.');
if (!process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Only a test key is permitted.');
const projectRef = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${projectRef}.supabase.co`) throw new Error('Supabase project mismatch.');
const settings = {
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  PAYSTACK_SANDBOX_PROJECT_REF: projectRef,
  PAYSTACK_TEST_ON_MAIN: 'true',
  PAYSTACK_TEST_ALLOW_ALL_USERS: 'true',
  PAYSTACK_LIVE_ENABLED: 'false',
  PAYSTACK_MANUAL_PAYOUTS_ENABLED: 'false',
  PAYSTACK_EVENT_OPERATIONS_APPROVED: 'false',
  PAYSTACK_EVENT_CHECKOUT_ENABLED: 'true',
};
for (const [key, value] of Object.entries(settings)) {
  const result = spawnSync('vercel', ['env', 'add', key, 'production', '--force', '--yes',
    key === 'PAYSTACK_SECRET_KEY' ? '--sensitive' : '--no-sensitive', '--scope', 'calebs-projects-98954387'], {
    input: value, encoding: 'utf8', timeout: 60000, env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
  });
  // Never forward CLI output that might contain credential material.
  if (result.status !== 0) throw new Error(`Could not configure ${key} (exit ${result.status}). No credential output printed.`);
  console.log(`Configured ${key} for production sandbox.`);
}
