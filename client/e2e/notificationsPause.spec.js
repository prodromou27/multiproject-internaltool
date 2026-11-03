import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a manager pauses Webex and email notifications for batch work, sees a reminder everywhere, and resumes them', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let state = { paused: false, since: null, by: null };
  api.override('GET /api/settings/notifications-pause', () => ({ body: state }));
  api.override('PUT /api/settings/notifications-pause', ({ body }) => {
    state = body.paused ? { paused: true, since: '2026-10-20T09:00:00Z', by: 'Alex Mercer' } : { paused: false, since: null, by: null };
    return { body: state };
  });
  api.override('GET /api/settings/integrations', () => ({ body: { teams: {}, webex: {}, notify_on: {}, events: [] } }));
  await page.goto('/settings/notifications');
  const banner = page.locator('.notifications-paused-banner');
  await expect(banner).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause notifications' }).click();
  await expect(banner).toContainText('Webex, Teams and email notifications are paused.');
  await expect(page.getByText(/Paused by Alex Mercer/)).toBeVisible();

  // The reminder stays on other pages, and leads back to the switch.
  await page.goto('/projects');
  await expect(banner).toBeVisible();
  await banner.getByRole('link', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Resume notifications' }).click();
  await expect(banner).toHaveCount(0);
  expect(state.paused).toBe(false);
});
