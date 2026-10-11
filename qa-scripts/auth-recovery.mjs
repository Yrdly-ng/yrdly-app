// Real email recovery on the isolated project, restricted to our own QA account.
// Email links, PKCE verifiers and session cookies never enter console output.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { readQaEnv, createAdminClient, generatePassword, updateQaEnv, QA_PREFIX } from './qa-common.mjs';

const mode = process.argv[2] || 'run';
if (!['run', 'resume'].includes(mode)) throw new Error('Use run or resume');
const origin = 'https://yrdly-app-qa.vercel.app';
const contextPath = '.qa-artifacts/auth-recovery-context.json';
const evidencePath = '.qa-artifacts/auth-recovery.json';
const { env } = await readQaEnv();
assert.ok(env.QA_DELIVERY_EMAIL && env.RESEND_API_KEY && env.QA_AUTH_DELIVERY_PASSWORD, 'Local Auth delivery settings required');
await mkdir('.qa-artifacts', { recursive: true });
const signup = JSON.parse(await readFile('.qa-artifacts/auth-signup-delivery.json', 'utf8'));
const admin = createAdminClient(env);
const { data, error } = await admin.auth.admin.getUserById(signup.userId);
assert.ok(!error && data.user?.email === env.QA_DELIVERY_EMAIL && data.user.user_metadata.qa_prefix === QA_PREFIX && data.user.user_metadata.qa_role === 'auth_delivery', 'Owned QA Auth account required');
const context = mode === 'resume'
  ? JSON.parse(await readFile(contextPath, 'utf8'))
  : { requestedAt: new Date().toISOString(), userId: signup.userId, cookies: [] };
assert.equal(context.userId, signup.userId, 'Recovery context must match our QA account');
assert.ok(Date.now() - new Date(context.requestedAt).getTime() < 3600000, 'Recovery context expired');
const jar = new Map(context.cookies.map(({ name, value }) => [name, value]));
const timedFetch = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const makeClient = () => createServerClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookieOptions: { name: 'sb-yoiyqxtpmxnrrbqqidcs-auth-token', path: '/', sameSite: 'lax', secure: true },
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)) },
  global: { fetch: timedFetch },
});
async function savePrivate(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
}
const evidence = { checkedAt: new Date().toISOString(), operation: 'Real QA email password recovery', checks: [] };
let loginClient;
try {
  let callbackUrl;
  if (mode === 'run') {
    const result = await makeClient().auth.resetPasswordForEmail(env.QA_DELIVERY_EMAIL, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
    assert.ok(!result.error, `QA recovery request failed: ${result.error?.code || 'unknown'}`);
    evidence.checks.push({ name: 'Recovery request accepted', passed: true });
    await savePrivate(contextPath, { ...context, cookies: [...jar].map(([name, value]) => ({ name, value })) });
    const resend = new Resend(env.RESEND_API_KEY);
    let message;
    for (let attempt = 0; attempt < 6 && !message; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
      const list = await resend.emails.list({ limit: 30 });
      assert.ok(!list.error, 'Resend delivery lookup unavailable');
      const match = list.data.data.find(row => row.to.includes(env.QA_DELIVERY_EMAIL) && /reset|recovery/i.test(row.subject) && new Date(row.created_at).getTime() >= new Date(context.requestedAt).getTime() - 2000 && ['delivered', 'opened', 'clicked'].includes(row.last_event));
      if (match) {
        const email = await resend.emails.get(match.id);
        assert.ok(!email.error && email.data.to.includes(env.QA_DELIVERY_EMAIL), 'Controlled recovery email required');
        message = email.data;
      }
    }
    assert.ok(message, 'Recovery email not yet delivered; do not resend blindly');
    evidence.checks.push({ name: 'Recovery email delivered by Resend', passed: true });
    const links = [...(message.html || '').matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1].replaceAll('&amp;', '&'));
    const verification = links.map(link => { try { return new URL(link); } catch { return null; } }).find(url => url?.origin === env.SUPABASE_URL && url.pathname === '/auth/v1/verify' && url.searchParams.get('type') === 'recovery');
    assert.ok(verification, 'QA-only recovery verification URL required');
    const response = await fetch(verification, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.ok(response.status >= 300 && response.status < 400, 'QA recovery must redirect');
    callbackUrl = new URL(response.headers.get('location'));
    assert.equal(callbackUrl.origin, origin, 'Recovery must stay on the hosted QA application');
    assert.equal(callbackUrl.pathname, '/auth/callback', 'Recovery must reach the application callback');
    assert.ok(callbackUrl.searchParams.has('code') && !callbackUrl.searchParams.has('error'), 'PKCE authorization code required');
    evidence.checks.push({ name: 'Email verification returns a QA PKCE callback', passed: true });
  } else {
    callbackUrl = new URL('/auth/callback?next=/reset-password', origin);
  }
  const callback = await fetch(callbackUrl, { redirect: 'manual', headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }, signal: AbortSignal.timeout(30000) });
  for (const header of callback.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0];
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value) jar.set(name, value); else jar.delete(name);
  }
  await savePrivate(contextPath, { ...context, cookies: [...jar].map(([name, value]) => ({ name, value })) });
  const target = new URL(callback.headers.get('location') || '/', origin);
  evidence.callbackStatus = callback.status;
  evidence.callbackPath = target.pathname;
  assert.equal(target.origin, origin, 'Callback must stay on QA');
  assert.equal(target.pathname, '/reset-password', 'Recovery must reach password reset before onboarding');
  evidence.checks.push({ name: 'Hosted callback preserves recovery for an incomplete profile', passed: true });
  const recovery = makeClient();
  const verified = await recovery.auth.getUser();
  assert.equal(verified.data.user?.id, signup.userId, 'Recovery session must belong to the controlled QA user');
  const password = generatePassword();
  const update = await recovery.auth.updateUser({ password });
  assert.ok(!update.error, `QA password update failed: ${update.error?.code || 'unknown'}`);
  await updateQaEnv({ QA_AUTH_DELIVERY_PASSWORD: password });
  evidence.checks.push({ name: 'Recovery session can update its password', passed: true });
  loginClient = createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
  const login = await loginClient.auth.signInWithPassword({ email: env.QA_DELIVERY_EMAIL, password });
  assert.equal(login.data.user?.id, signup.userId, 'New QA password must work');
  evidence.checks.push({ name: 'New password signs in successfully', passed: true });
  const oldLogin = await createClient(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } }).auth.signInWithPassword({ email: env.QA_DELIVERY_EMAIL, password: env.QA_AUTH_DELIVERY_PASSWORD });
  assert.ok(oldLogin.error && !oldLogin.data.session, 'Old QA password must no longer work');
  evidence.checks.push({ name: 'Previous password is rejected', passed: true });
} catch (error) {
  evidence.checks.push({ name: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Recovery network or provider operation failed; details withheld', passed: false });
  process.exitCode = 1;
} finally {
  if (loginClient) await loginClient.auth.signOut();
  // Keep a retryable private context only when the callback needs investigation.
  if (!process.exitCode) await savePrivate(contextPath, { requestedAt: context.requestedAt, userId: signup.userId, cookies: [] });
  await savePrivate(evidencePath, evidence);
  for (const check of evidence.checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`);
  if (evidence.callbackPath) console.log(`Hosted recovery redirect: ${evidence.callbackPath}`);
}
