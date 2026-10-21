import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, last: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };

test('a manager hides a tab on a customer\'s page and adds an engineer from another team, from Service Configuration', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let hidden = [], engineers = null;
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1, hidden_sections: hidden } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }, { id: 8, name: 'Nick Network', role: 'engineer', active: 1 }] }));
  api.override('GET /api/customers/12/engineers', () => ({ body: [] }));
  api.override('PUT /api/customers/12/engineers', ({ body }) => { engineers = body.user_ids; return { body: { ok: true } }; });
  api.override('PUT /api/customers/12/sections', ({ body }) => { hidden = body.hidden; return { body: { hidden_sections: hidden } }; });
  await page.goto('/customers/12/service-profile?section=service-configuration');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: 'Timeline' })).toBeVisible();

  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Tabs on this page' }) });
  await card.getByRole('switch', { name: 'Timeline' }).click();
  await expect.poll(() => hidden).toEqual(['timeline']);
  await expect(tabs.getByRole('tab', { name: 'Timeline' })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toBeVisible();

  await page.getByLabel('Add an engineer from another team').selectOption({ label: 'Nick Network' });
  await expect.poll(() => engineers).toEqual([8]);
  await expect(page.getByRole('button', { name: 'Remove Nick Network' })).toBeVisible();

  // Shown again later: the switch brings it back.
  await card.getByRole('switch', { name: 'Timeline' }).click();
  await expect.poll(() => hidden).toEqual([]);
  await expect(tabs.getByRole('tab', { name: 'Timeline' })).toBeVisible();
});
