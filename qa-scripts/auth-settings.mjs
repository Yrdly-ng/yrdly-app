// Changes only isolated QA: SMTP/redirect repair or leaked-password protection.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readQaEnv, QA_PROJECT_REF } from './qa-common.mjs';

const mode = process.argv[2] || 'inspect';
if (!['inspect', 'repair', 'protect-passwords'].includes(mode)) throw new Error('Use inspect, repair or protect-passwords');
const { env, projectRef } = await readQaEnv();
if (projectRef !== QA_PROJECT_REF) throw new Error('Isolated QA project required');
const token = process.env.SUPABASE_ACCESS_TOKEN || (await readFile(join(homedir(), '.supabase/access-token'), 'utf8')).trim();
if (!token.startsWith('sbp_')) throw new Error('Existing Supabase CLI access token required');
const url = `https://api.supabase.com/v1/projects/${QA_PROJECT_REF}/config/auth`;
async function request(body) {
  const response = await fetch(url, { method: body ? 'PATCH' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`QA Auth configuration request failed: HTTP ${response.status}`);
  return response.json();
}
try {
  const config = await request();
  const matchesResend = config.smtp_host === 'smtp.resend.com' && config.smtp_user === 'resend';
  console.log(JSON.stringify({ operation: 'inspect QA Auth configuration', smtpMatchesResend: matchesResend, smtpPasswordConfigured: Boolean(config.smtp_pass), smtpSenderUsesAppDomain: /@yrdly\.ng$/i.test(config.smtp_admin_email || ''), siteUsesQaHost: config.site_url === 'https://yrdly-app-qa.vercel.app', qaRedirectAllowed: (config.uri_allow_list || '').includes('https://yrdly-app-qa.vercel.app'), leakedPasswordProtectionEnabled: config.password_hibp_enabled === true }));
  if (mode === 'protect-passwords') {
    if (typeof config.password_hibp_enabled !== 'boolean') throw new Error('QA password security setting requires review');
    await request({ password_hibp_enabled: true });
    if ((await request()).password_hibp_enabled !== true) throw new Error('QA password protection verification failed');
    console.log('QA-only leaked-password protection enabled and read back successfully.');
  }
  if (mode === 'repair') {
    if (!matchesResend || !/@yrdly\.ng$/i.test(config.smtp_admin_email || '') || !env.RESEND_API_KEY) throw new Error('QA SMTP requires review before credentials can be changed');
    await request({ smtp_pass: env.RESEND_API_KEY, site_url: 'https://yrdly-app-qa.vercel.app', uri_allow_list: 'https://yrdly-app-qa.vercel.app/auth/callback**,https://yrdly-app-qa.vercel.app/reset-password,http://localhost:9002/**' });
    const after = await request();
    if (after.site_url !== 'https://yrdly-app-qa.vercel.app' || !(after.uri_allow_list || '').includes('https://yrdly-app-qa.vercel.app/auth/callback')) throw new Error('QA redirect verification failed');
    console.log('Updated QA-only SMTP password and signup/reset redirects. Delivery still requires a real test.');
  }
} catch (error) {
  console.error(error instanceof Error && /^QA |^Isolated /.test(error.message) ? error.message : 'QA Auth configuration unavailable; credential details withheld');
  process.exitCode = 1;
}
