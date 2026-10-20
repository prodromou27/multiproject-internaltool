import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a manager gives a team its own Webex space, and can go back to the shared one', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let team = { id: 1, name: 'Security Team', member_count: 3, managed_service_operations: 1, project_delivery_enabled: 0, service_activity_enabled: 1, webex_space_id: null };
  const sent = [];
  api.override('GET /api/teams', () => ({ body: [team] }));
  api.override('PUT /api/teams/1', ({ body }) => { sent.push(body); team = { ...team, ...body }; return { body: { ok: true } }; });
  await page.goto('/settings/teams');
  await page.getByRole('button', { name: 'Webex space for Security Team' }).click();
  const dialog = page.getByRole('dialog', { name: /Webex space/ });
  await dialog.getByLabel('Webex space ID').fill('Y2lzY29zcGFyazovL3VzL1JPT00vc2VjdXJpdHk');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ webex_space_id: 'Y2lzY29zcGFyazovL3VzL1JPT00vc2VjdXJpdHk' });
  await expect(page.getByRole('button', { name: 'Webex space for Security Team' })).toHaveText('Own space');

  await page.getByRole('button', { name: 'Webex space for Security Team' }).click();
  await dialog.getByLabel('Webex space ID').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ webex_space_id: null });
});
