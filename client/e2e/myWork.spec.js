import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const inDays = days => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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
