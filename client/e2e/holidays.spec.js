import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('public holidays are named in their day on the Calendar and the visits calendar', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-12-10T10:00:00'));
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/calendar', () => ({ body: { tasks: [], projects: [], visits: [], holidays: [{ date: '2026-12-25', name: 'Christmas Day' }] } }));
  api.override('GET /api/calendar/holidays', () => ({ body: [{ date: '2026-12-25', name: 'Christmas Day' }, { date: '2027-01-01', name: 'New Year' }] }));
  await page.goto('/calendar');
  await expect(page.locator('.cal-holiday', { hasText: 'Christmas Day' })).toBeVisible();
  await expect(page.locator('.cal-holiday')).toHaveCount(1);

  await page.goto('/maintenance-visits?view=calendar');
  if (await page.getByRole('region', { name: 'Visit calendar' }).count() === 0) await page.getByRole('tab', { name: 'Calendar' }).click();
  const calendar = page.getByRole('region', { name: 'Visit calendar' });
  await expect(calendar.locator('.vv-day.is-holiday .cal-holiday', { hasText: 'Christmas Day' })).toBeVisible();
  await expect(calendar.locator('.cal-holiday', { hasText: 'New Year' })).toBeVisible();
});
