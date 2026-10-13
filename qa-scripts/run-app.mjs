import { spawn } from 'node:child_process';
import { readQaEnv, ROOT } from './qa-common.mjs';

const mode = process.argv[2] || 'dev';
if (!['dev', 'build', 'start'].includes(mode)) throw new Error('Use dev, build or start');
const { env: qa } = await readQaEnv();
if (!qa.NEXT_PUBLIC_SUPABASE_ANON_KEY || !qa.PAYLUK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('QA public database key and Payluk test key are required');
}
// Never inherit production provider credentials from the parent shell or .env.local.
const env = { ...process.env, ...qa, YRDLY_QA_BUILD: 'true', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['RESEND_API_KEY', 'TERMII_API_KEY', 'CRON_SECRET', 'VAPID_PRIVATE_KEY']) {
  env[key] = qa[key] || '';
}
env.PAYLUK_BASE_URL = 'https://staging.api.payluk.ng';
env.NEXT_PUBLIC_APP_URL = qa.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
const args = [mode, ...(mode === 'build' ? [] : ['-H', '127.0.0.1', '-p', '9002'])];
console.log(`Starting ${mode} against verified isolated QA backend`);
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...args], {
  cwd: ROOT, env, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('QA app process could not start'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
