import { writeFile } from 'node:fs/promises';
import { readQaEnv } from './qa-common.mjs';

const values = {
  QA_ENVIRONMENT: 'staging',
  QA_EXPECTED_PROJECT_REF: 'jxgpvvehajxegeeozlnl',
  SUPABASE_URL: process.env.QA_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.QA_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.QA_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.QA_SUPABASE_SECRET_KEY,
  PAYLUK_SECRET_KEY: process.env.QA_PAYLUK_SECRET_KEY,
  NEXT_PUBLIC_PAYLUK_PUBLIC_KEY: process.env.QA_PAYLUK_PUBLIC_KEY,
  PAYLUK_BASE_URL: 'https://staging.api.payluk.ng',
  NEXT_PUBLIC_APP_URL: 'http://localhost:9002',
};
for (const role of ['BUYER', 'SELLER', 'ORGANIZER', 'ADMIN', 'NON_ADMIN']) {
  for (const field of ['EMAIL', 'PASSWORD']) values[`QA_${role}_${field}`] = process.env[`QA_${role}_${field}`];
}
if (Object.values(values).some(v => !v || /[\r\n]/.test(v))) throw new Error('Missing or invalid QA environment secret');
if (!values.PAYLUK_SECRET_KEY.startsWith('sk_test_') || !values.NEXT_PUBLIC_PAYLUK_PUBLIC_KEY.startsWith('pk_test_')) throw new Error('Refusing non-test payment keys');
await writeFile('.env.qa', Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
await readQaEnv();
console.log('Validated isolated QA configuration');
