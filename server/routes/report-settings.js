const router   = require('express').Router();
const db       = require('../db');
const { requireManager } = require('../middleware/auth');
const { testSmtp, getSmtpSettings } = require('../email');
const { gatherReportData, buildReportHtml, buildSubject, sendWeeklyReport } = require('../weeklyReport');
const { reschedule } = require('../reportScheduler');

// ── SMTP settings ─────────────────────────────────────────────────────────────
router.get('/smtp', requireManager, async (req, res) => {
  const smtp = (await getSmtpSettings()) || {};
  // Never return the password in GET response
  const { password, ...safe } = smtp;
  res.json({ ...safe, password_set: !!password });
});

router.put('/smtp', requireManager, async (req, res) => {
  const current = (await getSmtpSettings()) || {};
  const { password, ...rest } = req.body;
  // If no new password provided, keep the existing one
  const merged = {
    ...current,
    ...rest,
    password: (password && password !== '••••••••') ? password : (current.password || ''),
  };
  (await db.prepare("INSERT INTO settings (key, value) VALUES ('email_smtp', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(merged)));
  res.json({ ok: true });
});

router.post('/smtp/test', requireManager, async (req, res) => {
  const { smtp, to } = req.body;
  if (!smtp?.host) return res.status(400).json({ error: 'SMTP host required' });
  try {
    const current = (await getSmtpSettings()) || {};
    await testSmtp({ ...smtp,password: smtp.password && smtp.password !== '\u2022'.repeat(8) ? smtp.password : current.password });
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
router.get('/schedule', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get());
  if (!row) return res.json({ enabled: false, day: 1, hour: 9, minute: 0, recipients: [], last_sent: null });
  try { res.json(JSON.parse(row.value)); } catch { res.json({}); }
});

router.put('/schedule', requireManager, async (req, res) => {
  const { enabled, day, hour, minute, recipients } = req.body;
  if (typeof enabled!=='boolean' || !Number.isInteger(day) || day<0 || day>6 || !Number.isInteger(hour) || hour<0 || hour>23 || !Number.isInteger(minute) || minute<0 || minute>59
    || !Array.isArray(recipients) || recipients.length>20 || new Set(recipients).size!==recipients.length || recipients.some(id => !Number.isSafeInteger(id) || id<1)) return res.status(400).json({ error: 'Invalid weekly schedule or recipients (maximum 20)' });
  if (enabled && !recipients.length) return res.status(400).json({ error: 'Select at least one active manager recipient' });
  if (enabled) {
    const users = await db.prepare(`SELECT id,email FROM users WHERE id IN (${recipients.map(() => '?').join(',')}) AND role='manager' AND active=1 AND must_change_password=0`).all(...recipients);
    if (users.length!==recipients.length || users.some(user => typeof user.email!=='string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(user.email))) return res.status(400).json({ error: 'Recipients must be active managers with valid email addresses and current access' });
  }
  const current = await (async () => {
    const row = (await db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get());
    if (!row) return {};
    try { return JSON.parse(row.value); } catch { return {}; }
  })();
  const updated = {
    ...current,
    enabled:    !!enabled,
    day:        day,
    hour:       hour,
    minute:     minute,
    recipients: Array.isArray(recipients) ? recipients : (current.recipients || []),
  };
  (await db.prepare("INSERT INTO settings (key, value) VALUES ('weekly_report_config', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(updated)));
  // Reschedule with new config
  await reschedule();
  res.json({ ok: true });
});

// ── Preview — returns HTML for display in browser ─────────────────────────────
router.get('/preview', requireManager, async (req, res) => {
  try {
    const data = await gatherReportData();
    const html = buildReportHtml(data);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).json({ error: 'Weekly report could not be generated or delivered' });
  }
});

// ── Preview as JSON — returns data + subject for display in the panel ─────────
router.get('/preview-data', requireManager, async (req, res) => {
  try {
    const data    = await gatherReportData();
    const subject = buildSubject(data);
    res.json({ ...data, subject });
  } catch (e) {
    res.status(500).json({ error: 'Weekly report could not be generated or delivered' });
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
    res.status(500).json({ error: 'Weekly report could not be generated or delivered' });
  }
});

// ── Get managers list (for recipient selection) ───────────────────────────────
router.get('/managers', requireManager, async (req, res) => {
  const managers = (await db.prepare(
    "SELECT id, name, email FROM users WHERE role = 'manager' AND active = 1 ORDER BY name ASC"
  ).all());
  res.json(managers);
});

module.exports = router;
