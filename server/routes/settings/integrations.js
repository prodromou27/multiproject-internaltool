const router = require('express').Router();
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { sendTest } = require('../../notifications');
const { assertPublicHttpUrl } = require('../../security');
const { safeSettings, mergeSettings } = require('../../integrationSettings');
const { logSettingsChange } = require('./shared');

async function integrations() {
  const row = await db.prepare("SELECT value FROM settings WHERE key='integrations'").get();
  try { return JSON.parse(row?.value || '{}') || {}; } catch { return {}; }
}

// Validate webhook URLs before storing them. This resolves DNS and rejects
// loopback/private/link-local destinations to prevent SSRF.
async function validateWebhookUrl(url) {
  if (!url) return null; // empty is fine: integration is just unconfigured
  try {
    await assertPublicHttpUrl(url, { label: 'Webhook URL' });
  } catch (e) { return e.message; }
  return null;
}

// GET /api/settings/integrations
router.get('/integrations', requireManager, async (req, res) => {
  res.json(safeSettings(await integrations()));
});

// POST /api/settings/integrations
router.post('/integrations', requireManager, async (req, res) => {
  // Validate all webhook_url fields before storing
  let body;
  try { body = mergeSettings(await integrations(),req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  for (const [platform, cfg] of Object.entries(body || {})) {
    if (cfg && typeof cfg === 'object' && cfg.webhook_url) {
      const err = await validateWebhookUrl(cfg.webhook_url);
      if (err) return res.status(400).json({ error: `${platform} webhook_url: ${err}` });
    }
  }
  const value = JSON.stringify(body);
  (await db.prepare("INSERT INTO settings (key, value) VALUES ('integrations', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(value));
  await logSettingsChange(req, 'integrations_updated', `platforms=${Object.keys(body || {}).join(',')}`);
  res.json({ ok: true });
});

// POST /api/settings/integrations/test  — body: { platform: 'teams'|'webex', settings: {...} }
router.post('/integrations/test', requireManager, async (req, res) => {
  const { platform, settings } = req.body;
  if (!platform || !settings) return res.status(400).json({ error: 'platform and settings required' });
  try {
    await sendTest(platform, mergeSettings(await integrations(),settings));
    res.json({ ok: true, message: `Test notification sent via ${platform}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
