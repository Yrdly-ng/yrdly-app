import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

test('privacy policy page loads', async ({ app, screen }) => {
  await app.open('/legal/privacy');
  await expect(screen.getByRole('heading', 'Privacy Policy')).toBeVisible();
});
