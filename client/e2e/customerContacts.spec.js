import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, last: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };

test('a manager adds a second contact on Customer 360 and makes them the primary one', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let contacts = [{ id: 1, name: 'Maria Ioannou', role: '', email: 'maria@northwind.example', phone: '+357 22 000001', notes: '', is_primary: true }];
  const sent = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/contacts', () => ({ body: contacts }));
  api.override('POST /api/customers/12/contacts', ({ body }) => { sent.push(body); contacts = [...contacts, { id: 2, ...body, is_primary: false }]; return { status: 201, body: { id: 2, contacts } }; });
  api.override('PUT /api/customers/12/contacts/2', ({ body }) => {
    sent.push(body);
    contacts = [{ ...contacts[1], is_primary: true }, { ...contacts[0], is_primary: false }];
    return { body: { contacts } };
  });
  await page.goto('/customers/12/service-profile?section=overview');
  const card = page.locator('.customer-contacts');
  await expect(card.getByText('Maria Ioannou')).toBeVisible();
  await expect(card.getByText('Primary')).toBeVisible();

  await card.getByRole('button', { name: 'Add contact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add contact' });
  await dialog.getByLabel('Name').fill('Nick Georgiou');
  await dialog.getByLabel('Role').fill('IT manager');
  await dialog.getByLabel('Email').fill('nick@northwind.example');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent[0]).toMatchObject({ name: 'Nick Georgiou', role: 'IT manager', email: 'nick@northwind.example' });
  await expect(card.getByText('Nick Georgiou')).toBeVisible();

  await card.getByRole('button', { name: 'Make primary' }).click();
  await expect.poll(() => sent[1]).toEqual({ is_primary: true });
  await expect(card.locator('li').first()).toContainText('Nick Georgiou');
  await expect(card.locator('li').first()).toContainText('Primary');
});

test('managers export customers with every contact as CSV', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let asked = null;
  api.override('GET /api/customers/export', ({ request }) => {
    asked = new URL(request.url()).search;
    return { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="customers-all-contacts-2026-10-21.csv"' }, body: 'Customer,Contact\r\nNorthwind,Maria\r\n' };
  });
  await page.goto('/customers');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Export customers' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export customers' });
  await dialog.getByLabel('Every contact (one row per contact)').check();
  await dialog.getByLabel('CSV').check();
  await dialog.getByLabel('Include archived customers').check();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('customers-all-contacts-2026-10-21.csv');
  expect(asked).toBe('?format=csv&contacts=all&archived=1');
});
