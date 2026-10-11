import { spawnSync } from 'node:child_process';
import { readQaEnv } from './qa-common.mjs';

const { env } = await readQaEnv();
const values = {
  QA_SUPABASE_URL: env.SUPABASE_URL,
  QA_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  QA_SUPABASE_SECRET_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  QA_PAYLUK_SECRET_KEY: env.PAYLUK_SECRET_KEY,
  QA_PAYLUK_PUBLIC_KEY: env.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY,
};
for (const role of ['BUYER', 'SELLER', 'ORGANIZER', 'ADMIN', 'NON_ADMIN']) {
  for (const field of ['EMAIL', 'PASSWORD']) values[`QA_${role}_${field}`] = env[`QA_${role}_${field}`];
}
if (Object.values(values).some(v => !v)) throw new Error('Missing QA secret');
if (!values.QA_PAYLUK_SECRET_KEY.startsWith('sk_test_') || !values.QA_PAYLUK_PUBLIC_KEY.startsWith('pk_test_')) throw new Error('Refusing live payment credentials');
for (const [name, value] of Object.entries(values)) {
  // Values go exclusively through stdin; never through argv or terminal output.
  const result = spawnSync('gh', ['secret', 'set', name, '--env', 'yrdly-qa', '--repo', 'Yrdly-ng/yrdly-app'], { input: value, stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`Unable to store ${name}; GitHub returned exit ${result.status}`);
  console.log(`Stored protected environment secret: ${name}`);
}
