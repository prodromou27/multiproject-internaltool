const router = require('express').Router();
const db     = require('../db');
const fs     = require('fs');
const path   = require('path');
const { requireManager } = require('../middleware/auth');
const { sendTest } = require('../notifications');
const updateMgr = require('../update-manager');

// GET /api/settings/integrations
router.get('/integrations', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get();
  if (!row) return res.json({});
  try { res.json(JSON.parse(row.value)); } catch { res.json({}); }
});

// ── Validate webhook URLs to prevent SSRF ────────────────────────────────────
const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/;
function validateWebhookUrl(url) {
  if (!url) return null; // empty is fine — integration is just unconfigured
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return 'Webhook URL must use http or https';
    if (PRIVATE_HOST_RE.test(u.hostname)) return `Webhook URL must not point to a private or internal host (${u.hostname})`;
  } catch { return 'Invalid webhook URL format'; }
  return null;
}

// POST /api/settings/integrations
router.post('/integrations', requireManager, (req, res) => {
  // Validate all webhook_url fields before storing
  const body = req.body;
  for (const [platform, cfg] of Object.entries(body || {})) {
    if (cfg && typeof cfg === 'object' && cfg.webhook_url) {
      const err = validateWebhookUrl(cfg.webhook_url);
      if (err) return res.status(400).json({ error: `${platform} webhook_url: ${err}` });
    }
  }
  const value = JSON.stringify(body);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('integrations', ?)").run(value);
  res.json({ ok: true });
});

