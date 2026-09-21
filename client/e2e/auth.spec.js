import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a signed-out visitor is sent to the login form', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByPlaceholder(/admin or you@/)).toBeVisible();
});

test('a wrong password shows the server message and stays on the form', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false });
  api.override('POST /api/auth/login', () => ({ status: 401, body: { error: 'Invalid email or password' } }));
  await page.goto('/login');
  await page.getByPlaceholder(/admin or you@/).fill('alex@example.com');
  await page.getByPlaceholder('••••••••').fill('wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signing in sends the credentials and opens the app', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false });
  await page.goto('/login');
  await page.getByPlaceholder(/admin or you@/).fill('alex@example.com');
  await page.getByPlaceholder('••••••••').fill('a-good-password');
  // After a successful login the app treats the person as signed in.
  api.override('GET /api/auth/me', () => ({ body: api.user }));
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByRole('link', { name: 'Tasks' }).first()).toBeVisible();
  const login = api.calls.find(c => c.method === 'POST' && c.path === '/api/auth/login');
  expect(login.body).toEqual({ email: 'alex@example.com', password: 'a-good-password' });
});
