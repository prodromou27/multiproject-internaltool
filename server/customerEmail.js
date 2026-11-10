/**
 * Whether the app may email customers at all (Settings → Email & notifications →
 * Emails to customers). Off unless a manager turns it on. Today the only email to a
 * customer is a response sent by hand from the response composer; nothing sends
 * reports to customers on its own. Anything that emails a customer must check this.
 */
const db = require('./db');

const KEY = 'customer_email';

async function customerEmailEnabled(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  try { return JSON.parse(row?.value || '{}').enabled === true; } catch { return false; }
}

async function setCustomerEmail(enabled, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify({ enabled: !!enabled }));
}

module.exports = { KEY, customerEmailEnabled, setCustomerEmail };
