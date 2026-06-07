/**
 * Email sender — wraps nodemailer with SMTP settings stored in DB.
 */
const nodemailer = require('nodemailer');
const db = require('./db');

// ── Read SMTP settings from DB ───────────────────────────────────────────────
function getSmtpSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'email_smtp'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

// ── Build a nodemailer transporter from smtp config ──────────────────────────
function createTransport(smtp) {
  if (!smtp?.host) throw new Error('SMTP host is not configured');
  return nodemailer.createTransport({
    host:   smtp.host,
    port:   Number(smtp.port)  || 587,
    secure: smtp.secure === true || smtp.secure === 'true',
    auth:   smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    tls:    { rejectUnauthorized: smtp.allow_self_signed !== true },  // only skip TLS validation when explicitly configured
  });
}

// ── Send an email ─────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const smtp = getSmtpSettings();
  if (!smtp?.host) throw new Error('Email SMTP is not configured. Please set it up in Admin → Weekly Report.');

  const transporter = createTransport(smtp);
  const from = smtp.from_name
    ? `"${smtp.from_name}" <${smtp.from_email || smtp.user}>`
    : (smtp.from_email || smtp.user);

  await transporter.sendMail({
    from,
    to:   Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    text: text || undefined,
  });
}

// ── Verify SMTP connection (used by test button) ─────────────────────────────
async function testSmtp(smtp) {
  const transporter = createTransport(smtp);
  await transporter.verify();
  return { ok: true };
}

module.exports = { sendEmail, testSmtp, getSmtpSettings };
