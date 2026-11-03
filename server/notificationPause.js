/**
 * Pausing outgoing notifications (Settings → Integrations), e.g. while creating many
 * projects or tasks at once. While paused, nothing is posted to Webex or Teams and no
 * notification emails are sent; what happens meanwhile is skipped, not queued. The
 * in-app bell keeps working, and so do password-reset emails, scheduled reports and
 * the admin's Test buttons. It stays paused until a manager resumes it.
 */
const db = require('./db');

const KEY = 'notifications_paused';

async function status(store = db) {
  try {
    const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
    const value = row ? JSON.parse(row.value) : null;
    return value?.paused ? { paused: true, since: value.since || null, by: value.by || null } : { paused: false, since: null, by: null };
  } catch { return { paused: false, since: null, by: null }; }
}

const isPaused = async (store = db) => (await status(store)).paused;

async function setPaused(paused, user, store = db) {
  const value = paused ? { paused: true, since: new Date().toISOString(), by: user?.name || null } : { paused: false };
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(value));
  return status(store);
}

module.exports = { status, isPaused, setPaused, KEY };
