import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// The Settings and Project pages are large modules split into several files. A name
// that goes missing in a split only fails when that section renders ("X is not
// defined"), and the build cannot see it. These tests open every section and fail on
// any such error. Sections may show an error message for the sparse mock data; what
// they must never do is reference something that does not exist.

const SETTINGS_TABS = [
  'overview', 'users', 'projects', 'maintenance', 'statuses', 'service_activity_tracking',
  'integrations', 'weekly_report', 'localization', 'security', 'audit_log', 'logging',
  'admin_alerts', 'stats', 'activity', 'deployment', 'export', 'system_update',
];

function collectReferenceErrors(page) {
  const problems = [];
  const check = text => { if (/is not defined|is not a function|Cannot access .* before initialization/.test(text)) problems.push(text); };
  page.on('pageerror', error => check(String(error.message)));
  page.on('console', message => { if (message.type() === 'error') check(message.text()); });
  return problems;
}

for (const tab of SETTINGS_TABS) {
  test(`settings section "${tab}" opens without a missing reference`, async ({ page }) => {
    const problems = collectReferenceErrors(page);
    await mockApi(page, { role: 'manager' });
    await page.goto(`/settings/${tab}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });
}

test('a project page opens without a missing reference', async ({ page }) => {
  const problems = collectReferenceErrors(page);
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: {
    id: 1, title: 'Network refresh, Rotterdam', status: 'in_progress', priority: 'high', deadline: '2026-10-30',
    customer_name: 'Northwind Logistics', description: 'Replace the core switches.', members: [], tasks: [], milestones: [],
    completion_pct: 40, rag_status: 'amber',
  } }));
  await page.goto('/projects/1');
  await expect(page.getByRole('heading', { name: 'Network refresh, Rotterdam' }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});
