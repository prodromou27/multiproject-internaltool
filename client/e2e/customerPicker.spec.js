import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('forms search customers instead of loading them all, and work by keyboard', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const all = [{ id: 1, name: 'Northwind Logistics', active: 1 }, { id: 2, name: 'Contoso Retail', active: 1 }];
  api.override('GET /api/customers', ({ request }) => {
    const params = new URL(request.url()).searchParams;
    const q = (params.get('search') || '').toLowerCase();
    return { body: params.get('paged') ? { rows: all.filter(c => c.name.toLowerCase().includes(q)), total: 2, page: 1, page_size: 10 } : all };
  });
  api.override('GET /api/customers/2', () => ({ body: all[1] }));
  await page.goto('/tasks');
  await page.getByRole('button', { name: '+ New Task' }).click();
  const box = page.locator('#task-customer');
  await box.fill('cont');
  await expect(page.getByRole('option', { name: 'Contoso Retail' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Northwind Logistics' })).toHaveCount(0);
  await box.press('ArrowDown'); // past "No customer" to the match
  await box.press('Enter');
  await expect(box).toHaveValue('Contoso Retail');
  const lists = api.calls.filter(call => call.method === 'GET' && call.path === '/api/customers');
  expect(lists.every(call => /paged=1/.test(call.query))).toBe(true);
  expect(lists.some(call => /search=cont/.test(call.query))).toBe(true);
});
