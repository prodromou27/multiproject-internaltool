const router = require('express').Router();
const db     = require('../db');
const fs     = require('fs');
const path   = require('path');
const { requireManager } = require('../middleware/auth');
const { sendTest } = require('../notifications');
const updateMgr = require('../update-manager');
const { assertPublicHttpUrl, isInAppUpdateEnabled, requireInAppUpdateEnabled } = require('../security');
const { getRuntimeConfigIssues } = require('../config');
const { isEncrypted, keyStatus } = require('../fieldCipher');
const { logAudit } = require('../auditLog');
const pkg = require('../package.json');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

async function logSettingsChange(req, action, detail = null) {
  await logAudit(db, req, 'settings', action, 'Settings', action, detail);
}

async function customerEncryptionReport() {
  const fields = ['name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes'];
  const rows = await db.prepare('SELECT id, name, contact_name, contact_email, contact_phone, address, notes FROM customers').all();
  let plaintext_fields = 0;
  let encrypted_fields = 0;
  let affected_rows = 0;

  for (const row of rows) {
    let rowHasPlaintext = false;
    for (const f of fields) {
      const value = row[f];
      if (value === null || value === undefined || value === '') continue;
      if (isEncrypted(value)) encrypted_fields++;
      else {
        plaintext_fields++;
        rowHasPlaintext = true;
      }
    }
    if (rowHasPlaintext) affected_rows++;
  }

  return {
    rows: rows.length,
    encrypted_fields,
    plaintext_fields,
    affected_rows,
  };
}

// GET /api/settings/integrations
router.get('/integrations', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get());
  if (!row) return res.json({});
  try { res.json(JSON.parse(row.value)); } catch { res.json({}); }
});
// Validate webhook URLs before storing them. This resolves DNS and rejects
// loopback/private/link-local destinations to prevent SSRF.
async function validateWebhookUrl(url) {
  if (!url) return null; // empty is fine: integration is just unconfigured
  try {
    await assertPublicHttpUrl(url, { label: 'Webhook URL' });
  } catch (e) { return e.message; }
  return null;
}

// POST /api/settings/integrations
router.post('/integrations', requireManager, async (req, res) => {
  // Validate all webhook_url fields before storing
  const body = req.body;
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

router.get('/localization', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='localization_config'").get());
  if (!row) return res.json(DEFAULT_LOCALIZATION);
  try { res.json({ ...DEFAULT_LOCALIZATION, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOCALIZATION); }
});

router.put('/localization', requireManager, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const cfg = {
    default_language: ['en', 'el'].includes(body.default_language) ? body.default_language : DEFAULT_LOCALIZATION.default_language,
    supported_languages: Array.isArray(body.supported_languages)
      ? body.supported_languages.filter(v => ['en', 'el'].includes(v)).slice(0, 2)
      : DEFAULT_LOCALIZATION.supported_languages,
    date_format: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(body.date_format) ? body.date_format : DEFAULT_LOCALIZATION.date_format,
    time_format: ['24h', '12h'].includes(body.time_format) ? body.time_format : DEFAULT_LOCALIZATION.time_format,
    number_format: ['1,000.00', '1.000,00', '1000.00'].includes(body.number_format) ? body.number_format : DEFAULT_LOCALIZATION.number_format,
    timezone: typeof body.timezone === 'string' && body.timezone.length <= 80 ? body.timezone : DEFAULT_LOCALIZATION.timezone,
  };
  if (!cfg.supported_languages.length) cfg.supported_languages = DEFAULT_LOCALIZATION.supported_languages;
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('localization_config',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(cfg)));
  await logSettingsChange(req, 'localization_updated', `language=${cfg.default_language}; timezone=${cfg.timezone}`);
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
  customer_encryption_incomplete:{ enabled: true, email: true },
};

router.get('/admin-notifications', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='admin_notifications_config'").get());
  if (!row) return res.json(ALERT_DEFAULTS);
  try {
    const saved = JSON.parse(row.value);
    // merge so new alert types get their defaults
    const merged = {};
    Object.keys(ALERT_DEFAULTS).forEach(k => { merged[k] = { ...ALERT_DEFAULTS[k], ...(saved[k] || {}) }; });
    res.json(merged);
  } catch { res.json(ALERT_DEFAULTS); }
});

