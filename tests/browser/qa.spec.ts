import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

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
