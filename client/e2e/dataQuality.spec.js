import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const rules = { no_contact: 'No contact email or primary contact', no_owner: 'Managed customer without a responsible team or service manager', review_due: 'Devices not reviewed in 90 days' };

test('managers see what to fix on customer records, fix it in one click, or dismiss it with a reason', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let items = [
    { customer_id: 4, customer_name: 'Acme Corp', rule: 'no_owner', title: rules.no_owner, detail: 'No service manager.', fix: '/customers/4?section=service-configuration', owner: 'Security Team', dismissed: null },
    { customer_id: 9, customer_name: 'Northwind', rule: 'review_due', title: rules.review_due, detail: '3 devices to review.', fix: '/customers/9?section=assets&view=review', owner: null, dismissed: null },
  ];
  let dismissedWith = null;
  api.override('GET /api/data-quality', () => ({ body: { rules, items } }));
  api.override('POST /api/data-quality/dismiss', ({ body }) => {
    dismissedWith = body;
    items = items.map(item => (item.customer_id === body.customer_id && item.rule === body.rule ? { ...item, dismissed: { reason: body.reason, by: 'Alex Mercer' } } : item));
    return { body: { ok: true } };
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Data quality' }).click();
  await expect(page.getByText('2 to fix')).toBeVisible();
  await expect(page.getByRole('row', { name: /Northwind Devices not reviewed in 90 days 3 devices to review\. No owner/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fix Acme Corp: Managed customer without a responsible team or service manager' })).toHaveAttribute('href', '/customers/4?section=service-configuration');

  await page.getByRole('button', { name: 'Dismiss Northwind: Devices not reviewed in 90 days' }).click();
  const why = page.getByLabel('Why Northwind: Devices not reviewed in 90 days is fine');
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toBeDisabled();
  await why.fill('Lab kit, reviewed yearly');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText('1 to fix')).toBeVisible();
  expect(dismissedWith).toEqual({ customer_id: 9, rule: 'review_due', reason: 'Lab kit, reviewed yearly' });
  await page.getByLabel('Show dismissed (1)').check();
  await expect(page.getByText('Dismissed by Alex Mercer: Lab kit, reviewed yearly')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo dismiss' })).toBeVisible();
});

test('engineers do not get the page', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/data-quality');
  await expect(page.getByText('Access unavailable')).toBeVisible();
});
