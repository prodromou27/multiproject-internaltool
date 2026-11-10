const router = require('express').Router();
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { logAudit } = require('../../auditLog');
const retention = require('../../reportRetention');

/* Settings → Backups & health → Storage: how long customer report files are kept,
   and what is stored. Managers only. */
router.get('/report-retention', requireManager, async (req, res) => {
  res.json({ ...(await retention.settings()), usage: await retention.usage() });
});

router.put('/report-retention', requireManager, async (req, res) => {
  const days = req.body?.days;
  if (!Number.isInteger(days) || days < 0 || days > 3650) return res.status(400).json({ error: 'Keep report files for 0 (always) to 3650 days' });
  if (days > 0 && days < 30) return res.status(400).json({ error: 'Keep report files for at least 30 days (or 0 to keep them always)' });
  await retention.saveSettings({ days });
  await logAudit(db, req, 'settings', null, 'Report files', 'report_retention_updated', days ? `${days} days` : 'kept always');
  res.json({ days, usage: await retention.usage() });
});

// Remove the old files now rather than at the next morning run.
router.post('/report-retention/purge', requireManager, async (req, res) => {
  const result = await retention.purge();
  await logAudit(db, req, 'settings', null, 'Report files', 'report_files_removed', `${result.removed} files, ${result.bytes} bytes`);
  res.json({ ...result, usage: await retention.usage() });
});

module.exports = router;
