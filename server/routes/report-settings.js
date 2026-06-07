const router   = require('express').Router();
const db       = require('../db');
const { requireManager } = require('../middleware/auth');
const { testSmtp, getSmtpSettings } = require('../email');
const { gatherReportData, buildReportHtml, buildSubject, sendWeeklyReport } = require('../weeklyReport');
const { reschedule } = require('../reportScheduler');

// ── SMTP settings ─────────────────────────────────────────────────────────────
router.get('/smtp', requireManager, (req, res) => {
  const smtp = getSmtpSettings() || {};
  // Never return the password in GET response
  const { password, ...safe } = smtp;
  res.json({ ...safe, password_set: !!password });
});

router.put('/smtp', requireManager, (req, res) => {
  const current = getSmtpSettings() || {};
  const { password, ...rest } = req.body;
  // If no new password provided, keep the existing one
  const merged = {
    ...current,
    ...rest,
    password: (password && password !== '••••••••') ? password : (current.password || ''),
  };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_smtp', ?)").run(JSON.stringify(merged));
  res.json({ ok: true });
});

router.post('/smtp/test', requireManager, async (req, res) => {
  const { smtp, to } = req.body;
  if (!smtp?.host) return res.status(400).json({ error: 'SMTP host required' });
  try {
    await testSmtp(smtp);
    // Optionally send a test email
    if (to) {
      const { sendEmail } = require('../email');
      await sendEmail({
        to,
        subject: '[Solutions Hub] SMTP Test — Connection Successful ✅',
        html: `<div style="font-family:sans-serif;padding:24px;max-width:480px">
          <h2 style="color:#1e40af">✅ SMTP Connection Successful</h2>
          <p>Your email settings are working correctly. Solutions Hub can now send weekly reports.</p>
          <p style="color:#64748b;font-size:13px;margin-top:16px">Sent from Solutions Hub at ${new Date().toLocaleString()}</p>
        </div>`,
      });
    }
    res.json({ ok: true, message: to ? `Test email sent to ${to}` : 'SMTP connection verified' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Weekly report schedule config ─────────────────────────────────────────────
router.get('/schedule', requireManager, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
  if (!row) return res.json({ enabled: false, day: 1, hour: 9, minute: 0, recipients: [], last_sent: null });
  try { res.json(JSON.parse(row.value)); } catch { res.json({}); }
});

router.put('/schedule', requireManager, (req, res) => {
  const { enabled, day, hour, minute, recipients } = req.body;
  const current = (() => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
    if (!row) return {};
    try { return JSON.parse(row.value); } catch { return {}; }
  })();
  const updated = {
    ...current,
    enabled:    !!enabled,
    day:        Number(day)    ?? 1,
    hour:       Number(hour)   ?? 9,
    minute:     Number(minute) ?? 0,
    recipients: Array.isArray(recipients) ? recipients : (current.recipients || []),
  };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('weekly_report_config', ?)").run(JSON.stringify(updated));
  // Reschedule with new config
  reschedule();
  res.json({ ok: true });
});

// ── Preview — returns HTML for display in browser ─────────────────────────────
router.get('/preview', requireManager, (req, res) => {
  try {
    const data = gatherReportData();
    const html = buildReportHtml(data);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Preview as JSON — returns data + subject for display in the panel ─────────
router.get('/preview-data', requireManager, (req, res) => {
  try {
    const data    = gatherReportData();
    const subject = buildSubject(data);
    res.json({ ...data, subject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Send now ──────────────────────────────────────────────────────────────────
router.post('/send-now', requireManager, async (req, res) => {
  try {
    const result = await sendWeeklyReport();
    if (result.ok) {
      res.json({ ok: true, message: `Report sent to ${result.recipients.join(', ')}` });
    } else {
      res.status(400).json({ error: result.error || result.reason || 'Failed to send' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get managers list (for recipient selection) ───────────────────────────────
router.get('/managers', requireManager, (req, res) => {
  const managers = db.prepare(
    "SELECT id, name, email FROM users WHERE role = 'manager' AND active = 1 ORDER BY name ASC"
  ).all();
  res.json(managers);
});

module.exports = router;
