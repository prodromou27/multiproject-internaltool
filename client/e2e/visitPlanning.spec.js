import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const iso = d => d.toISOString().slice(0, 10);

test('managers see visits on a calendar and plan from team availability', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const today = new Date(), visitDay = iso(today);
  api.override('GET /api/maintenance-visits', () => ({ body: [{ id: 5, title: 'Quarterly firewall check', customer_id: 1, customer_name: 'Northwind Logistics', scheduled_date: visitDay, status: 'scheduled', engineer_names: 'Maria Security', engineer_ids: [7], report_sent: 0, report_sent_to_customer: 0 }] }));
  api.override('GET /api/customers', () => ({ body: [{ id: 1, name: 'Northwind Logistics' }] }));
  api.override('GET /api/users', () => ({ body: [{ id: 7, name: 'Maria Security', role: 'engineer' }] }));
  api.override('GET /api/teams', () => ({ body: [] }));
  api.override('GET /api/visit-planning/availability', ({ request }) => {
    const q = new URL(request.url()).searchParams, from = q.get('from');
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
    const slot = days.find(day => day >= visitDay && ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) || days[0];
    return { body: { days: days.map(date => ({ date, weekend: [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) })),
      engineers: [{ id: 7, name: 'Maria Security', serves_customer: q.get('customer_id') === '1', visit_count: 1, cells: days.map(date => ({ date, visits: [], time_off: null, tasks_due: 0, no_hours: false, free: true })) }],
      suggestions: [{ date: slot, engineers: [{ id: 7, name: 'Maria Security', serves_customer: q.get('customer_id') === '1', tasks_due: 0 }], free_count: 1 }] } };
  });

  await page.goto('/maintenance-visits');
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: /Quarterly firewall check/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Northwind Logistics');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Team availability' }).click();
  await page.getByLabel('Customer').selectOption({ label: 'Northwind Logistics' });
  const slot = page.locator('.vv-chip').first();
  await expect(slot).toContainText('★ Maria Security');
  await slot.click();
  await expect(page.getByRole('dialog', { name: /Schedule Maintenance Visit/ })).toBeVisible();
});

test('engineers get the calendar but not team availability', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/maintenance-visits');
  await expect(page.getByRole('tab', { name: 'Calendar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Team availability' })).toHaveCount(0);
});
