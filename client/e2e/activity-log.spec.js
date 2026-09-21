import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('an engineer in an enabled team can log an activity', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  await page.goto('/activity-log');
  await page.getByRole('button', { name: 'Log activity' }).first().click();

  const dialog = page.getByRole('dialog');
  // Required fields carry a "*" marker in their label.
  await dialog.getByLabel(/^Customer\s*\*?$/).selectOption({ label: 'Northwind Logistics' });
  await dialog.getByLabel(/^Title\s*\*?$/).fill('Reviewed the outbound firewall rules');
  await dialog.getByLabel(/^Category\s*\*?$/).selectOption({ label: 'Support' });
  await dialog.getByLabel('Time spent (minutes)').fill('45');
  await dialog.getByRole('button', { name: 'Log activity' }).click();

  await expect.poll(() => api.calls.some(c => c.method === 'POST' && c.path === '/api/service-activities')).toBe(true);
  const sent = api.calls.find(c => c.method === 'POST' && c.path === '/api/service-activities').body;
  expect(sent).toMatchObject({ customer_id: 1, category_id: 1, title: 'Reviewed the outbound firewall rules', duration_minutes: 45 });
  // Who did the work and which team it counts for are decided by the server, never sent by the browser.
  expect(sent).not.toHaveProperty('engineer_id');
  expect(sent).not.toHaveProperty('team_id');
});

test('the form does not send anything until the required fields are filled', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  await page.goto('/activity-log');
  await page.getByRole('button', { name: 'Log activity' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log activity' }).click();
  expect(api.calls.some(c => c.method === 'POST' && c.path === '/api/service-activities')).toBe(false);
});

test('an engineer with no enabled team does not see Activity Log and is blocked from its URL', async ({ page }) => {
  await mockApi(page, { role: 'engineer', teams: [] });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Tasks' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Activity Log' })).toHaveCount(0);

  await page.goto('/activity-log');
  await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
});
