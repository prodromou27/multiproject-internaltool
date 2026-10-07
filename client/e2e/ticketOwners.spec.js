import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers pick each user\'s RT account and see the tickets each resolved', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let links = [
    { id: 7, name: 'Maria Security', email: 'maria@odyssey.example', role: 'engineer', rt_username: null, synced_at: null, sync_error: null, open_tickets: 0, resolved_3m: 0 },
    { id: 8, name: 'Nick Network', email: 'nick@odyssey.example', role: 'engineer', rt_username: null, synced_at: null, sync_error: null, open_tickets: 0, resolved_3m: 0 },
    { id: 9, name: 'Pat Planner', email: 'pat@odyssey.example', role: 'planner', rt_username: 'ppat', synced_at: '2026-10-07 09:00:00', sync_error: null, open_tickets: 2, resolved_3m: 14 },
  ];
  const saved = [];
  api.override('GET /api/ticketing/user-links', () => ({ body: { rows: links } }));
  api.override('GET /api/ticketing/rt-users', () => ({ body: { rows: [
    { username: 'mstavrou', email: 'maria@personal.example', real_name: 'Maria Stavrou' },
    { username: 'nnetwork', email: 'nick@odyssey.example', real_name: 'Nick N' },
    { username: 'ppat', email: 'pat@odyssey.example', real_name: null },
  ] } }));
  for (const id of [7, 8]) api.override(`PUT /api/ticketing/user-links/${id}`, ({ body }) => { saved.push([id, body.rt_username]); links = links.map(row => row.id === id ? { ...row, rt_username: body.rt_username } : row); return { body: { rows: links } }; });
  api.override('GET /api/workload/tickets', ({ request }) => {
    const months = Number(new URL(request.url()).searchParams.get('months'));
    return { body: { from: '2026-07-07', to: '2026-10-07', months: ['2026-07', '2026-08', '2026-09', '2026-10'], unlinked_engineers: 1,
      engineers: [{ id: 8, name: 'Nick Network', role: 'engineer', rt_username: 'nnetwork', synced_at: '2026-10-07 09:00:00', sync_error: null, resolved: months === 6 ? 61 : 31, open_now: 4, avg_days_to_resolve: 1.5,
        by_month: [{ month: '2026-07', count: 5 }, { month: '2026-08', count: 10 }, { month: '2026-09', count: 12 }, { month: '2026-10', count: 4 }],
        customers: [{ name: 'Northwind Logistics', count: 20 }, { name: 'Internal IT', count: 11 }] }] } };
  });

  // The other Ticketing sections, as the server returns them.
  api.override('GET /api/ticketing/mappings', () => ({ body: { statuses: [], priorities: [] } }));
  api.override('GET /api/ticketing/settings', () => ({ body: { enabled: true, base_url: 'https://rt.example', sync_interval_minutes: 10 } }));
  api.override('GET /api/ticketing/monitoring', () => ({ body: { integration: { enabled: true }, summary: {}, customers: [] } }));
  api.override('GET /api/ticketing/sync-runs', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25 } }));
  await page.goto('/settings/ticketing');
  // Nick's TeamHub email is also his RT email; Maria's is not.
  await page.getByRole('button', { name: 'Link 1 by matching email' }).click();
  await expect.poll(() => saved).toEqual([[8, 'nnetwork']]);
  await expect(page.getByLabel('RT user for Maria Security').locator('option', { hasText: 'ppat' })).toBeDisabled();
  await page.getByLabel('RT user for Maria Security').selectOption('mstavrou');
  await expect.poll(() => saved).toEqual([[8, 'nnetwork'], [7, 'mstavrou']]);
  await expect(page.getByRole('row', { name: /Pat Planner/ })).toContainText('14 resolved in 3 months');

  await page.goto('/workload');
  await page.getByRole('button', { name: 'Tickets resolved' }).click();
  const row = page.getByRole('row', { name: /Nick Network/ });
  await expect(row).toContainText('31');
  await expect(row).toContainText('Northwind Logistics (20)');
  await expect(page.getByText('1 engineer is not linked to a Request Tracker user')).toBeVisible();
  await page.getByRole('button', { name: '6 months' }).click();
  await expect(row).toContainText('61');
});
