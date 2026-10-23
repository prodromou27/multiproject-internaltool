/**
 * Report file retention: customer report files (encrypted, in the uploads folder)
 * are removed after a number of days, while each report's history entry is kept
 * with what it was made from, so it can be generated again from Customer 360 →
 * Reports. Reports still waiting for review are never removed. 0 days keeps files.
 *
 * Compressing would not help: the files are encrypted (encrypted data does not
 * compress), and Word and Excel files are already zip archives.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const appTime = require('./appTime');
const { uploadDir, safeStoredName } = require('./uploadUtils');

const KEY = 'report_retention';
const DEFAULT_DAYS = 90;

async function settings(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  try { const value = JSON.parse(row?.value || '{}'); return { days: Number.isInteger(value.days) ? value.days : DEFAULT_DAYS }; } catch { return { days: DEFAULT_DAYS }; }
}
const saveSettings = (value, store = db) => store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(value));

/** Removes the files of reports generated more than `days` ago; returns how many and how much space. */
async function purge({ store = db, today = appTime.today(), days } = {}) {
  const keep = days ?? (await settings(store)).days;
  if (!keep) return { removed: 0, bytes: 0 };
  const cutoff = appTime.addDays(today, -keep);
  const rows = await store.prepare(`SELECT id, stored_name, size FROM managed_report_history
    WHERE file_removed_at IS NULL AND substr(generated_at, 1, 10) < ? AND workflow_status NOT IN ('in_review', 'approved')`).all(cutoff);
  let removed = 0, bytes = 0;
  for (const row of rows) {
    const name = safeStoredName(row.stored_name);
    if (name) await fs.promises.unlink(path.join(uploadDir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await store.prepare('UPDATE managed_report_history SET file_removed_at = app_now() WHERE id = ? AND file_removed_at IS NULL').run(row.id);
    removed++; bytes += Number(row.size) || 0;
  }
  return { removed, bytes };
}

/** What is stored: report files kept and removed, and attachments. */
async function usage(store = db) {
  const [reports, removed, attachments] = await Promise.all([
    store.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM managed_report_history WHERE file_removed_at IS NULL').get(),
    store.prepare('SELECT COUNT(*) AS n FROM managed_report_history WHERE file_removed_at IS NOT NULL').get(),
    store.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM attachments').get(),
  ]);
  return { report_files: Number(reports.n), report_bytes: Number(reports.bytes), reports_removed: Number(removed.n), attachments: Number(attachments.n), attachment_bytes: Number(attachments.bytes) };
}

module.exports = { KEY, DEFAULT_DAYS, settings, saveSettings, purge, usage };
