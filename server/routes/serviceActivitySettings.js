const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');

const DEFAULTS = { retention_days: null, allow_attachments: true, allow_follow_up_task_creation: true };

async function getSettings() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'service_activity_settings'").get();
  if (!row) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(row.value) }; } catch { return { ...DEFAULTS }; }
}

// Any authenticated user can read (engineers need allow_attachments/allow_follow_up_task_creation
// to know which UI affordances to show — the values carry no sensitive information).
router.get('/', requireAuth, async (req, res) => {
  res.json(await getSettings());
});

router.put('/', requireManager, async (req, res) => {
  const { retention_days, allow_attachments, allow_follow_up_task_creation } = req.body;
  if (retention_days != null && (!Number.isInteger(retention_days) || retention_days <= 0))
    return res.status(400).json({ error: 'retention_days must be a positive integer or null' });
  const next = {
    retention_days: retention_days ?? null,
    allow_attachments: allow_attachments !== false,
    allow_follow_up_task_creation: allow_follow_up_task_creation !== false,
  };
  await db.prepare(
    "INSERT INTO settings (key, value) VALUES ('service_activity_settings', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
  ).run(JSON.stringify(next));
  await logAudit(db, req, 'service_activity_settings', null, null, 'settings_updated', JSON.stringify(next));
  res.json({ ok: true });
});

// Retention: report how many activities are older than the configured cutoff, and
// (manager-triggered, never automatic) purge them. No background job is introduced —
// this stays a deliberate, audited action so historical data is never silently deleted.
router.get('/retention-status', requireManager, async (req, res) => {
  const settings = await getSettings();
  if (!settings.retention_days) return res.json({ retention_days: null, eligible_count: 0 });
  const cutoff = new Date(Date.now() - settings.retention_days * 86400000).toISOString().slice(0, 10);
  const { c } = await db.prepare('SELECT COUNT(*) AS c FROM service_activities WHERE activity_date < ?').get(cutoff);
  res.json({ retention_days: settings.retention_days, cutoff, eligible_count: c });
});

router.post('/purge', requireManager, async (req, res) => {
  const settings = await getSettings();
  if (!settings.retention_days) return res.status(400).json({ error: 'No retention period configured' });
  const cutoff = new Date(Date.now() - settings.retention_days * 86400000).toISOString().slice(0, 10);
  const { changes } = await db.prepare('DELETE FROM service_activities WHERE activity_date < ?').run(cutoff);
  await logAudit(db, req, 'service_activity_settings', null, null, 'retention_purge', `cutoff=${cutoff}; deleted=${changes}`);
  res.json({ ok: true, deleted: changes });
});

router.getServiceActivitySettings = getSettings;
module.exports = router;
