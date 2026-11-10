import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a settings form that could not load shows Retry, never defaults that Save would write', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let fail = true;
  api.override('GET /api/report-settings/smtp', () => (fail ? { status: 500, body: { error: 'Database unavailable' } } : { body: { host: 'smtp.company.test', port: 587, user: 'noreply@company.test', password_set: true } }));
  await page.goto('/settings/email');
  await expect(page.getByText('The email settings could not be loaded.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save SMTP/ })).toHaveCount(0);
  await expect(page.getByLabel('SMTP Host')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByLabel('SMTP Host')).toHaveValue('smtp.company.test');
  await expect(page.getByRole('button', { name: /Save SMTP/ })).toBeEnabled();
});

test('My Work says when subtasks or reminders could not be loaded', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  let fail = true;
  api.override('GET /api/tasks/my-subtasks', () => (fail ? { status: 500, body: { error: 'Timed out' } } : { body: [] }));
  api.override('GET /api/reminders', () => ({ status: 503, body: { error: 'Try again' } }));
  await page.goto('/my-day');
  await expect(page.getByText('Your subtasks could not be loaded.')).toBeVisible();
  await expect(page.getByText('Your reminders could not be loaded.')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect(page.getByText('Your subtasks could not be loaded.')).toHaveCount(0);
});
