import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

function qaClients() {
  const env = parse(readFileSync('.env.qa', 'utf8'));
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (env.QA_ENVIRONMENT !== 'staging' || env.QA_EXPECTED_PROJECT_REF !== 'jxgpvvehajxegeeozlnl' ||
      new URL(url).hostname !== 'jxgpvvehajxegeeozlnl.supabase.co') {
    throw new Error('Auth browser tests require the isolated QA backend');
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    env, url,
    admin: createClient(url, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, options),
    publicClient: () => createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options),
  };
}

test('signup validation and email-verification handoff render at three breakpoints', async ({ page }) => {
  qaClients();
  let requests = 0;
  // Delivery is verified separately with the controlled mailbox. Do not send
  // email to synthetic identities merely to exercise the browser form.
  await page.route('**/auth/v1/signup**', async route => {
    requests++;
    const body = route.request().postDataJSON();
    expect(body.data.name).toBe('YRDLY-QA Browser Signup');
    expect(body.email).toBe('yrdly-qa-browser@example.invalid');
    await route.fulfill({ json: { user: {
      id: randomUUID(), email: body.email, identities: [{ provider: 'email' }],
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: body.data,
      created_at: new Date().toISOString(), aud: 'authenticated', role: 'authenticated',
    }, session: null } });
  });
  for (const width of [375,768,1440]) {
    const before = requests;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login?next=%2Fmarketplace');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create an account', exact: true })).toBeVisible();
    await page.getByPlaceholder('Full name', { exact: true }).fill('YRDLY-QA Browser Signup');
    await page.getByPlaceholder('Email address', { exact: true }).fill('yrdly-qa-browser@example.invalid');
    await page.getByPlaceholder('Password', { exact: true }).fill('weak');
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(page.getByText('Please create a strong password meeting all 4 requirements below', { exact: true })).toBeVisible();
    expect(requests).toBe(before);
    await page.getByPlaceholder('Password', { exact: true }).fill('QaBrowser!2026');
    await page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/verify-email\?/);
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('next')).toBe('/marketplace');
    expect(requests).toBe(before + 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-signup-verification.png`, fullPage: true });
  }
});

test('forgot-password form sends the recovery callback and renders acceptance', async ({ page, baseURL }) => {
  const { env } = qaClients();
  let requests = 0;
  await page.route('**/auth/v1/recover**', async route => {
    requests++;
    expect(route.request().postDataJSON().email).toBe('yrdly-qa-browser@example.invalid');
    const callback = new URL(new URL(route.request().url()).searchParams.get('redirect_to')!);
    expect(callback.origin).toBe(new URL(env.NEXT_PUBLIC_APP_URL || baseURL!).origin);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe('/reset-password');
    await route.fulfill({ json: {} });
  });
  for (const width of [375,768,1440]) {
    const before = requests;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/forgot-password');
    await page.getByPlaceholder('Enter your email address', { exact: true }).fill('yrdly-qa-browser@example.invalid');
    await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
    await expect(page.getByText('Reset Link Sent', { exact: true })).toBeVisible();
    expect(requests).toBe(before + 1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-recovery-request.png`, fullPage: true });
  }
});

test('Google handoff preserves a local destination and rejects an external next URL', async ({ page, baseURL }) => {
  const { url } = qaClients();
  const callbacks: URL[] = [];
  await page.route(`${url}/auth/v1/authorize**`, async route => {
    const authorize = new URL(route.request().url());
    expect(authorize.searchParams.get('provider')).toBe('google');
    callbacks.push(new URL(authorize.searchParams.get('redirect_to')!));
    await route.fulfill({ contentType: 'text/html', body: '<p>QA intercepted OAuth handoff</p>' });
  });
  for (const [next, expected] of [['/marketplace','/marketplace'],['//outside.example/steal','/home']]) {
    callbacks.length = 0;
    await page.goto('/login?next=' + encodeURIComponent(next));
    await page.getByRole('button', { name: 'Log in with Google', exact: true }).click();
    await expect(page.getByText('QA intercepted OAuth handoff', { exact: true })).toBeVisible();
    const callback = callbacks.at(-1);
    expect(callback?.origin).toBe(new URL(baseURL!).origin);
    expect(callback?.pathname).toBe('/auth/callback');
    expect(callback?.searchParams.get('next')).toBe(expected);
  }
  // This verifies the browser handoff, not Google consent or a provider login.
});

