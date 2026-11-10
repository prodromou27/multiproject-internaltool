import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const day = () => new Date().toISOString().slice(0, 10);

test('an engineer adds a visit to their calendar from the Calendar and from Maintenance Visits', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const visit = { id: 7, type: 'maintenance', title: 'Quarterly firewall check', date: day(), scheduled_date: day(), status: 'scheduled', report_sent: 0, customer_name: 'Northwind Logistics', engineer_names: 'Alex Mercer' };
  api.override('GET /api/calendar', () => ({ body: { tasks: [], projects: [], visits: [visit] } }));
  api.override('GET /api/maintenance-visits/7/calendar.ics', () => ({ body: 'BEGIN:VCALENDAR' }));

  await page.goto('/calendar');
  // The calendar chip shows the customer (and contract, if any), not the visit title —
  // the title only appears once the event is opened.
  await page.getByRole('button', { name: /Northwind Logistics/ }).first().click();
  const details = page.getByRole('dialog');
  await details.getByRole('button', { name: 'Add Quarterly firewall check to your calendar' }).click();
  await expect.poll(() => api.calls.filter(call => call.path === '/api/maintenance-visits/7/calendar.ics').length).toBe(1);

  await page.goto('/maintenance-visits?filter=all');
  await expect(page.getByRole('button', { name: /^Add .* to your calendar$/ }).first()).toBeVisible();
});

test('the Calendar offers "Mark Report Sent" from the visit day on, not before', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const later = new Date(); later.setDate(later.getDate() + 10);
  const ahead = later.toISOString().slice(0, 10);
  const visit = (id, date, customer) => ({ id, type: 'maintenance', title: `Visit ${id}`, date, scheduled_date: date, status: 'scheduled', report_sent: 0, customer_name: customer, engineer_names: 'Alex Mercer' });
  api.override('GET /api/calendar', () => ({ body: { tasks: [], projects: [], visits: [visit(7, day(), 'Northwind Logistics'), visit(8, ahead, 'Contoso Retail')] } }));

  await page.goto('/calendar');
  await page.getByRole('button', { name: /Northwind Logistics/ }).first().click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Mark Report Sent' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();

  if (ahead.slice(0, 7) !== day().slice(0, 7)) await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: /Contoso Retail/ }).first().click();
  await expect(page.getByRole('dialog').getByText('Visit 8')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Mark Report Sent' })).toHaveCount(0);
});