// POST /api/settings/integrations/test  — body: { platform: 'teams'|'webex', settings: {...} }
router.post('/integrations/test', requireManager, async (req, res) => {
  const { platform, settings } = req.body;
  if (!platform || !settings) return res.status(400).json({ error: 'platform and settings required' });
  try {
    await sendTest(platform, settings);
    res.json({ ok: true, message: `Test notification sent via ${platform}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ── Localization config ────────────────────────────────────── */
const DEFAULT_LOCALIZATION = {
  default_language: 'en',
  supported_languages: ['en', 'el'],
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  number_format: '1,000.00',
  timezone: 'Asia/Nicosia',
};

router.get('/localization', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='localization_config'").get();
  if (!row) return res.json(DEFAULT_LOCALIZATION);
  try { res.json({ ...DEFAULT_LOCALIZATION, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOCALIZATION); }
});

router.put('/localization', requireManager, (req, res) => {
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('localization_config',?)").run(JSON.stringify(req.body));
  res.json({ ok: true });
});

/* ── Admin Notifications config ─────────────────────────────── */
const ALERT_DEFAULTS = {
  background_job_failed:     { enabled: true,  email: false },
  email_queue_failed:        { enabled: true,  email: true  },
  db_backup_failed:          { enabled: true,  email: true  },
  storage_almost_full:       { enabled: true,  email: false },
  high_error_rate:           { enabled: true,  email: false },
  unauthorized_access:       { enabled: true,  email: true  },
  integration_token_expiring:{ enabled: true,  email: false },
};

router.get('/admin-notifications', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='admin_notifications_config'").get();
  if (!row) return res.json(ALERT_DEFAULTS);
  try {
    const saved = JSON.parse(row.value);
    // merge so new alert types get their defaults
    const merged = {};
    Object.keys(ALERT_DEFAULTS).forEach(k => { merged[k] = { ...ALERT_DEFAULTS[k], ...(saved[k] || {}) }; });
    res.json(merged);
  } catch { res.json(ALERT_DEFAULTS); }
});

router.put('/admin-notifications', requireManager, (req, res) => {
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('admin_notifications_config',?)").run(JSON.stringify(req.body));
  res.json({ ok: true });
});

// POST /api/settings/system-alerts/check — run real checks, push in-app notifications
router.post('/system-alerts/check', requireManager, (req, res) => {
  const alerts = [];

  // 1. Upload storage size
  try {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (fs.existsSync(uploadsDir)) {
      let total = 0;
      fs.readdirSync(uploadsDir).forEach(f => {
        try { total += fs.statSync(path.join(uploadsDir, f)).size; } catch {}
      });
      const mb = total / (1024 * 1024);
      if (mb > 200) alerts.push({ type: 'storage_almost_full', level: 'warning', message: `Upload storage is at ${mb.toFixed(1)} MB (threshold: 200 MB)` });
      else alerts.push({ type: 'storage_almost_full', level: 'ok', message: `Storage usage: ${mb.toFixed(1)} MB — OK` });
    }
  } catch {}

  // 2. SMTP / email queue
  try {
    const smtpRow = db.prepare("SELECT value FROM settings WHERE key='report_smtp_config'").get();
    if (smtpRow) {
      const smtp = JSON.parse(smtpRow.value);
      if (smtp.enabled && !smtp.host) alerts.push({ type: 'email_queue_failed', level: 'error', message: 'SMTP is enabled but host is not configured — emails cannot be sent' });
    }
  } catch {}

  // 3. Integration webhook check
  try {
    const intRow = db.prepare("SELECT value FROM settings WHERE key='integrations'").get();
    if (intRow) {
      const integrations = JSON.parse(intRow.value);
      Object.entries(integrations).forEach(([platform, cfg]) => {
        if (cfg && cfg.enabled && !cfg.webhook_url)
          alerts.push({ type: 'integration_token_expiring', level: 'warning', message: `${platform} integration is enabled but webhook URL is missing` });
      });
    }
  } catch {}

  // 4. Failed login attempts (tracked in settings as a counter)
  try {
    const faRow = db.prepare("SELECT value FROM settings WHERE key='failed_login_count'").get();
    if (faRow && Number(faRow.value) >= 5)
      alerts.push({ type: 'unauthorized_access', level: 'warning', message: `${faRow.value} failed login attempts recorded` });
  } catch {}

  // Push warning/error alerts as in-app notifications to all managers
  const bad = alerts.filter(a => a.level !== 'ok');
  if (bad.length > 0) {
    const managers = db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
    const ins = db.prepare("INSERT INTO notifications (user_id,type,title,body) VALUES (?,?,?,?)");
    db.transaction(() => {
      bad.forEach(alert => managers.forEach(m => {
        ins.run(m.id, 'system_alert', `System Alert: ${alert.type.replace(/_/g, ' ')}`, alert.message);
      }));
    })();
  }

  res.json({ alerts, checked_at: new Date().toISOString() });
});

/* ── Logging config ─────────────────────────────────────────── */
const DEFAULT_LOGGING = {
  log_level: 'info',
  logging_provider: 'file',
  log_retention_days: 30,
  structured_logging: true,
  correlation_id_enabled: true,
  request_logging: true,
  exception_logging: true,
  sensitive_data_masking: false,
  log_download_enabled: true,
};

router.get('/logging', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get();
  if (!row) return res.json(DEFAULT_LOGGING);
  try { res.json({ ...DEFAULT_LOGGING, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOGGING); }
});

router.put('/logging', requireManager, (req, res) => {
  const value = JSON.stringify(req.body);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logging_config', ?)").run(value);
  res.json({ ok: true });
});

// GET /api/settings/logging/download — export recent activity as a log file
router.get('/logging/download', requireManager, (req, res) => {
  const config = (() => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get();
    if (!row) return DEFAULT_LOGGING;
    try { return { ...DEFAULT_LOGGING, ...JSON.parse(row.value) }; } catch { return DEFAULT_LOGGING; }
  })();

  if (!config.log_download_enabled)
    return res.status(403).json({ error: 'Log download is disabled.' });

  // Pull recent activity rows
  const rows = db.prepare(`
    SELECT pa.created_at, u.name as user_name, u.email, pa.action, pa.detail,
           p.title as project_title
    FROM project_activity pa
    LEFT JOIN users u ON u.id = pa.user_id
    LEFT JOIN projects p ON p.id = pa.project_id
    ORDER BY pa.created_at DESC
    LIMIT 1000
  `).all();

  const mask = config.sensitive_data_masking;
  const lines = [
    `# Application Log Export — ${new Date().toISOString()}`,
    `# Level: ${config.log_level.toUpperCase()} | Provider: ${config.logging_provider} | Retention: ${config.log_retention_days} days`,
    '',
    'timestamp,user,email,action,project,detail',
    ...rows.map(r => [
      r.created_at,
      r.user_name || 'system',
      mask ? '***@***.***' : (r.email || ''),
      r.action,
      r.project_title || '',
      (r.detail || '').replace(/,/g, ';'),
    ].join(','))
  ];

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="app-log-${Date.now()}.csv"`);
  res.send(lines.join('\n'));
});

/* ── System Update ──────────────────────────────────────────── */

// GET /api/settings/system-update/status
router.get('/system-update/status', requireManager, (req, res) => {
  res.json(updateMgr.state);
});

// POST /api/settings/system-update/check  — run npm outdated
router.post('/system-update/check', requireManager, async (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update in progress' });
  try {
    const outdated = await updateMgr.checkOutdated();
    updateMgr.state.outdated = outdated;
    res.json({ outdated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/system-update/start  — install + build (async)
router.post('/system-update/start', requireManager, (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update already in progress' });
  updateMgr.state.phase   = 'queued';
  updateMgr.state.log     = [];
  updateMgr.state.error   = null;
  updateMgr.state.done_at = null;
  updateMgr.state.needs_restart = false;
  updateMgr.state.started_at = new Date().toISOString();
  res.json({ ok: true, message: 'Update started' });
  // Run asynchronously — client polls /status
  setImmediate(() => updateMgr.runUpdate());
});

// POST /api/settings/system-update/restart  — restart the server
router.post('/system-update/restart', requireManager, (req, res) => {
  res.json({ ok: true, message: 'Restarting…' });
  updateMgr.scheduleRestart();
});

/* ── Security / password policy ─────────────────────────────── */
const DEFAULT_SECURITY = { password_expiry_days: 90 };

router.get('/security', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='security_policy'").get();
  if (!row) return res.json(DEFAULT_SECURITY);
  try { res.json({ ...DEFAULT_SECURITY, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_SECURITY); }
});

router.put('/security', requireManager, (req, res) => {
  const { password_expiry_days } = req.body;
  const days = Math.max(0, parseInt(password_expiry_days, 10) || 0);
  // Also update the standalone key used by auth.js for fast lookup
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('password_expiry_days',?)").run(String(days));
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('security_policy',?)").run(JSON.stringify({ password_expiry_days: days }));
  res.json({ ok: true, password_expiry_days: days });
});

module.exports = router;
