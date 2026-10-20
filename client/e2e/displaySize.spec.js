import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the app opens at 90%; a person picks another display size in Profile, applied at once and kept', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const saved = [];
  api.override('PUT /api/auth/preferences/display.zoom', ({ body }) => { saved.push(body); return { body: { ok: true } }; });
  await page.goto('/profile');
  const zoom = () => page.evaluate(() => document.documentElement.style.zoom);
  await expect.poll(zoom).toBe('0.9');
  const sizes = page.getByRole('radiogroup', { name: 'Display size' });
  await expect(sizes.getByRole('radio', { name: '90% (default)' })).toHaveAttribute('aria-checked', 'true');
  await sizes.getByRole('radio', { name: '100%' }).click();
  await expect.poll(zoom).toBe('1');
  await expect.poll(() => saved.length).toBe(1);
  await page.reload();
  await expect.poll(zoom).toBe('1');
  await expect(page.getByRole('radiogroup', { name: 'Display size' }).getByRole('radio', { name: '100%' })).toHaveAttribute('aria-checked', 'true');
});
