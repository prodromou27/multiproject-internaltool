import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

async function customerPage(page, compose) {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Met', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 }, visits: { next: null, reports_pending: 0, this_year: 0 } } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customer-responses', () => ({ body: { rows: [{ id: 'late', title: 'Late Response', body: 'Dear {{contact_name}}…', tone: 'danger' }], can_edit: true } }));
  api.override('POST /api/customer-responses/late/compose', compose);
  await page.goto('/customers/12/service-profile');
  await page.getByRole('button', { name: 'Reply with a response' }).click();
  await page.getByLabel('Response', { exact: true }).selectOption({ label: 'Late Response' });
  return api;
}

test('a response is filled from the customer, can be changed, and is sent only when asked', async ({ page }) => {
  let sent = null;
  const api = await customerPage(page, ({ body }) => ({ body: { subject: 'Late Response', body: 'Dear Dana, ticket {{task_title}}', missing: [{ name: 'task_title', label: 'Task title' }], recipients: ['ops@met.example'], email_available: true } }));
  api.override('POST /api/customer-responses/late/send', ({ body }) => { sent = body; return { body: { ok: true } }; });
  const dialog = page.getByRole('dialog', { name: 'Reply with a response' });
  await expect(dialog.getByText('Not known here, fill in by hand: Task title.')).toBeVisible();
  await expect(dialog.getByText("To: ops@met.example (the customer's contact)")).toBeVisible();
  const sendButton = dialog.getByRole('button', { name: 'Send to ops@met.example' });
  await expect(sendButton).toBeDisabled();
  await dialog.getByLabel('Text').fill('Dear Dana, ticket 4411 is closed.');
  await sendButton.click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual({ context: { type: 'customer', id: 12 }, to: 'ops@met.example', subject: 'Late Response', body: 'Dear Dana, ticket 4411 is closed.' });
});

test('without a contact email or email set up, the text can only be copied', async ({ page }) => {
  await customerPage(page, () => ({ body: { subject: 'Late Response', body: 'Dear team', missing: [], recipients: [], email_available: true } }));
  const dialog = page.getByRole('dialog', { name: 'Reply with a response' });
  await expect(dialog.getByText('The customer has no contact email, so this can only be copied.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Send/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy text' })).toBeVisible();
});
