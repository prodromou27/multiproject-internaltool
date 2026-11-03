import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const weeks = [{ start: '2027-03-01', end: '2027-03-07' }, { start: '2027-03-08', end: '2027-03-14' }];
const cell = (estimated, available, state = 'known') => ({ estimated_hours: estimated, available_hours: available, capacity_percent: state === 'known' ? Math.round(estimated / available * 1000) / 10 : null, state });

test('a manager tries leave and new work and sees the effect, without changing the live plan', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let sent = null;
  api.override('GET /api/workload/planning', () => ({ body: { as_of: '2027-03-01', weeks, coverage: 'Live plan.', engineers: [{ id: 7, name: 'Maria Ioannou', outside_window_count: 0, weeks: weeks.map(w => ({ ...w, capacity_percent: 25, estimated_hours: 10, available_hours: 40, unweighted_hours: 10, item_count: 1, unknown_estimates: 0, availability_version: 1, items: [], items_total: 1 })) }] } }));
  api.override('GET /api/technologies', () => ({ body: [{ id: 3, name: 'FortiGate', active: 1 }] }));
  api.override('POST /api/workload/planning/scenario', ({ body }) => { sent = body; return { body: { saved: false, weeks, beyond_window: [], engineers: [{ id: 7, name: 'Maria Ioannou', changed: true, skill_levels: { 3: 3 },
    weeks: [{ ...weeks[0], live: cell(10, 40), scenario: cell(10, 24) }, { ...weeks[1], live: cell(10, null, 'availability_unknown'), scenario: cell(30, null, 'availability_unknown') }] }] } }; });

  await page.goto('/workload?tab=planning');
  await page.getByRole('button', { name: 'What if…' }).click();
  const panel = page.getByRole('region', { name: 'What if' });
  await expect(panel.getByText('A scenario only. Nothing here is saved')).toBeVisible();
  await panel.getByLabel('Engineer').selectOption({ label: 'Maria Ioannou' });
  await panel.getByLabel('From').fill('2027-03-01');
  await panel.getByLabel('To').fill('2027-03-02');
  await panel.getByRole('button', { name: 'Add change' }).click();
  await panel.getByLabel('Change type').selectOption('work');
  await panel.getByLabel('Engineer').selectOption({ label: 'Maria Ioannou' });
  await panel.getByLabel('From').fill('2027-03-08');
  await panel.getByLabel('To').fill('2027-03-12');
  await panel.getByLabel('Hours').fill('20');
  await panel.getByLabel('What').fill('Firewall project');
  await panel.getByLabel('Technology').selectOption({ label: 'FortiGate' });
  await panel.getByRole('button', { name: 'Add change' }).click();
  await expect(panel.getByText('Firewall project: 20h for Maria Ioannou')).toBeVisible();
  await panel.getByRole('button', { name: 'Show the effect' }).click();

  expect(sent.changes).toEqual([{ type: 'leave', user_id: 7, from: '2027-03-01', to: '2027-03-02' }, { type: 'work', user_id: 7, from: '2027-03-08', to: '2027-03-12', hours: 20, title: 'Firewall project', technology_id: 3 }]);
  const row = panel.getByRole('row', { name: /Maria Ioannou/ });
  await expect(row.getByText('FortiGate: Senior')).toBeVisible();
  await expect(row.getByText('Then: 41.7%')).toBeVisible();
  await expect(row.getByText('40h → 24h available')).toBeVisible();
  await expect(row.getByText('Then: Availability not set')).toBeVisible();
  expect(api.calls.some(call => call.method === 'PUT' && call.path.startsWith('/api/workload/planning'))).toBe(false);
});
