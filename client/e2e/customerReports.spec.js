import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 } };
const file = (id, format, version, status, extra = {}) => ({ id, output_format: format, report_version: version, status, workflow_version: 1, period_start: '2026-09-01', period_end: '2026-09-30',
  generated_at: '2026-10-05 08:30:00', generated_by_name: 'Alex Mercer', template_name: 'Monthly Managed Services Report', original_name: `report.${format}`, sent_at: null, ...extra });

test('the customer Reports tab shows where this period\'s report is, and moves it to the next step', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T09:00:00+03:00'));
  const api = await mockApi(page, { role: 'manager', permissions: { 'managed_reports.generate': true, 'managed_reports.review': true, 'managed_customers.view': true } });
  let history = [
    file(11, 'docx', 2, 'draft'), file(10, 'pdf', 1, 'draft'),
    file(5, 'docx', 1, 'final', { period_start: '2026-08-01', period_end: '2026-08-31', sent_at: '2026-09-10T08:00:00Z', sent_to: 'it@northwind.example' }),
  ];
  let action = null;
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/managed-customers/12/overview', () => ({ body: { report_due: { label: 'September 2026', from: '2026-09-01', to: '2026-09-30', due_date: '2026-10-15', status: 'draft', overdue: false } } }));
  api.override('GET /api/managed-report-templates', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/managed-services', () => ({ body: { default_report_template_id: null } }));
  api.override('GET /api/managed-customers/12/reports', () => ({ body: { rows: history } }));
  api.override('PUT /api/managed-customers/12/reports/11/workflow', ({ body }) => {
    action = body.action; history = history.map(r => (r.id === 11 ? { ...r, status: 'in_review' } : r));
    return { body: { report: history.find(r => r.id === 11) } };
  });

  await page.goto('/customers/12/service-profile?section=reports');
  const status = page.getByRole('region', { name: "This period's report" });
  await status.getByRole('button', { name: /Go to the September 2026 report/ }).click();
  await expect(status.getByRole('heading', { name: 'September 2026 report' })).toBeVisible();
  await expect(status).toContainText('Due with the customer by 15/10/2026');
  await expect(status.locator('[aria-current="step"]')).toHaveText(/Draft/);
  await expect(status).toContainText('Next: submit the draft for review.');
  await status.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => action).toBe('submit');
  await expect(status.locator('[aria-current="step"]')).toHaveText(/In review/);

  // Contents are a tidy list with All / None; written sections are folded away until used.
  const build = page.getByRole('region', { name: 'Prepare the report' });
  await build.getByRole('button', { name: 'None' }).click();
  await expect(build.getByRole('checkbox', { name: 'Executive summary' })).not.toBeChecked();
  await expect(build).toContainText('0 of 16');
  await expect(build.getByRole('button', { name: /Preview the data/ })).toBeDisabled();
  await build.getByRole('button', { name: 'All' }).click();
  await expect(build.getByLabel('Key highlights')).toBeHidden();
  await build.getByText('Written sections').click();
  await expect(build.getByLabel('Key highlights')).toBeVisible();

  // History: one card per period, formatted dates, each file with its state.
  const history2 = page.getByRole('region', { name: 'Report history' });
  const september = history2.getByRole('article').filter({ hasText: '01/09/2026 – 30/09/2026' });
  await expect(september).toContainText('2 files');
  await expect(september).toContainText('Word v2');
  await expect(september).toContainText('PDF v1');
  await expect(history2.getByRole('article').filter({ hasText: '01/08/2026 – 31/08/2026' })).toContainText('sent to it@northwind.example');
  await expect(history2).not.toContainText('2026-10-05 08:30');
});

test('on a phone the Reports tab fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockApi(page, { role: 'manager', permissions: { 'managed_reports.generate': true, 'managed_reports.review': true, 'managed_customers.view': true } });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/managed-customers/12/overview', () => ({ body: { report_due: null } }));
  api.override('GET /api/managed-report-templates', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/managed-services', () => ({ body: {} }));
  api.override('GET /api/managed-customers/12/reports', () => ({ body: { rows: [file(11, 'docx', 2, 'draft')] } }));
  await page.goto('/customers/12/service-profile?section=reports');
  await expect(page.getByRole('region', { name: 'Prepare the report' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
