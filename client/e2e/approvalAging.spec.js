import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('closure requests show how long they waited, what is still open, and can go to a named reviewer', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const row = { id: 7, title: 'Core refresh', priority: 'high', customer_name: 'Acme Corp', closure_request_version: 1, closure_requested_by: 3, requested_by_name: 'Rita Manager',
    closure_requested_at: '2026-10-01 09:00:00', waiting_days: 9, due_on: '2026-10-06', overdue: true, target_days: 3, open_tasks: 2, open_milestones: 0,
    assigned_to: null, suggested_delegate: { id: 5, name: 'Bea Reviewer' } };
  const reviewers = [{ id: 1, name: 'Alex Mercer', assigned: 1 }, { id: 3, name: 'Rita Manager', assigned: 0 }, { id: 5, name: 'Bea Reviewer', assigned: 0 }];
  let delegated = null;
  api.override('GET /api/projects/approvals', () => ({ body: { rows: [row], reviewers, total: 1, page: 1, page_size: 25 } }));
  api.override('POST /api/projects/7/closure-delegate', ({ body }) => { delegated = body; row.assigned_to = body.user_id; return { body: { ok: true, assigned_to: body.user_id } }; });

  await page.goto('/approvals');
  const line = page.getByRole('row', { name: /Core refresh/ });
  await expect(line.getByText('9 working days')).toBeVisible();
  await expect(line.getByText(/^Overdue since/)).toBeVisible();
  await expect(line.getByRole('cell', { name: '2 tasks' })).toBeVisible();

  const reviewer = page.getByLabel('Reviewer for Core refresh');
  await expect(reviewer.locator('option')).toHaveText(['Any manager', 'Alex Mercer · 1 assigned', 'Bea Reviewer (suggested)']);
  await reviewer.selectOption({ label: 'Bea Reviewer (suggested)' });
  await expect.poll(() => delegated).toEqual({ user_id: 5 });

  await line.getByRole('button', { name: 'Review closure for Core refresh' }).click();
  await expect(page.getByRole('dialog').getByText('Still open: 2 tasks.')).toBeVisible();
});
