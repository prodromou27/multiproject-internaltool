import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const results = {
  customers: [{ id: 12, name: 'Northwind Logistics', contact_name: 'Anna Petrou' }],
  assets: [{ id: 5, customer_id: 12, customer_name: 'Northwind Logistics', name: 'FW-HQ-01', asset_type: 'Firewall', retired: false, matched: { field: 'Serial', value: 'FGT60FTK2209XYZ' } }],
  tasks: [{ id: 7, title: 'Patch FW-HQ-01', customer_id: 12, project_title: null, assigned_to_name: 'Alex Mercer', deadline: null }],
  projects: [], visits: [], tickets: [{ id: 3, ticket_number: '9001', subject: 'VPN drops on FW-HQ-01', status_group: 'open', customer_id: 12, customer_name: 'Northwind Logistics' }],
};

test('one search finds customers, assets by serial, tasks, tickets and pages, and opens the one picked', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const asked = [];
  api.override('GET /api/search', ({ request }) => { asked.push(new URL(request.url()).searchParams.get('q')); return { body: results }; });
  await page.goto('/');

  await page.locator('.desktop-topbar').getByRole('button', { name: 'Search' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox', { name: 'Search everything' }).fill('TK2209');
  await expect.poll(() => asked.at(-1)).toBe('TK2209');
  const list = dialog.getByRole('listbox', { name: 'Results' });
  await expect(list.getByRole('option', { name: /FW-HQ-01.*Serial: FGT60FTK2209XYZ/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /Northwind Logistics/ }).first()).toBeVisible();
  await expect(list.getByRole('option', { name: /#9001 VPN drops/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /See all results/ })).toBeVisible();

  // Down to the asset, Enter: the customer's assets, filtered to it.
  await dialog.getByRole('combobox').press('ArrowDown');
  await dialog.getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/\/customers\/12\/service-profile\?section=assets&q=FGT60FTK2209XYZ$/);

  // Ctrl K opens it from anywhere; pages are found by name.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search everything' }).fill('work');
  await page.getByRole('option', { name: /Workload/ }).click();
  await expect(page).toHaveURL(/\/workload$/);
});
