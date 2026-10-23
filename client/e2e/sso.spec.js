import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the sign-in page offers Microsoft sign-in when it is set up, and explains a refused one', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false });
  api.override('GET /api/auth/saml/status', () => ({ body: { enabled: true, label: 'Sign in with Microsoft' } }));
  await page.goto('/login?sso_error=no_account');
  await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toHaveAttribute('href', '/api/auth/saml/login?next=%2F');
  await expect(page.getByText('There is no account here for your Microsoft email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible(); // passwords keep working
});

test('without Microsoft sign-in set up, only the password form shows', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false });
  api.override('GET /api/auth/saml/status', () => ({ body: { enabled: false, label: 'Sign in with Microsoft' } }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toHaveCount(0);
});
