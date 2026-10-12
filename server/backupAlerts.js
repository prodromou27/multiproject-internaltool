/**
 * Backup failure alerts. A database backup that fails after its last retry, a
 * backup whose uploaded files could not be included, and an off-server copy
 * (SFTP or network share) that fails after its last retry each alert the
 * managers: in the bell (as a system alert), by email when Settings →
 * Notifications → "Database backup failed" has email on, and in the shared
 * Teams channel / Webex space when that event is switched on there.
 * The same alert switch turned off silences all of it.
 */
const db = require('./db');
const { notifyUser, notifyShared, emailHtml } = require('./notifications');
const { sendEmail } = require('./email');

const WHAT = Object.freeze({
  database: 'The database backup failed',
  files: 'The uploaded files were not included in the backup',
  offsite: 'The off-server backup copy (SFTP) failed',
  share: 'The backup copy to the network share failed',
});

async function alertSwitch(store = db) {
  const row = await store.prepare("SELECT value FROM settings WHERE key = 'admin_notifications_config'").get();
  let saved = {}; try { saved = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  return { enabled: saved.db_backup_failed?.enabled !== false, email: saved.db_backup_failed?.email !== false };
}

/** Whether a failed background job will not be retried (backgroundJobs.js retries until max_attempts). */
const isFinalAttempt = (job, error) => !!error?.permanent || Number(job?.attempts) >= Number(job?.max_attempts);

/** Alerts the managers that a backup step failed. Never throws: a failing alert is logged. */
async function alertBackupFailure(kind, { file = null, error = '' } = {}, store = db) {
  try {
    const cfg = await alertSwitch(store);
    if (!cfg.enabled) return { sent: 0 };
    const title = WHAT[kind] || 'A backup step failed', detail = String(error || '').slice(0, 500);
    const msg = { title: `⚠️ ${title}`, body: `${title}${file ? ` (${file})` : ''}.${detail ? ` ${detail}` : ''} See Settings → Backups.`,
      facts: [...(file ? [{ name: 'Backup', value: file }] : []), ...(detail ? [{ name: 'Error', value: detail }] : [])] };
    const managers = await store.prepare("SELECT id, email FROM users WHERE role = 'manager' AND active = 1").all();
    for (const manager of managers) {
      await notifyUser(Number(manager.id), 'system_alert', msg, { title: `System Alert: ${title}`, body: detail || file, link: '/settings/backups' }, { channels: false });
    }
    if (cfg.email) {
      const sends = managers.filter(m => m.email).map(m => sendEmail({ to: m.email, subject: msg.title, html: emailHtml(msg) }));
      (await Promise.allSettled(sends)).forEach(result => { if (result.status === 'rejected') console.error('[backup alert email]', result.reason?.message); });
    }
    notifyShared('backup_failed', msg, { dedupeKey: `${kind}:${file || detail}` });
    return { sent: managers.length };
  } catch (failure) {
    console.error('[backup alert]', failure.message);
    return { sent: 0 };
  }
}

module.exports = { alertBackupFailure, isFinalAttempt, alertSwitch };
