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
  await mockApi(page, { role: 'manager' });
  await page.goto('/maintenance-visits');
  const row = page.getByRole('row', { name: /Quarterly firewall check/ });
  await expect(row).toBeVisible();
  const actionCell = row.getByRole('cell').last();
  await expect(actionCell.getByRole('button', { name: /Submit Report/ })).toBeVisible();
  expect((await actionCell.innerText()).trim()).not.toMatch(/(^|\s)0(\s|$)/);
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
    const grids = [...document.querySelectorAll('div')].filter(el => el.style.gridTemplateColumns.startsWith('repeat(7'));
    const body = grids[grids.length - 1];
    return [...body.children].slice(0, 7).map(cell => Math.round(cell.getBoundingClientRect().width));
  });
  expect(widths).toHaveLength(7);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
});
