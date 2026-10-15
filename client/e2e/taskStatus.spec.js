import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('on the Tasks list a task is marked done in one click, or its status changed from the badge', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const sent = [];
  api.override('PUT /api/tasks/1', ({ request }) => { sent.push(request.postDataJSON()); return { body: {} }; });
  await page.goto('/tasks');

  await page.getByRole('button', { name: 'Mark Renew firewall support contract as done' }).click();
  await expect.poll(() => sent[0]).toEqual({ status: 'completed' });

  await page.locator('summary', { hasText: 'In progress' }).first().click();
  await page.getByRole('menuitemradio', { name: 'Open' }).click();
  await expect.poll(() => sent[1]).toEqual({ status: 'open' });
  await expect(page.getByRole('menu')).toBeHidden();
});
