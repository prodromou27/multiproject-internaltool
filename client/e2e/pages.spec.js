import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('tasks lists the rows the API returns', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/tasks');
  await expect(page.getByText('Renew firewall support contract')).toBeVisible();
  await expect(page.getByText('Update VPN runbook')).toBeVisible();
});

// The database returns report_sent as 0 or 1. A `0 && <button>` in the page once
// printed a literal "0" next to the actions.
test('maintenance visits do not print a stray 0 next to the actions', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const pastDay = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const futureDay = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const visit = { customer_id: 1, customer_name: 'Northwind Logistics', engineer_ids: [1], engineer_names: 'Alex Mercer', status: 'scheduled', report_sent: 0, report_sent_to_customer: 0 };
  api.override('GET /api/maintenance-visits', () => ({ body: [
    { ...visit, id: 1, title: 'Quarterly firewall check', scheduled_date: pastDay },
    { ...visit, id: 2, title: 'Switch stack upgrade', scheduled_date: futureDay },
  ] }));
  await page.goto('/maintenance-visits?filter=all');
  const row = page.getByRole('row', { name: /Quarterly firewall check/ });
  await expect(row).toBeVisible();
  const actionCell = row.getByRole('cell').last();
  await expect(actionCell.getByRole('button', { name: /Submit Report/ })).toBeVisible();
  expect((await actionCell.innerText()).trim()).not.toMatch(/(^|\s)0(\s|$)/);
  // A visit still ahead has no report to submit yet.
  const upcoming = page.getByRole('row', { name: /Switch stack upgrade/ });
  await expect(upcoming).toBeVisible();
  await expect(upcoming.getByRole('button', { name: /Submit Report/ })).toHaveCount(0);
});

// The day columns once took their width from the longest event title, so a long
// title stretched its own column and squeezed the others.
test('calendar day columns stay equal width with a long event title', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-21T10:00:00'));
  await mockApi(page, { role: 'manager' });
  await page.goto('/calendar');
  await expect(page.getByText(/Renew firewall support contract with a deliberately/).first()).toBeVisible();
  // The header row has its own grid, so measure the day cells in the body grid.
  const widths = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('div')].filter(el => { const cs = getComputedStyle(el); return cs.display === 'grid' && cs.gridTemplateColumns.split(' ').length === 7; });
    const body = grids[grids.length - 1];
    return [...body.children].slice(0, 7).map(cell => Math.round(cell.getBoundingClientRect().width));
  });
  expect(widths).toHaveLength(7);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
});