router.put('/admin-notifications', requireManager, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const cfg = {};
  Object.keys(ALERT_DEFAULTS).forEach(k => {
    cfg[k] = {
      enabled: bool(body[k]?.enabled, ALERT_DEFAULTS[k].enabled),
      email: bool(body[k]?.email, ALERT_DEFAULTS[k].email),
    };
  });
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('admin_notifications_config',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(cfg)));
  await logSettingsChange(req, 'admin_notifications_updated', null);
  res.json({ ok: true });
});

// POST /api/settings/system-alerts/check — run real checks, push in-app notifications
router.post('/system-alerts/check', requireManager, async (req, res) => {
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
    const smtpRow = (await db.prepare("SELECT value FROM settings WHERE key='report_smtp_config'").get());
    if (smtpRow) {
      const smtp = JSON.parse(smtpRow.value);
      if (smtp.enabled && !smtp.host) alerts.push({ type: 'email_queue_failed', level: 'error', message: 'SMTP is enabled but host is not configured — emails cannot be sent' });
    }
  } catch {}

  // 3. Integration webhook check
  try {
    const intRow = (await db.prepare("SELECT value FROM settings WHERE key='integrations'").get());
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
    const faRow = (await db.prepare("SELECT value FROM settings WHERE key='failed_login_count'").get());
    if (faRow && Number(faRow.value) >= 5)
      alerts.push({ type: 'unauthorized_access', level: 'warning', message: `${faRow.value} failed login attempts recorded` });
  } catch {}

  // 5. Customer encryption coverage
  try {
    const coverage = await customerEncryptionReport();
    if (coverage.plaintext_fields > 0) {
      alerts.push({
        type: 'customer_encryption_incomplete',
        level: process.env.NODE_ENV === 'production' ? 'error' : 'warning',
        message: `${coverage.plaintext_fields} customer field(s) across ${coverage.affected_rows} row(s) are still plaintext. Run the customer encryption backfill after setting CUSTOMER_FIELD_KEY.`,
      });
    } else {
      alerts.push({ type: 'customer_encryption_incomplete', level: 'ok', message: 'All populated customer fields are encrypted.' });
    }
  } catch {}

  // Push warning/error alerts as in-app notifications to all managers
  const bad = alerts.filter(a => a.level !== 'ok');
  if (bad.length > 0) {
    const managers = (await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all());
    await db.transaction(async (tx) => {
      const ins = tx.prepare("INSERT INTO notifications (user_id,type,title,body) VALUES (?,?,?,?)");
      for (const alert of bad) {
        for (const m of managers) {
          await ins.run(m.id, 'system_alert', `System Alert: ${alert.type.replace(/_/g, ' ')}`, alert.message);
        }
      }
    });
  }

  await logSettingsChange(req, 'system_alerts_checked', `alerts=${alerts.length}; actionable=${bad.length}`);
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

router.get('/logging', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get());
  if (!row) return res.json(DEFAULT_LOGGING);
  try { res.json({ ...DEFAULT_LOGGING, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOGGING); }
});

