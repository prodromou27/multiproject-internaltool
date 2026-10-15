import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a page left open across an update asks to be reloaded', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  await page.goto('/');
  await expect(page.locator('.app-update-bar')).toHaveCount(0);

  // The server now serves a newer build and no longer has an old endpoint.
  api.override('GET /api/workload/engineers', () => ({ status: 404, body: { error: 'API endpoint not found' }, headers: { 'X-App-Build': 'index-Newer123.js' } }));
  await page.goto('/workload');
  await expect(page.locator('.app-update-bar')).toContainText('TeamHub has been updated');
  await expect(page.getByText('Reload the page (Ctrl+F5) to use the new version.')).toBeVisible();
});
