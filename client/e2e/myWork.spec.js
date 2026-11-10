import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const inDays = days => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('moving a Personal Kanban task to Completed removes its To do card and persists after refresh', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  let task = { id: 7, title: 'Complete firewall review', status: 'open', priority: 'high', assigned_to: 1 };
  api.override('GET /api/tasks', () => ({ body: [task] }));
  api.override('PUT /api/tasks/7', ({ body }) => { task = { ...task, ...body }; return { body: { ok: true } }; });
  await page.goto('/my-day');
  const board = page.locator('.engineer-kanban');
  const todo = board.locator('.kanban-column').filter({ has: page.getByRole('heading', { name: /^To do/ }) });
  const completed = board.locator('.kanban-column').filter({ has: page.getByRole('heading', { name: /^Completed/ }) });
  await todo.locator('.kanban-card').dragTo(completed);
  await expect(todo.locator('.kanban-card')).toHaveCount(0);
  await expect(completed.locator('.kanban-card')).toHaveCount(1);
  await expect(board.locator('.kanban-card')).toHaveCount(1);
  await expect.poll(() => task.status).toBe('completed');
  await page.reload();
  await expect(todo.locator('.kanban-card')).toHaveCount(0);
  await expect(completed.locator('.kanban-card')).toHaveCount(1);
});

test('My Work has what engineers need for the week; their Dashboard stays in the menu', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/tasks', () => ({ body: [{ id: 7, title: 'Patch Cisco ISE', status: 'open', priority: 'high', deadline: inDays(3), assigned_to: 1 }] }));
  api.override('GET /api/maintenance-visits', ({ request }) => {
    const params = new URL(request.url()).searchParams;
    if (params.get('pending_report')) return { body: [{ id: 4, title: 'Quarterly firewall check', customer_name: 'Northwind Logistics', scheduled_date: inDays(-2), status: 'completed', report_sent: 0 }] };
    return { body: [{ id: 5, title: 'Switch health check', customer_name: 'Contoso Retail', scheduled_date: inDays(5), status: 'scheduled', report_sent: 0, report_sent_to_customer: 0 }] };
  });
  let sent = 0;
  api.override('POST /api/maintenance-visits/4/report-sent', () => { sent++; return { body: {} }; });

  await page.goto('/my-day');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'My Work' })).toBeVisible();

  await expect(page.getByText('Overdue and due this week')).toBeVisible();
  await expect(page.locator('.my-day-row').filter({ hasText: 'Patch Cisco ISE' })).toBeVisible();
  await expect(page.getByText('Switch health check')).toBeVisible();
  await page.getByRole('button', { name: 'Mark Sent' }).click();
  await expect.poll(() => sent).toBe(1);
});
