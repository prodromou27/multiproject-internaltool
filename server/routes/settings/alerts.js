const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { isPlainObject, bool, logSettingsChange, customerEncryptionReport } = require('./shared');

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
    const uploadsDir = path.join(__dirname, '../../uploads');
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

module.exports = router;
