import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const slas = [
  { key: 'visit_report', label: 'Maintenance visit report', unit: 'working days', default: 7, description: 'Report within this many working days.' },
  { key: 'task_response', label: 'High-priority task response', unit: 'working days', default: 1, description: 'Picked up within this many working days.' },
  { key: 'tickets', label: 'Ticket due dates (Request Tracker)', unit: 'hours warning', default: 24, description: 'Resolved by the RT due date.' },
];
const metric = (extra = {}) => ({ enabled: true, sla_days: 7, total: 0, ok: 0, at_risk: 0, breached: 0, items: [], ...extra });

test('managers switch SLAs off and change their limits, and the SLA page follows', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let policy = { visit_report: { enabled: true, limit: 7 }, task_response: { enabled: true, limit: 1 }, tickets: { enabled: true, limit: 24 } };
  api.override('GET /api/sla/policy', () => ({ body: { policy, slas } }));
  api.override('PUT /api/sla/policy', ({ body }) => { policy = body; return { body: { policy, slas } }; });
  api.override('GET /api/sla/overview', () => ({ body: {
    generated_at: '2026-10-07T10:00:00Z', policy,
    mv: metric({ sla_days: policy.visit_report.limit }), project_status: metric(), closure_approval: metric({ sla_days: 3 }),
    high_priority_tasks: metric({ enabled: policy.task_response.enabled, sla_days: policy.task_response.limit }),
    tickets: { enabled: true, warning_hours: 24, total: 2, open: 1, on_time: 1, late_complete: 0, at_risk: 0, breached: 1,
      items: [{ id: 1, ticket_number: '9001', subject: 'VPN down', customer_name: 'Northwind Logistics', engineer_name: 'Maria Security', due_at: '2026-10-07T08:00:00Z', breached: true, at_risk: false, late_complete: false, hours_left: -2 }] },
    forecast: { predicted_breaches_next_working_day: 0, current_breaches: 1, escalation_recommended: [] },
  } }));

  await page.goto('/settings/sla');
  await page.getByLabel('Maintenance visit report limit (working days)').fill('5');
  await page.getByRole('row', { name: /High-priority task response/ }).getByRole('switch').click();
  await page.getByRole('button', { name: 'Save SLAs' }).click();
  await expect(page.getByText('SLA settings saved')).toBeVisible();
  expect(policy.visit_report).toEqual({ enabled: true, limit: 5 });
  expect(policy.task_response.enabled).toBe(false);

  await page.goto('/sla');
  await expect(page.getByText('Within 5 working days of the visit')).toBeVisible();
  await expect(page.getByText('High-Priority Task Response')).toHaveCount(0);
  await expect(page.getByText('Tickets resolved by their due date')).toBeVisible();
  await expect(page.getByText('Tickets: 1 breached')).toBeVisible();
});
