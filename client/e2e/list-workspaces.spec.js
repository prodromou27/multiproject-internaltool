import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('project search reports visible results and can reset the complete view', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const projects = [
    { id: 1, title: 'Firewall renewal', customer_name: 'Northwind Logistics', status: 'in_progress', priority: 'high', rag_status: 'amber', created_by_name: 'Alex Mercer', task_count: 4, completed_tasks: 2 },
    { id: 2, title: 'Branch rollout', customer_name: 'Contoso Retail', status: 'not_started', priority: 'medium', rag_status: 'green', created_by_name: 'Alex Mercer', task_count: 2, completed_tasks: 0 },
  ];
  api.override('GET /api/projects', ({ request }) => {
    const params = new URL(request.url()).searchParams;
    const search = (params.get('search') || '').toLowerCase();
    const rows = search ? projects.filter(project => [project.title, project.customer_name, project.created_by_name]
      .some(value => value.toLowerCase().includes(search))) : projects;
    return { body: { rows, total: rows.length, page: 1, page_size: 25,
      counts: { all: rows.length, open: rows.length, in_progress: rows.filter(project => project.status === 'in_progress').length,
        not_started: rows.filter(project => project.status === 'not_started').length,
        rag_all: rows.length, rag_amber: rows.filter(project => project.rag_status === 'amber').length,
        rag_green: rows.filter(project => project.rag_status === 'green').length } } };
  });
  await page.goto('/projects');

  await expect(page.getByText('2 of 2 projects')).toBeVisible();
  await page.getByLabel('Search projects').fill('Northwind');
  await expect(page.getByText('1 of 1 projects')).toBeVisible();
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
  api.override('GET /api/customers', ({ request }) => {
    if (fail) return { status: 503, body: { error: 'Customer directory temporarily unavailable' } };
    const view = new URL(request.url()).searchParams.get('view') || 'all';
    const rows = view === 'tracked' ? customers.filter(customer => customer.service_activity_enabled) : customers;
    return { body: { rows, total: rows.length, page: 1, page_size: 25,
      counts: { all: customers.length, active: customers.filter(customer => customer.active).length,
        inactive: customers.filter(customer => !customer.active).length,
        tracked: customers.filter(customer => customer.service_activity_enabled).length } } };
  });
  await page.goto('/customers');

  await expect(page.getByRole('alert')).toContainText('Customer directory temporarily unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('3 of 3 customers')).toBeVisible();
  await page.getByRole('button', { name: /Service tracking/ }).click();
  await expect(page.getByText('1 of 1 customers')).toBeVisible();
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

test('team directory requests bounded pages and keeps role counts',async ({ page }) => {
  const api=await mockApi(page,{ role:'manager' });
  const users=Array.from({ length:28 },(_,index) => ({ id:index+1,name:`Engineer ${String(index+1).padStart(2,'0')}`,
    email:`engineer${index+1}@example.com`,role:'engineer',active:1,created_at:'2026-01-01',last_login:null }));
  api.override('GET /api/auth/users',({ request }) => {
    const params=new URL(request.url()).searchParams,pageNumber=Number(params.get('page') || 1),pageSize=Number(params.get('page_size') || 25);
    const role=params.get('role') || 'all',search=(params.get('search') || '').toLowerCase();
    const searched=users.filter(user => !search || user.name.toLowerCase().includes(search) || user.email.includes(search));
    const filtered=role==='all' ? searched : searched.filter(user => user.role===role);
    const start=(pageNumber-1)*pageSize;
    return { body:{ rows:filtered.slice(start,start+pageSize),total:filtered.length,page:pageNumber,page_size:pageSize,
      counts:{ all:searched.length,manager:0,planner:0,pm:0,engineer:searched.length } } };
  });
  await page.goto('/users');
  await expect(page.getByText('1–25 of 28 accounts')).toBeVisible();
  await expect(page.getByText('Engineer 01')).toBeVisible();
  await page.getByRole('button',{ name:'Next' }).click();
  await expect(page.getByText('26–28 of 28 accounts')).toBeVisible();
  await expect(page.getByText('Engineer 28')).toBeVisible();
  const directoryCalls=api.calls.filter(call => call.method==='GET' && call.path==='/api/auth/users');
  expect(directoryCalls.some(call => call.query.includes('page=2') && call.query.includes('page_size=25'))).toBeTruthy();
});
