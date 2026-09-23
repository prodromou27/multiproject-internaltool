import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('project search reports visible results and can reset the complete view', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects', () => ({ body: [
    { id: 1, title: 'Firewall renewal', customer_name: 'Northwind Logistics', status: 'in_progress', priority: 'high', rag_status: 'amber', created_by_name: 'Alex Mercer', task_count: 4, completed_tasks: 2 },
    { id: 2, title: 'Branch rollout', customer_name: 'Contoso Retail', status: 'not_started', priority: 'medium', rag_status: 'green', created_by_name: 'Alex Mercer', task_count: 2, completed_tasks: 0 },
  ] }));
  await page.goto('/projects');

  await expect(page.getByText('2 of 2 projects')).toBeVisible();
  await page.getByLabel('Search projects').fill('Northwind');
  await expect(page.getByText('1 of 2 projects')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Firewall renewal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Branch rollout' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByLabel('Search projects')).toHaveValue('');
  await expect(page.getByText('2 of 2 projects')).toBeVisible();
});

test('task bulk actions use the shared high-contrast action bar', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/tasks');

  await page.locator('tbody input[type="checkbox"]').first().check();
  const bulkBar = page.locator('.bulk-action-bar');
  await expect(bulkBar).toBeVisible();
  await expect(bulkBar.getByText('1 selected')).toBeVisible();
  await bulkBar.getByRole('button', { name: 'Deselect all' }).click();
  await expect(bulkBar).toHaveCount(0);
});

test('customer directory combines service coverage with recoverable loading', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const customers = [
    { id: 1, name: 'Northwind Logistics', customer_code: 'NWL', active: 1, service_activity_enabled: 1, contract_type: 'Managed', contact_name: 'Mina Cole', contact_email: 'mina@northwind.example', location: 'Nicosia', visit_count: 3 },
    { id: 2, name: 'Contoso Retail', customer_code: 'CTR', active: 1, service_activity_enabled: 0, visit_count: 1 },
    { id: 3, name: 'Legacy Industries', active: 0, service_activity_enabled: 0, visit_count: 0 },
  ];
  let fail = true;
  api.override('GET /api/customers', () => fail
    ? { status: 503, body: { error: 'Customer directory temporarily unavailable' } }
    : { body: customers });
  await page.goto('/customers');

  await expect(page.getByRole('alert')).toContainText('Customer directory temporarily unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('3 of 3 customers')).toBeVisible();
  await page.getByRole('button', { name: /Service tracking/ }).click();
  await expect(page.getByText('1 of 3 customers')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Northwind Logistics' })).toBeVisible();
  await expect(page.getByText('Contoso Retail')).toHaveCount(0);
});

test('managed customer landing filters service health with visible result context', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/managed-customers', () => ({ body: { rows: [
    { id: 1, name: 'Northwind Logistics', responsible_team: 'Security', service_manager: 'Alex Mercer', service_status: 'healthy', open_tickets: 2, pending_tickets: 1, activities_this_month: 8, open_tasks: 2, active_projects: 1 },
    { id: 2, name: 'Contoso Retail', responsible_team: 'Cloud', service_manager: 'Jordan Lee', service_status: 'attention', open_tickets: 4, pending_tickets: 2, activities_this_month: 3, open_tasks: 1, active_projects: 0 },
  ] } }));
  await page.goto('/managed-customers');

  await expect(page.getByText('2 of 2 managed customers')).toBeVisible();
  await page.getByLabel('Service status').selectOption('attention');
  await expect(page.getByText('1 of 2 managed customers')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contoso Retail' })).toBeVisible();
  await expect(page.getByText('Northwind Logistics')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByText('2 of 2 managed customers')).toBeVisible();
});
