import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('changing the sign-in email asks for the current password and waits for the new address to confirm it', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let sent = null;
  api.override('PUT /api/auth/profile', ({ request }) => {
    sent = request.postDataJSON();
    return { body: { user: { id: 1, name: sent.name, email: 'alex@example.com', role: 'manager' }, pending_email: sent.email } };
  });
  await page.goto('/profile');
  const email = page.getByLabel('Email Address');
  await expect(page.locator('#profile-current-password')).toHaveCount(0);
  await email.fill('alex.new@example.com');
  await page.locator('#profile-current-password').fill('Current#pass1');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => sent).toMatchObject({ email: 'alex.new@example.com', current_password: 'Current#pass1' });
  await expect(page.getByText('Open the link sent to alex.new@example.com')).toBeVisible();
});

test('the emailed link confirms the new address', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false });
  api.override('POST /api/auth/confirm-email', ({ request }) => ({ body: { ok: true, email: request.postDataJSON().token === 'a'.repeat(64) ? 'alex.new@example.com' : '?' } }));
  await page.goto(`/confirm-email?token=${'a'.repeat(64)}`);
  await expect(page.getByText('Your email address is now alex.new@example.com')).toBeVisible();
});
