import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const view = connection => ({ public_url: 'http://teamhub.company.local', public_url_https: false,
  webex: { enabled: true, bot_token_set: true, webhook_registered: false, target_url: 'http://teamhub.company.local/api/bots/webex/events', connection },
  teams: { enabled: false, app_id: '', app_password_set: false, tenant_id: '', messaging_endpoint: null } });

test('the Webex bot connects out: Settings shows the connection, and the webhook is only an alternative', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let current = view({ status: 'connected', since: '2026-10-20T08:00:00Z', error: null });
  api.override('GET /api/settings/activity-bot', () => ({ body: current }));
  await page.goto('/settings/activity_bot');
  await expect(page.getByText('Connected to Webex')).toBeVisible();
  await expect(page.getByText(/nothing on this server needs to be reachable from the internet/)).toBeVisible();
  // The webhook is tucked away and needs a public https:// address.
  await expect(page.getByRole('button', { name: 'Register webhook' })).toBeHidden();
  await page.getByText('Alternative: a webhook').click();
  await expect(page.getByRole('button', { name: 'Register webhook' })).toBeDisabled();
  await expect(page.getByText('Needs APP_URL to be a public https:// address.')).toBeVisible();

  current = view({ status: 'reconnecting', since: '2026-10-20T08:00:00Z', error: 'Could not register with Webex: wdm-a.wbx2.com did not answer in time' });
  await page.reload();
  await expect(page.getByText('Reconnecting: Could not register with Webex: wdm-a.wbx2.com did not answer in time')).toBeVisible();
});

test('the last message the Webex bot received is shown, with why it was not answered', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/settings/activity-bot', () => ({ body: view({ status: 'connected', since: '2026-10-20T08:00:00Z', error: null,
    last_message: { at: '2026-10-20T09:15:00Z', outcome: 'failed', error: 'webexapis.com answered 404: The requested resource could not be found.' } }) }));
  await page.goto('/settings/activity_bot');
  await expect(page.getByText('Connected to Webex')).toBeVisible();
  await expect(page.getByText(/Last message .*: not answered \(webexapis\.com answered 404/)).toBeVisible();
  await expect(page.getByText(/nothing received from Webex yet/)).toBeVisible();
});
