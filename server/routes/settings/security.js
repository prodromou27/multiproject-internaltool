const router = require('express').Router();
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { logSettingsChange } = require('./shared');

/* ── Security / password policy ─────────────────────────────── */
const DEFAULT_SECURITY = { password_expiry_days: 90 };

router.get('/security', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='security_policy'").get());
  if (!row) return res.json(DEFAULT_SECURITY);
  try { res.json({ ...DEFAULT_SECURITY, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_SECURITY); }
});

router.put('/security', requireManager, async (req, res) => {
  const days = req.body?.password_expiry_days;
  if (!Number.isInteger(days) || days<0 || days>3650)
    return res.status(400).json({ error: 'Password expiry must be an integer from 0 to 3650 days; use 0 explicitly to disable expiry' });
  // Also update the standalone key used by auth.js for fast lookup
  await db.transaction(async tx => {
    await tx.prepare("INSERT INTO settings (key,value) VALUES ('password_expiry_days',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(String(days));
    await tx.prepare("INSERT INTO settings (key,value) VALUES ('security_policy',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ password_expiry_days: days }));
  });
  await logSettingsChange(req, 'security_policy_updated', `password_expiry_days=${days}`);
  res.json({ ok: true, password_expiry_days: days });
});

module.exports = router;