for (const width of [375,768,1440]) {
  test(`real recovery session updates a disposable account password at ${width}px`, async ({ page, context, baseURL }) => {
    const { admin, publicClient, env, url } = qaClients();
    const email = `yrdly-qa-recovery-${randomUUID()}@example.invalid`;
    const oldPassword = `QaOld!9-${randomUUID()}`;
    const newPassword = `QaNew!9-${randomUUID()}`;
    let userId: string | undefined;
    const ok = (r: any) => {
      if (r.error) throw new Error(`QA recovery fixture failed (${r.error.code || 'unknown'})`);
      return r.data;
    };
    try {
      userId = ok(await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true,
        user_metadata: { qa_prefix: 'YRDLY-QA', qa_role: 'browser_recovery' } })).user.id;
      const link = ok(await admin.auth.admin.generateLink({ type: 'recovery', email }));
      const jar = new Map<string, { name: string; value: string }>();
      const recovery = createServerClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookieOptions: { name: 'sb-yoiyqxtpmxnrrbqqidcs-auth-token', path: '/', sameSite: 'lax', secure: false },
        cookies: {
          getAll: () => [...jar.values()],
          setAll: cookies => cookies.forEach(c => c.value ? jar.set(c.name, { name: c.name, value: c.value }) : jar.delete(c.name)),
        },
      });
      const verified = ok(await recovery.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'recovery' }));
      expect(verified.user.id).toBe(userId);
      await context.addCookies([...jar.values()].map(c => ({ ...c, url: baseURL!, sameSite: 'Lax' as const })));
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/auth/callback?next=/reset-password');
      await expect(page).toHaveURL(/\/reset-password$/);
      await expect(page.getByRole('heading', { name: 'Set New Password', exact: true })).toBeVisible();
      let updates = 0;
      page.on('request', r => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/auth/v1/user') updates++; });
      await page.getByPlaceholder('New Password (8+ chars)', { exact: true }).fill(newPassword);
      await page.getByPlaceholder('Confirm New Password', { exact: true }).fill('different');
      await page.getByRole('button', { name: 'Update Password', exact: true }).click();
      await expect(page.getByText('Passwords do not match', { exact: true })).toBeVisible();
      await page.getByPlaceholder('New Password (8+ chars)', { exact: true }).fill('short');
      await page.getByPlaceholder('Confirm New Password', { exact: true }).fill('short');
      await page.getByRole('button', { name: 'Update Password', exact: true }).click();
      await expect(page.getByText('Password must be at least 8 characters', { exact: true })).toBeVisible();
      expect(updates).toBe(0);
      await page.getByPlaceholder('New Password (8+ chars)', { exact: true }).fill(newPassword);
      await page.getByPlaceholder('Confirm New Password', { exact: true }).fill(newPassword);
      await page.getByRole('button', { name: 'Update Password', exact: true }).click();
      await expect(page.getByText('Password Updated!', { exact: true })).toBeVisible();
      expect(updates).toBe(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-password-updated.png`, fullPage: true });
      const login = publicClient();
      expect(ok(await login.auth.signInWithPassword({ email, password: newPassword })).user.id).toBe(userId);
      await login.auth.signOut();
      const oldLogin = await publicClient().auth.signInWithPassword({ email, password: oldPassword });
      expect(Boolean(oldLogin.error && !oldLogin.data.session)).toBe(true);
    } finally {
      if (userId) ok(await admin.auth.admin.deleteUser(userId));
    }
  });
}
