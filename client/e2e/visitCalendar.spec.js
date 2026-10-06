import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const day = () => new Date().toISOString().slice(0, 10);

test('an engineer adds a visit to their calendar from the Calendar and from Maintenance Visits', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const visit = { id: 7, type: 'maintenance', title: 'Quarterly firewall check', date: day(), scheduled_date: day(), status: 'scheduled', report_sent: 0, customer_name: 'Northwind Logistics', engineer_names: 'Alex Mercer' };
  api.override('GET /api/calendar', () => ({ body: { tasks: [], projects: [], visits: [visit] } }));
  api.override('GET /api/maintenance-visits/7/calendar.ics', () => ({ body: 'BEGIN:VCALENDAR' }));

  await page.goto('/calendar');
  await page.getByRole('button', { name: /Quarterly firewall check/ }).first().click();
  const details = page.getByRole('dialog');
  await details.getByRole('button', { name: 'Add Quarterly firewall check to your calendar' }).click();
  await expect.poll(() => api.calls.filter(call => call.path === '/api/maintenance-visits/7/calendar.ics').length).toBe(1);

  await page.goto('/maintenance-visits?filter=all');
  await expect(page.getByRole('button', { name: /^Add .* to your calendar$/ }).first()).toBeVisible();
});
