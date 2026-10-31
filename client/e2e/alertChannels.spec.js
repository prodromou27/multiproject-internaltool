import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// Ticket sync alerts reach admins by email (and the bell) only, never Webex or Teams.
test('a manager can choose email for ticket sync alerts, but not Webex or Teams', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const all = ['teams', 'email', 'webex'];
  api.override('GET /api/auth/me', () => ({ body: {
    id: 1, name: 'Alex Mercer', email: 'alex@example.test', role: 'manager',
    notify_external_enabled: true, notify_teams_enabled: true, notify_email_enabled: true,
    email_delivery_available: true, webex_direct_available: true,
    notify_events: { task_assigned: { teams: true, email: true, webex: true }, ticket_sync_failed: { email: true } },
    notify_event_options: [
      { key: 'task_assigned', label: 'A task is assigned to me', channels: all },
      { key: 'ticket_sync_failed', label: 'Request Tracker ticket sync stops working, or starts working again', channels: ['email'] },
    ],
  } }));
  await page.goto('/profile');

  const ticketSync = page.getByRole('row', { name: /Request Tracker ticket sync/ });
  await expect(ticketSync.getByRole('checkbox')).toHaveCount(1);
  await expect(ticketSync.getByRole('checkbox', { name: /: Email$/ })).toBeChecked();
  await expect(ticketSync.getByTitle('Not sent by Teams')).toBeVisible();
  await expect(ticketSync.getByTitle('Not sent by Webex')).toBeVisible();
  // Other alerts still offer every channel.
  await expect(page.getByRole('row', { name: /A task is assigned to me/ }).getByRole('checkbox')).toHaveCount(3);
});
