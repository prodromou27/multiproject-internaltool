import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const visit = { id: 5, customer_id: 4, customer_name: 'Acme Corp', title: 'Quarterly firewall check', scheduled_date: '2026-10-15', status: 'scheduled',
  engineer_ids: [1], engineer_names: 'Alex Mercer', asset_ids: [], report_sent: 0, report_sent_to_customer: 0, notes: '', checklist: null };

test('on a phone, an engineer runs a visit: checklist, time, then a recommendation from what was found', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockApi(page, { role: 'engineer' });
  let saved = null, logged = null;
  api.override('GET /api/maintenance-visits', () => ({ body: [visit] }));
  api.override('GET /api/visit-checklists', () => ({ body: { rows: [{ id: 'fw', name: 'Firewall health', items: ['Check HA status', 'Review logs'] }], can_edit: false } }));
  api.override('PUT /api/maintenance-visits/5/checklist', ({ body }) => { saved = body.checklist; return { body: { checklist: { ...body.checklist, updated_by: 'Alex Mercer', updated_at: '2026-10-15T09:00:00Z' } } }; });
  api.override('POST /api/time-logs', ({ body }) => { logged = body; return { body: { id: 1 } }; });

  await page.goto('/maintenance-visits?visit=5');
  const run = page.getByRole('region', { name: 'Run this visit' });
  await run.getByLabel('Checklist to use').selectOption({ label: 'Firewall health' });
  await expect(run.getByText('Firewall health · 2 still to check')).toBeVisible();
  await run.getByRole('radiogroup', { name: 'Result: Check HA status' }).getByLabel('OK').check();
  await run.getByRole('radiogroup', { name: 'Result: Review logs' }).getByLabel('Issue').check();
  await run.getByLabel('Note: Review logs').fill('Disk warnings on node 2');
  await run.getByRole('button', { name: 'Save checklist' }).click();
  await expect(run.getByText(/saved by Alex Mercer/)).toBeVisible();
  expect(saved).toEqual({ name: 'Firewall health', items: [{ text: 'Check HA status', result: 'ok', note: '' }, { text: 'Review logs', result: 'issue', note: 'Disk warnings on node 2' }] });

  await run.getByLabel('Hours').fill('2.5');
  await run.getByLabel('What you did').fill('Checks and log review');
  await run.getByRole('button', { name: 'Log time' }).click();
  await expect.poll(() => logged).toEqual({ visit_id: 5, hours: 2.5, description: 'Checks and log review' });

  await expect(run.getByText('1 issue found.')).toBeVisible();
  await expect(run.getByRole('link', { name: 'Add a recommendation from this visit' })).toHaveAttribute('href', '/customers/4/service-profile?section=recommendations&source_visit=5&create=1');
  // Nothing wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an engineer who is not on the visit does not get the guided steps', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/maintenance-visits', () => ({ body: [{ ...visit, engineer_ids: [9], engineer_names: 'Someone Else' }] }));
  await page.goto('/maintenance-visits?visit=5');
  await expect(page.getByRole('dialog', { name: 'Maintenance Visit Details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Run this visit' })).toHaveCount(0);
});

test('managers keep the checklists in Settings', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let created = null;
  api.override('GET /api/visit-checklists', () => ({ body: { rows: created ? [{ id: 'n', ...created }] : [], can_edit: true } }));
  api.override('POST /api/visit-checklists', ({ body }) => { created = body; return { status: 201, body: { id: 'n', ...body } }; });
  await page.goto('/settings/visit_checklists');
  await page.getByRole('button', { name: 'Add checklist' }).click();
  await page.getByLabel('Name').fill('Switch health');
  await page.getByLabel('Checks, one per line').fill('Check uplinks\n\nCheck PoE budget');
  await page.getByRole('button', { name: 'Save checklist' }).click();
  expect(created).toEqual({ name: 'Switch health', items: ['Check uplinks', 'Check PoE budget'] });
  await expect(page.getByText('2 checks: Check uplinks · Check PoE budget')).toBeVisible();
});
