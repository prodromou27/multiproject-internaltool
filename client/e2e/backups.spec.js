import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const row = (file, kind, extra = {}) => ({ file, kind, size_bytes: 2_400_000, created_at: '2026-10-07T00:30:00Z', created_by: null, verified_at: null, verify_result: null, verify_error: null, ...extra });

test('managers back up, check and restore the database from Settings', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let rows = [row('teamhub-20261007-003000-scheduled.sql.gz', 'scheduled')];
  let restored = null, schedule = { enabled: true, time: '02:30', retention_days: 14, keep_min: 3 };
  api.override('GET /api/settings/backups', () => ({ body: { rows, schedule, busy: null, restoring: false, tools: 'pg_dump (PostgreSQL) 16.10' } }));
  api.override('POST /api/settings/backups', () => { const made = row('teamhub-20261007-101500-manual.sql.gz', 'manual', { created_at: '2026-10-07T10:15:00Z', created_by: 'Alex Mercer' }); rows = [made, ...rows]; return { status: 201, body: made }; });
  api.override('POST /api/settings/backups/teamhub-20261007-101500-manual.sql.gz/verify', () => { rows[0] = { ...rows[0], verified_at: '2026-10-07T10:16:00Z', verify_result: { tables: 84, users: 12 } }; return { body: { tables: 84, users: 12 } }; });
  api.override('POST /api/settings/backups/teamhub-20261007-003000-scheduled.sql.gz/restore', ({ body }) => { restored = body; return { body: { restarting: true } }; });
  api.override('PUT /api/settings/backups/schedule', ({ body }) => { schedule = body; return { body }; });

  await page.goto('/settings/backups');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backed up (2.3 MB)')).toBeVisible();
  await expect(page.getByRole('row', { name: /Manual/ })).toContainText('by Alex Mercer');
  await page.getByRole('row', { name: /Manual/ }).getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('The backup restores: 84 tables, 12 users')).toBeVisible();
  await expect(page.getByRole('row', { name: /Manual/ })).toContainText('Restores');

  await page.getByLabel('Keep backups for (days)').fill('30');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect.poll(() => schedule.retention_days).toBe(30);

  await page.getByRole('row', { name: /Scheduled/ }).getByRole('button', { name: 'Restore' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore backup' });
  await expect(dialog).toContainText('A backup of the current data is made first');
  await dialog.getByLabel('Your password').fill('secret');
  await expect(dialog.getByRole('button', { name: 'Restore' })).toBeDisabled();
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('TeamHub is restarting')).toBeVisible();
  expect(restored).toEqual({ confirm: 'RESTORE', password: 'secret' });
});

test('without the PostgreSQL tools the page says what to do', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/settings/backups', () => ({ body: { rows: [], schedule: { enabled: true, time: '02:30', retention_days: 14, keep_min: 3 }, busy: null, restoring: false, tools: null } }));
  await page.goto('/settings/backups');
  await expect(page.getByText('the PostgreSQL tools (pg_dump, psql) are missing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeDisabled();
});

test('managers set up encrypted off-server copies over SFTP and trust the server key', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const schedule = { enabled: true, time: '02:30', retention_days: 14, keep_min: 3 };
  let view = { enabled: false, host: '', port: 22, username: '', auth_method: 'password', remote_dir: '/teamhub-backups', host_fingerprint: null, has_password: false, has_private_key: false, has_passphrase: false, last: null };
  let saved = null, trusted = null;
  api.override('GET /api/settings/backups', () => ({ body: { rows: [row('teamhub-20261007-003000-scheduled.sql.gz', 'scheduled')], schedule, busy: null, restoring: false, tools: 'pg_dump 16' } }));
  api.override('GET /api/settings/backups/offsite', () => ({ body: view }));
  api.override('PUT /api/settings/backups/offsite', ({ body }) => {
    saved = body;
    view = { ...view, ...Object.fromEntries(Object.entries(body).filter(([k]) => ['host', 'port', 'username', 'remote_dir', 'enabled'].includes(k))), has_password: true, has_passphrase: true };
    return { body: view };
  });
  api.override('POST /api/settings/backups/offsite/test', () => ({ body: { fingerprint: 'SHA256:abc123', trusted: false } }));
  api.override('POST /api/settings/backups/offsite/trust', ({ body }) => { trusted = body.fingerprint; view = { ...view, host_fingerprint: body.fingerprint }; return { body: view }; });

  await page.goto('/settings/backups');
  const section = page.getByRole('region', { name: 'Off-server copies (SFTP)' });
  await expect(section.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  await section.getByLabel('SFTP host').fill('nas.example.local');
  await section.getByLabel('User').fill('teamhub');
  await section.getByLabel('Folder on the server').fill('/backups/teamhub');
  await section.getByLabel('SFTP password').fill('sftp-secret');
  await section.getByLabel('Encryption passphrase').fill('a long backup passphrase');
  await section.getByLabel('Your TeamHub password').fill('Manager#pass1');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saved).toMatchObject({ host: 'nas.example.local', username: 'teamhub', remote_dir: '/backups/teamhub', sftp_password: 'sftp-secret', encryption_passphrase: 'a long backup passphrase', password: 'Manager#pass1' });

  await section.getByRole('button', { name: 'Test connection' }).click();
  await expect(section.getByText('SHA256:abc123')).toBeVisible();
  await section.getByRole('button', { name: 'Trust this key' }).click();
  await expect.poll(() => trusted).toBe('SHA256:abc123');
  await section.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(() => saved.enabled).toBe(true);
  await expect(page.getByRole('button', { name: /Copy off-server/ })).toBeVisible();
});
