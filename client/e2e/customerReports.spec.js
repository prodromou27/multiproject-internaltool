import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 }, is_managed: true };
const report = body => ({
  customer: { id: 12, name: 'Northwind Logistics', team: 'Managed Services' }, period: { from: body.from, to: body.to }, generated_at: '2026-10-11T09:00:00Z',
  // Like the server: with no sections asked for, the template's default ones.
  sections: body.sections || ['work_log', 'changes', 'tickets', 'tasks', 'recommendations', 'upcoming'], summary: body.summary, coming_next: body.coming_next,
  figures: { hours: 36.5, activities: 24, changes: 2, tickets_resolved: 12, tasks_completed: 5, recommendations: 1 },
  categories: [{ name: 'Monitoring', activities: 14, hours: 20 }, { name: 'Upgrades', activities: 4, hours: 10.5 }],
  work_log: [{ date: '2026-09-03', title: 'Reviewed firewall policies', category: 'Monitoring', hours: 1.5 }],
  changes: [{ date: '2026-09-10', device: 'FW-HQ-01', from: '7.4.3', to: '7.4.12', what: 'Firmware upgrade' }],
  tickets: [{ number: '9001', subject: 'VPN drops', resolved: '2026-09-12' }],
  tasks: [{ title: 'Imperva upgrade', completed: '2026-09-20' }],
  recommendations: [{ finding: 'Old switch firmware', recommendation: 'Upgrade SW-CORE', risk: 'high', due: '2026-11-01' }],
  upcoming: [{ title: 'WAF failover test', due: '2026-10-20' }], assets: null,
});

async function reportsTab(page, permissions = { 'managed_reports.generate': true, 'managed_customers.view': true }) {
  const api = await mockApi(page, { role: 'manager', permissions });
  const asked = [], downloads = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/managed-customers/12/overview', () => ({ body: { report_due: { label: 'September 2026', from: '2026-09-01', to: '2026-09-30', due_date: '2026-10-15', status: 'not_started', overdue: false } } }));
  api.override('POST /api/managed-customers/12/customer-report/preview', ({ body }) => { asked.push(body); return { body: report(body) }; });
  for (const format of ['pdf', 'docx']) api.override(`POST /api/managed-customers/12/customer-report.${format}`, ({ body }) => { downloads.push([format, body]); return { body: 'file' }; });
  return { asked, downloads };
}

test('the customer report: pick the period, write a summary, see what we did, and download PDF or Word — no review steps', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-11T09:00:00+03:00'));
  const { asked, downloads } = await reportsTab(page);
  await page.goto('/customers/12/service-profile?section=reports');
  await expect(page.getByText('Submit')).toHaveCount(0);
  await expect(page.getByText('Mark as sent')).toHaveCount(0);
  await expect(page.getByText(/Reports made/)).toHaveCount(0);

  // The report owed for September is one click away.
  await page.getByRole('button', { name: 'Use September 2026' }).click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  const preview = page.getByRole('article', { name: 'Report preview' });
  await expect(preview).toContainText('Northwind Logistics');
  await expect(preview).toContainText('36.5');
  await expect(preview.getByRole('region', { name: 'Changes and upgrades' })).toContainText('7.4.12');
  await expect(preview.getByRole('region', { name: 'Work delivered' })).toContainText('Monitoring');

  await page.getByLabel('Summary for the customer (optional)').fill('A stable month.');
  await page.getByLabel('Work log (every activity)').uncheck();
  await expect.poll(() => asked.at(-1)).toMatchObject({ summary: 'A stable month.', sections: ['changes', 'tickets', 'tasks', 'recommendations', 'upcoming'] });
  await expect(preview).toContainText('A stable month.');
  await expect(preview.getByRole('region', { name: 'Work log' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Download PDF' }).click();
  await expect.poll(() => downloads[0]).toEqual(['pdf', { from: '2026-09-01', to: '2026-09-30', sections: ['changes', 'tickets', 'tasks', 'recommendations', 'upcoming'], summary: 'A stable month.', coming_next: '' }]);
  await page.getByRole('button', { name: 'Download Word' }).click();
  await expect.poll(() => downloads[1]?.[0]).toBe('docx');
});

test('people who may not generate reports see the preview without downloads', async ({ page }) => {
  await reportsTab(page, { 'managed_customers.view': true, 'managed_reports.generate': false });
  await page.goto('/customers/12/service-profile?section=reports');
  await expect(page.getByRole('article', { name: 'Report preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
});

test('on a phone the Reports tab fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reportsTab(page);
  await page.goto('/customers/12/service-profile?section=reports');
  await expect(page.getByRole('article', { name: 'Report preview' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('previous reports: download a kept file, or generate again one whose file was removed', async ({ page }) => {
  const { downloads } = await reportsTab(page);
  let fetched = null;
  await page.route('**/api/managed-customers/12/reports', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rows: [
    { id: 41, period_start: '2026-09-01', period_end: '2026-09-30', output_format: 'pdf', original_name: 'northwind_sep.pdf', generated_at: '2026-10-02 09:00:00', generated_by_name: 'Alex Mercer', file_removed_at: null, request: null },
    { id: 12, period_start: '2026-05-01', period_end: '2026-05-31', output_format: 'docx', original_name: 'northwind_may.docx', generated_at: '2026-06-02 09:00:00', generated_by_name: 'Alex Mercer',
      file_removed_at: '2026-09-01 08:00:00', request: { from: '2026-05-01', to: '2026-05-31', sections: ['changes'], summary: 'A quiet May', coming_next: '' } },
  ] }) }));
  await page.route('**/api/managed-customers/12/reports/41/download', route => { fetched = 41; return route.fulfill({ contentType: 'application/pdf', body: '%PDF' }); });
  await page.goto('/customers/12/service-profile?section=reports');
  const history = page.getByRole('region', { name: 'Previous reports' });
  await expect(history.getByRole('row', { name: /PDF/ })).toBeVisible();
  await expect(history.getByText(/File removed/)).toBeVisible();

  await history.getByRole('button', { name: /^Download the report for/ }).click();
  await expect.poll(() => fetched).toBe(41);
  await history.getByRole('button', { name: /^Generate again the report for/ }).click();
  await expect.poll(() => downloads.at(-1)).toEqual(['docx', { from: '2026-05-01', to: '2026-05-31', sections: ['changes'], summary: 'A quiet May', coming_next: '' }]);
});

test('Settings → Backups & health → Storage: how long report files are kept', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let saved = null;
  api.override('GET /api/settings/report-retention', () => ({ body: { days: 90, usage: { report_files: 120, report_bytes: 52428800, reports_removed: 30, attachments: 400, attachment_bytes: 1073741824 } } }));
  api.override('PUT /api/settings/report-retention', ({ body }) => { saved = body; return { body: { days: body.days, usage: { report_files: 120, report_bytes: 52428800, reports_removed: 30, attachments: 400, attachment_bytes: 1073741824 } } }; });
  await page.goto('/settings/storage');
  await expect(page.getByText('Report files: 120 (50.0 MB), 30 removed after the limit · Attachments: 400 (1.0 GB)')).toBeVisible();
  await page.getByLabel('Keep customer report files for (days)').fill('180');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => saved).toEqual({ days: 180 });
});
