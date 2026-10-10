// Delivery tests target only the explicitly authorized local QA destination.
import { createClient } from '@supabase/supabase-js';
import { writeFile, readFile, mkdir, chmod } from 'node:fs/promises';
import { Resend } from 'resend';
import { readQaEnv, createAdminClient, generatePassword, updateQaEnv, QA_PREFIX } from './qa-common.mjs';

const mode = process.argv[2] || 'inspect';
if (!['inspect', 'signup', 'resend', 'confirm', 'reset'].includes(mode)) throw new Error('Use inspect, signup, resend, confirm or reset');
const { env } = await readQaEnv();
const settingsResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(15000) });
if (!settingsResponse.ok) throw new Error(`QA Auth settings unavailable: HTTP ${settingsResponse.status}`);
const settings = await settingsResponse.json();
console.log(JSON.stringify({ operation: 'inspect isolated Auth settings', emailEnabled: settings.external?.email, googleEnabled: settings.external?.google, signupDisabled: settings.disable_signup, emailAutoConfirmed: settings.mailer_autoconfirm }));
if (mode !== 'inspect') {
  if (!env.QA_DELIVERY_EMAIL) throw new Error('Authorized QA delivery email required');
  const client = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) } });
  let signup;
  if (mode === 'confirm' || mode === 'resend') {
    signup = JSON.parse(await readFile('.qa-artifacts/auth-signup-delivery.json', 'utf8'));
    const account = await createAdminClient(env).auth.admin.getUserById(signup.userId);
    if (account.error || account.data.user.email !== env.QA_DELIVERY_EMAIL || account.data.user.user_metadata.qa_prefix !== QA_PREFIX || account.data.user.user_metadata.qa_role !== 'auth_delivery') throw new Error('Owned QA signup fixture required');
  }
  if (mode === 'confirm') {
    if (!env.RESEND_API_KEY) throw new Error('QA email delivery lookup key required');
    const resend = new Resend(env.RESEND_API_KEY);
    let message;
    for (let attempt = 0; attempt < 6 && !message; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
      const list = await resend.emails.list({ limit: 30 });
      if (list.error) throw new Error('QA signup delivery lookup unavailable');
      const match = list.data.data.find(row => row.to.includes(env.QA_DELIVERY_EMAIL) && /confirm.*sign|sign.*confirm/i.test(row.subject) && new Date(row.created_at).getTime() >= new Date(signup.checkedAt).getTime() - 2000 && ['delivered', 'opened', 'clicked'].includes(row.last_event));
      if (match) {
        const email = await resend.emails.get(match.id);
        if (email.error || !email.data.to.includes(env.QA_DELIVERY_EMAIL)) throw new Error('Controlled signup message required');
        message = email.data;
      }
    }
    if (!message) throw new Error('Signup email not yet delivered; do not resend blindly');
    const codes = [...new Set([...(message.html || '').matchAll(/>\s*(\d{6})\s*</g)].map(match => match[1]))];
    if (codes.length !== 1) throw new Error('A single signup email OTP is required; values withheld');
    const verification = await client.auth.verifyOtp({ email: env.QA_DELIVERY_EMAIL, token: codes[0], type: 'signup' });
    const replayClient = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const replay = await replayClient.auth.verifyOtp({ email: env.QA_DELIVERY_EMAIL, token: codes[0], type: 'signup' });
    const evidence = { checkedAt: new Date().toISOString(), operation: 'Real signup email OTP verification', providerDelivered: true, confirmed: Boolean(verification.data.user?.email_confirmed_at), hasSession: Boolean(verification.data.session), errorCode: verification.error?.code || null, replayRejected: Boolean(replay.error && !replay.data.session) };
    await mkdir('.qa-artifacts', { recursive: true });
    await writeFile('.qa-artifacts/auth-confirmation.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
    await chmod('.qa-artifacts/auth-confirmation.json', 0o600);
    console.log(JSON.stringify(evidence));
    await client.auth.signOut();
    if (replay.data.session) await replayClient.auth.signOut();
    if (verification.error || !evidence.confirmed || !evidence.replayRejected) process.exitCode = 1;
    process.exit(process.exitCode || 0);
  }
  let result;
  if (mode === 'signup') {
    const password = env.QA_AUTH_DELIVERY_PASSWORD || generatePassword();
    await updateQaEnv({ QA_AUTH_DELIVERY_PASSWORD: password });
    result = await client.auth.signUp({ email: env.QA_DELIVERY_EMAIL, password, options: { emailRedirectTo: 'https://yrdly-app-qa.vercel.app/auth/callback', data: { name: `${QA_PREFIX} Auth delivery`, qa_prefix: QA_PREFIX, qa_role: 'auth_delivery' } } });
  } else if (mode === 'resend') {
    result = await client.auth.resend({ email: env.QA_DELIVERY_EMAIL, type: 'signup', options: { emailRedirectTo: 'https://yrdly-app-qa.vercel.app/auth/callback' } });
  } else {
    result = await client.auth.resetPasswordForEmail(env.QA_DELIVERY_EMAIL, { redirectTo: 'https://yrdly-app-qa.vercel.app/reset-password' });
  }
  const evidence = { checkedAt: new Date().toISOString(), operation: mode, errorCode: result.error?.code || null, status: result.error?.status || 200, userId: result.data?.user?.id || signup?.userId || null, confirmed: Boolean(result.data?.user?.email_confirmed_at), hasSession: Boolean(result.data?.session) };
  await mkdir('.qa-artifacts', { recursive: true });
  const evidencePath = `.qa-artifacts/auth-${mode === 'resend' ? 'signup' : mode}-delivery.json`;
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await chmod(evidencePath, 0o600);
  console.log(JSON.stringify({ operation: `${mode} delivery request`, httpStatus: evidence.status, errorCode: evidence.errorCode, emailConfirmed: evidence.confirmed, hasSession: evidence.hasSession }));
  if (result.error) process.exitCode = 1;
}
