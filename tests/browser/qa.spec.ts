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

test('paid-price forms reject small prices before uploads at all three breakpoints', async ({ page }) => {
  test.setTimeout(180000);
  const { env } = readQaEnv(), seed = readOutput();
  const admin = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const post = randomUUID(), business = randomUUID();
  const ok = (r: any) => { if (r.error) throw Error(`QA fixture operation failed (${r.error.code})`); return r.data; };
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && (/\/api\/posts$|\/api\/events\/create$|\/storage\/v1\/object\//.test(request.url()))) writes++;
  });
  try {
    ok(await admin.from('posts').insert({ id: post, user_id: seed.users.buyer, author_name: 'YRDLY-QA', title: 'YRDLY-QA price form', text: 'YRDLY-QA', category: 'For Sale', price: 1200, is_sold: false, moderation_status: 'approved', image_urls: ['/placeholder.svg'] }));
    ok(await admin.from('businesses').insert({ id: business, owner_id: seed.users.buyer, name: 'YRDLY-QA price forms', category: 'Other', location: { state: 'Lagos' }, is_active: true, moderation_status: 'approved' }));
    await page.route('**/api/seller/setup-account', route => route.fulfill({ json: { account: { isVerified: true } } }));
    await page.route('**/rest/v1/categories?**', route => route.fulfill({ json: [{ id: 'qa-category', name: 'Community', type: 'event', is_active: true }] }));
    await page.goto('/login');
    await page.getByPlaceholder('Email address').fill(env.QA_BUYER_EMAIL);
    await page.getByPlaceholder('Password', { exact: true }).fill(env.QA_BUYER_PASSWORD);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30000 });
    for (const width of [375,768,1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/marketplace/create');
      await page.locator('input[type=file]').setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64') });
      await page.getByRole('button', { name: 'Continue to Details', exact: true }).click();
      await page.getByPlaceholder('e.g. iPhone 14 Pro 256GB Space Black').fill('YRDLY-QA price form');
      const price = page.getByLabel('Price (₦) *', { exact: true });
      await expect(price).toHaveAttribute('min','1200');
      await expect(price).toHaveAttribute('step','0.01');
      await price.fill('1199.99');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(price).toBeVisible();
      await expect(page.getByText('Valid Price Required', { exact: true }).first()).toBeVisible();
      await price.fill('1200');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Description & Location', exact: true })).toBeVisible();
      await page.goto(`/marketplace/edit/${post}`);
      await expect(page.getByLabel('Price (₦) *', { exact: true })).toHaveAttribute('min','1200');
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-minimum-listing.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);

      await page.goto(`/businesses/${business}/manage-services`);
      await page.getByRole('button', { name: '+ Add New Service', exact: true }).click();
      await page.getByPlaceholder('e.g. Haircut & Beard Trim').fill('YRDLY-QA deposit');
      await page.getByLabel('Price (₦)', { exact: true }).fill('950');
      await page.getByRole('button', { name: 'Save Service', exact: true }).click();
      await expect(page.getByText(/Paid prices and booking payments must be at least/)).toBeVisible();
      await page.getByLabel('Price (₦)', { exact: true }).fill('2400');
      await page.getByText('Require Deposit to Book', { exact: true }).click();
      await page.getByLabel('Deposit amount', { exact: true }).fill('1000');
      await page.getByRole('button', { name: 'Save Service', exact: true }).click();
      await expect(page.getByText(/Booking deposit: Paid prices/)).toBeVisible();
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-minimum-deposit.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);

      await page.goto('/events/create');
      await page.getByPlaceholder('e.g. Lekki Neighborhood BBQ & Music Fest').fill('YRDLY-QA minimum tickets');
      await page.getByRole('button', { name: 'Community', exact: true }).click();
      await page.getByRole('button', { name: 'Continue to Date & Time', exact: true }).click();
      await page.locator('input[type=date]').fill('2026-12-31');
      await page.getByRole('button', { name: 'Continue to Location', exact: true }).click();
      await page.getByRole('button', { name: /Online/, exact: false }).click();
      await page.getByPlaceholder('https://zoom.us/j/... or Youtube Live link').fill('https://example.test/qa');
      await page.getByRole('button', { name: 'Continue to Tickets', exact: true }).click();
      await page.getByLabel('Free Ticket', { exact: true }).uncheck();
      const ticketPrice = page.getByLabel('Price for General Admission', { exact: true });
      await expect(ticketPrice).toHaveValue('1200');
      await ticketPrice.fill('1199.99');
      await page.getByRole('button', { name: 'Continue to Media', exact: true }).click();
      await expect(ticketPrice).toBeVisible();
      await expect(page.getByText('Valid Ticket Price Required', { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: `.qa-artifacts/screenshots/${width}-minimum-ticket.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
      await page.getByLabel('Free Ticket', { exact: true }).check();
      await page.getByRole('button', { name: 'Continue to Media', exact: true }).click();
      await expect(ticketPrice).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Continue to Media', exact: true })).toHaveCount(0);
    }
    expect(writes).toBe(0);
    expect(ok(await admin.from('service_offerings').select('id').eq('business_id',business))).toHaveLength(0);
  } finally {
    ok(await admin.from('posts').delete().eq('id',post));
    ok(await admin.from('service_offerings').delete().eq('business_id',business));
    ok(await admin.from('businesses').delete().eq('id',business));
  }
});

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