router.put('/logging', requireManager, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const cfg = {
    log_level: ['debug', 'info', 'warn', 'error'].includes(body.log_level) ? body.log_level : DEFAULT_LOGGING.log_level,
    logging_provider: ['file', 'console'].includes(body.logging_provider) ? body.logging_provider : DEFAULT_LOGGING.logging_provider,
    log_retention_days: Math.min(3650, Math.max(1, parseInt(body.log_retention_days, 10) || DEFAULT_LOGGING.log_retention_days)),
    structured_logging: bool(body.structured_logging, DEFAULT_LOGGING.structured_logging),
    correlation_id_enabled: bool(body.correlation_id_enabled, DEFAULT_LOGGING.correlation_id_enabled),
    request_logging: bool(body.request_logging, DEFAULT_LOGGING.request_logging),
    exception_logging: bool(body.exception_logging, DEFAULT_LOGGING.exception_logging),
    sensitive_data_masking: bool(body.sensitive_data_masking, DEFAULT_LOGGING.sensitive_data_masking),
    log_download_enabled: bool(body.log_download_enabled, DEFAULT_LOGGING.log_download_enabled),
  };
  const value = JSON.stringify(cfg);
  (await db.prepare("INSERT INTO settings (key, value) VALUES ('logging_config', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(value));
  await logSettingsChange(req, 'logging_updated', `level=${cfg.log_level}; download=${cfg.log_download_enabled}`);
  res.json({ ok: true });
});

// GET /api/settings/logging/download — export recent activity as a log file
router.get('/logging/download', requireManager, async (req, res) => {
  const config = await (async () => {
    const row = (await db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get());
    if (!row) return DEFAULT_LOGGING;
    try { return { ...DEFAULT_LOGGING, ...JSON.parse(row.value) }; } catch { return DEFAULT_LOGGING; }
  })();

  if (!config.log_download_enabled)
    return res.status(403).json({ error: 'Log download is disabled.' });

  // Pull recent activity rows
  const rows = (await db.prepare(`
    SELECT pa.created_at, u.name as user_name, u.email, pa.action, pa.detail,
           p.title as project_title
    FROM project_activity pa
    LEFT JOIN users u ON u.id = pa.user_id
    LEFT JOIN projects p ON p.id = pa.project_id
    ORDER BY pa.created_at DESC
    LIMIT 1000
  `).all());

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
router.get('/system-update/status', requireManager, async (req, res) => {
  res.json({ ...updateMgr.state, updates_enabled: isInAppUpdateEnabled() });
});

// GET /api/settings/deployment-health
router.get('/deployment-health', requireManager, async (req, res) => {
  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
  const isProd = process.env.NODE_ENV === 'production';
  const { errors, warnings } = getRuntimeConfigIssues(process.env);

  if (errors.length) add('runtime_config', 'Runtime configuration', 'error', errors.join('; '));
  else if (warnings.length) add('runtime_config', 'Runtime configuration', 'warning', warnings.join('; '));
  else add('runtime_config', 'Runtime configuration', 'ok', 'Required environment values are present.');

  try {
    await db.prepare('SELECT 1 AS ok').get();
    add('database', 'PostgreSQL connection', 'ok', 'Database query succeeded.');
  } catch {
    add('database', 'PostgreSQL connection', 'error', 'Database query failed.');
  }

  add(
    'attachment_encryption',
    'Attachment encryption',
    process.env.ATTACHMENT_KEY ? 'ok' : (isProd ? 'error' : 'warning'),
    process.env.ATTACHMENT_KEY ? 'ATTACHMENT_KEY is configured.' : 'ATTACHMENT_KEY is not configured.'
  );
  add(
    'customer_field_encryption',
    'Customer field encryption',
    process.env.CUSTOMER_FIELD_KEY ? 'ok' : (isProd ? 'error' : 'warning'),
    process.env.CUSTOMER_FIELD_KEY ? 'CUSTOMER_FIELD_KEY is configured.' : 'CUSTOMER_FIELD_KEY is not configured.'
  );
  try {
    const key = keyStatus();
    add(
      'customer_key_management',
      'Customer encryption key',
      key.configured ? 'ok' : (isProd ? 'error' : 'warning'),
      key.configured
        ? `AES-256-GCM key active. Fingerprint: ${key.fingerprint}.`
        : 'No active customer encryption key.'
    );
    const coverage = await customerEncryptionReport();
    add(
      'customer_encryption_coverage',
      'Customer encryption coverage',
      coverage.plaintext_fields > 0 ? (isProd ? 'error' : 'warning') : 'ok',
      coverage.plaintext_fields > 0
        ? `${coverage.plaintext_fields} populated customer field(s) across ${coverage.affected_rows} row(s) are plaintext.`
        : `All populated customer fields are encrypted across ${coverage.rows} customer row(s).`
    );
  } catch {
    add('customer_encryption_coverage', 'Customer encryption coverage', 'warning', 'Could not inspect customer encryption coverage.');
  }
  add(
    'app_url',
    'Public app URL',
    process.env.APP_URL ? (isProd && process.env.APP_URL.startsWith('http://') ? 'warning' : 'ok') : (isProd ? 'error' : 'warning'),
    process.env.APP_URL || 'APP_URL is not configured.'
  );
  add(
    'in_app_updates',
    'In-app updates',
    isProd && isInAppUpdateEnabled() ? 'warning' : 'ok',
    isInAppUpdateEnabled() ? 'In-app package updates are enabled.' : 'In-app package updates are disabled; use Docker/branch deployment.'
  );
  add(
    'cors',
    'CORS policy',
    'ok',
    process.env.ALLOWED_ORIGIN ? `Restricted to ${process.env.ALLOWED_ORIGIN}.` : 'Cross-origin requests are disabled.'
  );
  add(
    'reverse_proxy',
    'Reverse proxy trust',
    process.env.TRUST_PROXY ? 'ok' : (isProd ? 'warning' : 'ok'),
    process.env.TRUST_PROXY ? `Trusting ${process.env.TRUST_PROXY} proxy hop(s).` : 'TRUST_PROXY is not set.'
  );

  const uploadsDir = path.join(__dirname, '../uploads');
  let uploadBytes = 0;
  try {
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        try { uploadBytes += fs.statSync(path.join(uploadsDir, f)).size; } catch {}
      }
    }
    add('uploads_storage', 'Uploads storage', uploadBytes > 500 * 1024 * 1024 ? 'warning' : 'ok', `${(uploadBytes / 1024 / 1024).toFixed(1)} MB in uploads.`);
  } catch {
    add('uploads_storage', 'Uploads storage', 'warning', 'Could not inspect uploads directory.');
  }

  const status = checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';

  res.json({
    status,
    checked_at: new Date().toISOString(),
    app: {
      name: pkg.name,
      version: pkg.version,
      node_env: process.env.NODE_ENV || 'development',
      uptime_seconds: Math.round(process.uptime()),
      pid: process.pid,
    },
    checks,
  });
});

// POST /api/settings/system-update/check
router.post('/system-update/check', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update in progress' });
  try {
    const outdated = await updateMgr.checkOutdated();
    updateMgr.state.outdated = outdated;
    await logSettingsChange(req, 'system_update_checked', null);
    res.json({ outdated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/system-update/start  — install + build (async)
router.post('/system-update/start', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update already in progress' });
  updateMgr.state.phase   = 'queued';
  updateMgr.state.log     = [];
  updateMgr.state.error   = null;
  updateMgr.state.done_at = null;
  updateMgr.state.needs_restart = false;
  updateMgr.state.started_at = new Date().toISOString();
  await logSettingsChange(req, 'system_update_started', null);
  res.json({ ok: true, message: 'Update started' });
  // Run asynchronously — client polls /status
  setImmediate(() => updateMgr.runUpdate());
});

// POST /api/settings/system-update/restart  — restart the server
router.post('/system-update/restart', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  await logSettingsChange(req, 'system_restart_requested', null);
  res.json({ ok: true, message: 'Restarting…' });
  updateMgr.scheduleRestart();
});

/* ── Security / password policy ─────────────────────────────── */
const DEFAULT_SECURITY = { password_expiry_days: 90 };

router.get('/security', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='security_policy'").get());
  if (!row) return res.json(DEFAULT_SECURITY);
  try { res.json({ ...DEFAULT_SECURITY, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_SECURITY); }
});

router.put('/security', requireManager, async (req, res) => {
  const { password_expiry_days } = req.body;
  const days = Math.min(3650, Math.max(0, parseInt(password_expiry_days, 10) || 0));
  // Also update the standalone key used by auth.js for fast lookup
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('password_expiry_days',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(String(days)));
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('security_policy',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ password_expiry_days: days })));
  await logSettingsChange(req, 'security_policy_updated', `password_expiry_days=${days}`);
  res.json({ ok: true, password_expiry_days: days });
});

module.exports = router;
