import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// The composer is opened from a maintenance visit (Customer 360 has no "Reply with a response").
async function visitComposer(page, compose) {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customer-responses', () => ({ body: { rows: [{ id: 'late', title: 'Late Response', body: 'Dear {{contact_name}}…', tone: 'danger' }], can_edit: true } }));
  api.override('POST /api/customer-responses/late/compose', compose);
  await page.goto('/maintenance-visits');
  await page.getByRole('button', { name: 'View visit: Quarterly firewall check' }).click();
  await page.getByRole('button', { name: 'Reply with a response' }).click();
  const panel = page.getByRole('region', { name: 'Reply with a response' });
  await panel.getByLabel('Response', { exact: true }).selectOption({ label: 'Late Response' });
  return { api, panel };
}

test('a response is filled from the visit, can be changed, and is sent only when asked', async ({ page }) => {
  let sent = null;
  const { api, panel } = await visitComposer(page, () => ({ body: { subject: 'Late Response', body: 'Dear Dana, ticket {{task_title}}', missing: [{ name: 'task_title', label: 'Task title' }], recipients: ['ops@met.example'], email_available: true, customer_email_off: false } }));
  api.override('POST /api/customer-responses/late/send', ({ body }) => { sent = body; return { body: { ok: true } }; });
  await expect(panel.getByText('Not known here, fill in by hand: Task title.')).toBeVisible();
  await expect(panel.getByText("To: ops@met.example (the customer's contact)")).toBeVisible();
  const sendButton = panel.getByRole('button', { name: 'Send to ops@met.example' });
  await expect(sendButton).toBeDisabled();
  await panel.getByLabel('Text').fill('Dear Dana, ticket 4411 is closed.');
  await sendButton.click();
  await expect(panel).toHaveCount(0);
  expect(sent).toEqual({ context: { type: 'visit', id: 1 }, to: 'ops@met.example', subject: 'Late Response', body: 'Dear Dana, ticket 4411 is closed.' });
});

test('with emails to customers switched off, the text can only be copied', async ({ page }) => {
  const { panel } = await visitComposer(page, () => ({ body: { subject: 'Late Response', body: 'Dear team', missing: [], recipients: ['ops@met.example'], email_available: false, customer_email_off: true } }));
  await expect(panel.getByText(/Emails to customers are switched off \(Settings → Email & notifications\), so this can only be copied\./)).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Copy text' })).toBeVisible();
});

test('without a contact email, the text can only be copied', async ({ page }) => {
  const { panel } = await visitComposer(page, () => ({ body: { subject: 'Late Response', body: 'Dear team', missing: [], recipients: [], email_available: true } }));
  await expect(panel.getByText('The customer has no contact email, so this can only be copied.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toHaveCount(0);
});

test('Customer 360 has no "Reply with a response" button', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Met', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 }, visits: { next: null, reports_pending: 0, this_year: 0 } } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  await page.goto('/customers/12/service-profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Met' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reply with a response' })).toHaveCount(0);
});

test('managers switch emails to customers on and off in Settings; it starts off', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let saved = null;
  api.override('GET /api/report-settings/customer-email', () => ({ body: { enabled: false } }));
  api.override('PUT /api/report-settings/customer-email', ({ body }) => { saved = body; return { body }; });
  await page.goto('/settings/email');
  const section = page.getByRole('region', { name: 'Emails to customers' });
  const toggle = section.getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(section).toContainText('No report is ever sent to a customer automatically.');
  await toggle.click();
  await expect.poll(() => saved).toEqual({ enabled: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});
