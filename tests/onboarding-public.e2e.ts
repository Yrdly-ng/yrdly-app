import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

// This test deliberately avoids creating real accounts or calling a live auth backend.
test('visitors can switch into signup and see the new account form', async ({ app, screen }) => {
  await app.open('/login');
  await expect(screen.getByRole('heading', 'Log in to Yrdly')).toBeVisible();
  await screen.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(screen.getByRole('heading', 'Create an account')).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Create Account' })).toBeVisible();
});
