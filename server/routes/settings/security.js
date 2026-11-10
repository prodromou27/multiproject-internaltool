const router = require('express').Router();
const { z } = require('zod');
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { logSettingsChange } = require('./shared');

/* ── Security / password policy ─────────────────────────────── */
const DEFAULT_SECURITY = { password_expiry_days: 90 };

// Demonstrates the zod-based validate() middleware (see middleware/validate.js)
// on a small, low-risk endpoint — not applied app-wide.
const securitySchema = z.object({
  password_expiry_days: z.number('Password expiry must be an integer from 0 to 3650 days; use 0 explicitly to disable expiry')
    .int('Password expiry must be a whole number of days')
    .min(0, 'Password expiry cannot be negative')
    .max(3650, 'Password expiry cannot exceed 3650 days'),
});

router.get('/security', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='security_policy'").get());
  if (!row) return res.json(DEFAULT_SECURITY);
  try { res.json({ ...DEFAULT_SECURITY, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_SECURITY); }
});

router.put('/security', requireManager, validate(securitySchema), async (req, res) => {
  const { password_expiry_days: days } = req.body;
  // Also update the standalone key used by auth.js for fast lookup
  await db.transaction(async tx => {
    await tx.prepare("INSERT INTO settings (key,value) VALUES ('password_expiry_days',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(String(days));
    await tx.prepare("INSERT INTO settings (key,value) VALUES ('security_policy',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ password_expiry_days: days }));
  });
  await logSettingsChange(req, 'security_policy_updated', `password_expiry_days=${days}`);
  res.json({ ok: true, password_expiry_days: days });
});

module.exports = router;
