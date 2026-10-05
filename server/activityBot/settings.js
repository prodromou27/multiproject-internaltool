/**
 * Activity bot settings (Settings → Integrations → Activity bot). Secrets are
 * encrypted at rest and never sent back to the browser. The Webex bot token is
 * the one already set for Webex notifications.
 */
const db = require('../db');
const { encrypt, decrypt } = require('../fieldCipher');

const KEY = 'activity_bot';
const EMPTY = { webex: { enabled: false, webhook_secret: '', webhook_id: '' }, teams: { enabled: false, app_id: '', app_password: '', tenant_id: '' } };

async function stored() {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  let value = {};
  try { value = row ? JSON.parse(row.value) : {}; } catch { value = {}; }
  return { webex: { ...EMPTY.webex, ...value.webex }, teams: { ...EMPTY.teams, ...value.teams } };
}

/** With secrets decrypted, for the server's own use. */
async function load() {
  const value = await stored();
  return {
    webex: { ...value.webex, webhook_secret: value.webex.webhook_secret ? decrypt(value.webex.webhook_secret) : '' },
    teams: { ...value.teams, app_password: value.teams.app_password ? decrypt(value.teams.app_password) : '' },
  };
}

async function save(value) {
  const current = await stored();
  const next = {
    webex: { ...current.webex, ...value.webex },
    teams: { ...current.teams, ...value.teams },
  };
  if (value.webex?.webhook_secret !== undefined) next.webex.webhook_secret = value.webex.webhook_secret ? encrypt(value.webex.webhook_secret) : '';
  if (value.teams?.app_password !== undefined) next.teams.app_password = value.teams.app_password ? encrypt(value.teams.app_password) : '';
  await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`).run(KEY, JSON.stringify(next));
  return next;
}

const publicUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');

/** What the settings page may see. */
async function view() {
  const value = await stored();
  const integrations = await db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get();
  let webexToken = false;
  try { webexToken = !!JSON.parse(integrations?.value || '{}').webex?.bot_token; } catch { webexToken = false; }
  const base = publicUrl();
  return {
    public_url: base || null,
    public_url_https: /^https:\/\//i.test(base),
    webex: { enabled: !!value.webex.enabled, bot_token_set: webexToken, webhook_registered: !!value.webex.webhook_id, target_url: base ? `${base}/api/bots/webex/events` : null },
    teams: { enabled: !!value.teams.enabled, app_id: value.teams.app_id || '', app_password_set: !!value.teams.app_password, tenant_id: value.teams.tenant_id || '', messaging_endpoint: base ? `${base}/api/bots/teams/messages` : null },
  };
}

module.exports = { load, save, view, publicUrl };
