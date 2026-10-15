import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers set working days, holidays and the travel time in Time & region', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('PUT /api/settings/business-calendar', ({ body }) => ({ body }));
  api.override('GET /api/settings/localization', () => ({ body: { default_language: 'en', supported_languages: ['en'], date_format: 'DD/MM/YYYY', time_format: '24h', number_format: '1,000.00', timezone: 'Asia/Nicosia', ntp_server: 'pool.ntp.org', ntp_check_enabled: false } }));
  api.override('GET /api/settings/clock', () => ({ body: { timezone: 'Asia/Nicosia', local_time: '10:00', utc_time: '07:00', ntp: null, warn_offset_ms: 5000 } }));
  await page.goto('/settings/localization');
  await page.getByLabel('Holiday date').fill('2026-12-25');
  await page.getByLabel('Holiday name').fill('Christmas Day');
  await page.getByRole('button', { name: 'Add holiday' }).click();
  await expect(page.getByRole('cell', { name: 'Christmas Day', exact: true })).toBeVisible();
  await page.getByLabel('Travel time between timed visits (minutes)').fill('45');
  await page.getByRole('button', { name: 'Save calendar' }).click();
  await expect.poll(() => api.calls.find(call => call.method === 'PUT' && call.path === '/api/settings/business-calendar')?.body).toMatchObject({
    working_days: [1, 2, 3, 4, 5], travel_buffer_minutes: 45, holidays: [{ date: '2026-12-25', name: 'Christmas Day', yearly: true }],
  });
});

test('contract types say whether their SLAs pause outside working days', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const view = { types: [{ name: '24x7', contracts: 2, sla_calendar: 'all_days' }, { name: '8x5', contracts: 1, sla_calendar: 'business' }], no_longer_offered: [] };
  api.override('GET /api/settings/contract-types', () => ({ body: view }));
  api.override('PUT /api/settings/contract-types', () => ({ body: view }));
  await page.goto('/settings/contract_types');
  await page.getByLabel('SLA days for 8x5').selectOption('all_days');
  await page.getByRole('button', { name: 'Save contract types' }).click();
  await expect.poll(() => api.calls.find(call => call.method === 'PUT' && call.path === '/api/settings/contract-types')?.body?.calendars).toEqual({ '24x7': 'all_days', '8x5': 'all_days' });
});

test('a visit with a problem is shown before saving, and saves only when chosen', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers', ({ request }) => ({ body: new URL(request.url()).searchParams.get('paged') ? { rows: [{ id: 1, name: 'Northwind Logistics', active: 1 }], total: 1 } : [] }));
  api.override('GET /api/users', () => ({ body: [{ id: 7, name: 'Maria Security', role: 'engineer' }] }));
  api.override('POST /api/maintenance-visits/check', () => ({ body: { warnings: [
    { code: 'holiday', severity: 'hard', message: '2026-12-25 is a public holiday (Christmas Day).' },
    { code: 'travel', severity: 'advisory', message: 'Maria Security has only 15 minutes between this visit and "Audit"; the travel buffer is 30 minutes.' },
  ] } }));
  api.override('POST /api/maintenance-visits', () => ({ body: { id: 9 } }));
  await page.goto('/maintenance-visits');
  await page.getByRole('button', { name: /Schedule Visit|New Visit|\+ New/ }).first().click();
  await page.locator('#visit-customer').fill('north');
  await page.getByRole('option', { name: 'Northwind Logistics' }).click();
  await page.getByLabel('Visit Title *').fill('Year-end check');
  await page.getByLabel('Scheduled Date *').fill('2026-12-25');
  await page.getByLabel('All day').uncheck();
  await page.getByLabel('Start time').fill('10:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Needs a second look')).toBeVisible();
  await expect(page.getByText(/public holiday \(Christmas Day\)/)).toBeVisible();
  await expect(page.getByText('Worth knowing')).toBeVisible();
  expect(api.calls.some(call => call.method === 'POST' && call.path === '/api/maintenance-visits')).toBe(false);
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await expect.poll(() => api.calls.find(call => call.method === 'POST' && call.path === '/api/maintenance-visits')?.body).toMatchObject({
    scheduled_date: '2026-12-25', start_time: '10:00', duration_minutes: 120, confirm_warnings: true,
  });
});
