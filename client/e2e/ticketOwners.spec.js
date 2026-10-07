import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers link RT users to engineers and see the tickets each resolved', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const users = [{ id: 7, name: 'Maria Security', role: 'engineer' }, { id: 8, name: 'Nick Network', role: 'engineer' }];
  let rows = [
    { username: 'mstavrou', name: 'mstavrou', email: 'maria@personal.example', tickets: 12, open_tickets: 2, user_id: null, user_name: null, linked_by: null },
    { username: 'nnetwork', name: 'nnetwork', email: 'nick@odyssey.example', tickets: 30, open_tickets: 4, user_id: 8, user_name: 'Nick Network', linked_by: 'email' },
  ];
  let linked = null;
  api.override('GET /api/ticketing/owners', () => ({ body: { rows, users } }));
  api.override('PUT /api/ticketing/owners', ({ body }) => { linked = body; rows = rows.map(row => row.username === body.username ? { ...row, user_id: body.user_id, linked_by: 'chosen' } : row); return { body: { rows, users } }; });
  api.override('GET /api/workload/tickets', ({ request }) => {
    const months = Number(new URL(request.url()).searchParams.get('months'));
    return { body: { from: '2026-07-07', to: '2026-10-07', months: ['2026-07', '2026-08', '2026-09', '2026-10'], unlinked: { owners: 1, resolved: 5 },
      engineers: [{ id: 8, name: 'Nick Network', role: 'engineer', resolved: months === 6 ? 61 : 31, open_now: 4, avg_days_to_resolve: 1.5,
        by_month: [{ month: '2026-07', count: 5 }, { month: '2026-08', count: 10 }, { month: '2026-09', count: 12 }, { month: '2026-10', count: 4 }],
        customers: [{ id: 1, name: 'Northwind Logistics', count: 20 }, { id: 2, name: 'Contoso Retail', count: 11 }] }] } };
  });

  // The other Ticketing sections, as the server returns them.
  api.override('GET /api/ticketing/mappings', () => ({ body: { statuses: [], priorities: [] } }));
  api.override('GET /api/ticketing/settings', () => ({ body: { enabled: true, base_url: 'https://rt.example', sync_interval_minutes: 10 } }));
  api.override('GET /api/ticketing/monitoring', () => ({ body: { integration: { enabled: true }, summary: {}, customers: [] } }));
  api.override('GET /api/ticketing/sync-runs', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25 } }));
  await page.goto('/settings/ticketing');
  await expect(page.getByText('Matched by email')).toBeVisible();
  await page.getByLabel('TeamHub user for mstavrou').selectOption({ label: 'Maria Security' });
  await expect.poll(() => linked).toEqual({ username: 'mstavrou', user_id: 7 });

  await page.goto('/workload');
  await page.getByRole('button', { name: 'Tickets resolved' }).click();
  const row = page.getByRole('row', { name: /Nick Network/ });
  await expect(row).toContainText('31');
  await expect(row).toContainText('Northwind Logistics (20)');
  await expect(page.getByText('5 resolved tickets belong to 1 RT user not linked')).toBeVisible();
  await page.getByRole('button', { name: '6 months' }).click();
  await expect(row).toContainText('61');
});
