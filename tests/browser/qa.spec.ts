import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function readQaEnv() {
  const env = parse(readFileSync('.env.qa', 'utf8'));
  if (env.QA_ENVIRONMENT !== 'staging' || env.QA_EXPECTED_PROJECT_REF !== 'jxgpvvehajxegeeozlnl' ||
      new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'jxgpvvehajxegeeozlnl.supabase.co') {
    throw new Error('Browser tests require the isolated QA backend');
  }
  return { env };
}
function readOutput() {
  const seed = JSON.parse(readFileSync('qa-seed-output.json', 'utf8'));
  if (seed.projectRef !== 'jxgpvvehajxegeeozlnl' || seed.qaPrefix !== 'YRDLY-QA') throw new Error('Invalid QA fixtures');
  return seed;
}

test('booking payment review shows the exact fee at mobile, tablet and desktop sizes', async ({ page }) => {
  const { env } = readQaEnv(), seed = readOutput();
  const admin = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const businessId = randomUUID(), serviceId = randomUUID(), bookingId = randomUUID();
  const ok = (r: any) => { if (r.error) throw new Error(`QA fixture operation failed (${r.error.code})`); return r.data; };
  try {
    ok(await admin.from('businesses').insert({ id: businessId, owner_id: seed.users.organizer, name: 'YRDLY-QA Booking UI', category: 'Other', location: { state: 'Lagos' }, is_active: true, moderation_status: 'approved' }));
    ok(await admin.from('service_offerings').insert({ id: serviceId, business_id: businessId, name: 'YRDLY-QA fractional service', price: 1234.56, duration_minutes: 60, is_active: true, requires_full_payment: true }));
    ok(await admin.from('bookings').insert({ id: bookingId, customer_id: seed.users.buyer, business_id: businessId, service_id: serviceId, appointment_time: new Date(Date.now()+86400000).toISOString(), end_time: new Date(Date.now()+90000000).toISOString(), status: 'requested' }));
    // Review rendering only: no provider escrow or payment is created.
    await page.route('**/api/bookings/checkout', route => route.fulfill({ json: { ok: true, transactionId: randomUUID(), reference: 'qa-ui-only', paylukPaymentToken: 'qa-ui-only', buyerPaylukId: 'qa-ui-only', amount: 1234.56, commission: 37.04, totalAmount: 1271.60 } }));
    await page.goto('/login');
    await page.getByPlaceholder('Email address').fill(env.QA_BUYER_EMAIL);
    await page.getByPlaceholder('Password', { exact: true }).fill(env.QA_BUYER_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
    for (const width of [375,768,1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/bookings/${bookingId}`);
      await expect(page.getByRole('heading', { name: 'Booking Details', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Review booking payment', exact: true }).click();
      const review = page.getByLabel('Booking payment review');
      await expect(review).toBeVisible();
      await expect(review).toContainText('₦1,234.56');
      await expect(review).toContainText('Yrdly fee (3%)');
      await expect(review).toContainText('₦37.04');
      await expect(review).toContainText('₦1,271.60');
      await expect(page.getByRole('button', { name: 'Continue to secure checkout', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-booking-payment.png`, fullPage: true });
    }
  } finally {
    ok(await admin.from('bookings').delete().eq('id',bookingId));
    ok(await admin.from('service_offerings').delete().eq('id',serviceId));
    ok(await admin.from('businesses').delete().eq('id',businessId));
  }
});

test('local login remains available and privacy policy renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in to Yrdly' })).toBeVisible();
  await expect(page.getByPlaceholder('Email address')).toBeVisible();
  await page.goto('/legal/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
});

for (const width of [375, 768, 1440]) {
  test(`signed-in buyer routes render at ${width}px`, async ({ page }) => {
    const { env } = await readQaEnv();
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.getByPlaceholder('Email address').fill(env.QA_BUYER_EMAIL);
    await page.getByPlaceholder('Password', { exact: true }).fill(env.QA_BUYER_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
    for (const route of ['/home', '/marketplace', '/events', '/messages', '/notifications', '/settings']) {
      await page.goto(route);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('main .yrdly-skeleton')).toHaveCount(0, { timeout: 30000 });
      if (route === '/home') await expect(page.getByText('YRDLY-QA Available Marketplace Listing', { exact: true }).first()).toBeVisible();
      if (route === '/events') await expect(page.getByRole('heading', { name: 'Picked for You', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Explore', exact: true })).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator('body')).not.toContainText('Application error:');
      await expect.poll(async () => page.locator('body').innerText()).not.toMatch(/^\s*(Loading[.…]*|Please wait[.…]*)\s*$/);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-${route.slice(1)}.png`, fullPage: true, mask: [page.locator('input[type=password]')] });
    }
  });
}

test('organizer scan page opens for the event owner', async ({ page }) => {
  const { env } = await readQaEnv();
  const seed = await readOutput();
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill(env.QA_ORGANIZER_EMAIL);
  await page.getByPlaceholder('Password', { exact: true }).fill(env.QA_ORGANIZER_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
  await page.goto(`/events/${seed.events.free}/scan`);
  await expect(page.getByRole('heading', { name: /scan|check.in/i })).toBeVisible();
  await page.screenshot({ path: '.qa-artifacts/screenshots/organizer-scan.png', fullPage: true });
});
