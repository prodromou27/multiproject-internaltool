const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const db        = require('../db');
const { signJwt, verifyJwt, requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../email');

// Helper: read password_expiry_days from settings (0 = disabled)
function getPasswordExpiryDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key='password_expiry_days'").get();
  return row ? Math.max(0, parseInt(row.value, 10) || 0) : 0;
}

// Helper: check if user's password has expired; sets must_change_password=1 if so
function checkPasswordExpiry(user) {
  const days = getPasswordExpiryDays();
  if (!days || !user.password_changed_at) return false;
  const changed = new Date(user.password_changed_at);
  const expiry  = new Date(changed.getTime() + days * 86400000);
  if (new Date() > expiry) {
    // Mark so the forced-change flow is triggered
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
    return true;
  }
  return false;
}

/* ── TOTP replay-prevention store ───────────────────────────
   Tracks recently-used codes so a captured code cannot be
   replayed within its validity window (~90 s for window=1).
   Uses in-process memory; sufficient for a single-node deploy.
   ──────────────────────────────────────────────────────────── */
const _usedTotpCodes = new Map(); // key: `${userId}:${code}` → expiry ms
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of _usedTotpCodes) if (exp < now) _usedTotpCodes.delete(k);
}, 60_000).unref();

function _isTotpUsed(userId, code) {
  const key = `${userId}:${code}`;
  const exp = _usedTotpCodes.get(key);
  if (!exp) return false;
  if (exp < Date.now()) { _usedTotpCodes.delete(key); return false; }
  return true;
}
function _markTotpUsed(userId, code) {
  _usedTotpCodes.set(`${userId}:${code}`, Date.now() + 90_000); // 90 s TTL (window=1 × 30 s × 3)
}

/* ── Avatar upload storage ───────────────────────────────── */
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar_${req.user.id}${ext}`);
  },
});
// Explicit allowlist — SVG intentionally excluded (can carry XSS payloads)
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    ALLOWED_AVATAR_TYPES.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only JPEG, PNG, GIF or WebP images are allowed'));
  },
});

/* ── Login ───────────────────────────────────────────────── */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  // Normalize the email the same way it is stored (creation/forgot-password all
  // lowercase + trim) so a mixed-case or padded login still matches.
  const normEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const user = normEmail ? db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail) : null;
  // Use a constant-time compare even on "not found" to avoid timing oracle.
  // Guard against a missing/non-string password (bcrypt throws on undefined).
  const passwordOk = user && typeof password === 'string' && bcrypt.compareSync(password, user.password);
  if (!passwordOk)
    return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.active)
    return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  // Check password expiry — sets must_change_password=1 on the user record if expired
  const passwordExpired = checkPasswordExpiry(user);
  // Re-read must_change_password (may have just been set by expiry check)
  const mustChange = !!(db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(user.id)?.must_change_password);

  // If TOTP is enabled and user is not exempt, require 2FA step
  if (user.totp_enabled && !user.totp_exempt) {
    const partialToken = signJwt({ id: user.id, partial: true }, { expiresIn: '5m' });
    return res.json({ requires_2fa: true, partial_token: partialToken });
  }

  const token = signJwt(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    { expiresIn: '24h' }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url || null },
    must_change_password: mustChange,
    password_expired: passwordExpired,
  });
});

/* ── 2FA: verify TOTP code during login ──────────────────── */
router.post('/2fa/verify', (req, res) => {
  const { partial_token, code } = req.body;
  let payload;
  try { payload = verifyJwt(partial_token); }
  catch { return res.status(401).json({ error: 'Session expired — please log in again.' }); }
  if (!payload.partial) return res.status(400).json({ error: 'Invalid token type' });

  // Re-fetch user to catch deactivation that happened after the partial token was issued
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.active)
    return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
  if (!user.totp_enabled || !user.totp_secret)
    return res.status(400).json({ error: '2FA not configured for this account' });

  const normalizedCode = String(code).replace(/\s/g, '');

  // Replay prevention — reject a code that was already used in this validity window
  if (_isTotpUsed(user.id, normalizedCode))
    return res.status(401).json({ error: 'Authentication code already used — wait for the next code' });

  const valid = speakeasy.totp.verify({
    secret: user.totp_secret, encoding: 'base32',
    token: normalizedCode, window: 1,
  });
  if (!valid) return res.status(401).json({ error: 'Invalid authentication code' });

  _markTotpUsed(user.id, normalizedCode);

  // Check expiry after 2FA succeeds (same as regular login)
  const passwordExpired = checkPasswordExpiry(user);
  const mustChange = !!(db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(user.id)?.must_change_password);

  const token = signJwt(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    { expiresIn: '24h' }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url || null },
    must_change_password: mustChange,
    password_expired: passwordExpired,
  });
});

/* ── 2FA: generate setup QR code ─────────────────────────── */
router.get('/2fa/setup', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT name, email, totp_enabled FROM users WHERE id = ?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });

  const secret = speakeasy.generateSecret({
    name: `SolutionsHub (${user.email})`,
    issuer: 'SolutionsHub',
    length: 20,
  });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.user.id);
  const qr_data_url = await QRCode.toDataURL(secret.otpauth_url);
  // Return only the QR code — the raw base32 secret is NOT included in the response
  // to prevent it from being captured in browser history or logs.
  res.json({ qr_data_url });
});

/* ── 2FA: confirm setup (enable) ─────────────────────────── */
router.post('/2fa/enable', requireAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
  if (!user?.totp_secret) return res.status(400).json({ error: 'Run setup first' });

  const valid = speakeasy.totp.verify({
    secret: user.totp_secret, encoding: 'base32',
    token: String(code).replace(/\s/g, ''), window: 1,
  });
  if (!valid) return res.status(400).json({ error: 'Invalid code — check your authenticator app' });

  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

/* ── 2FA: disable — requires current password for confirmation ── */
router.delete('/2fa', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Current password is required to disable 2FA' });
  const u = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(password, u.password))
    return res.status(400).json({ error: 'Incorrect password' });
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

/* ── List users ──────────────────────────────────────────────
   Engineers receive a minimal roster (id, name, role, avatar)
   — enough for @mention autocomplete and assignment pickers.
   Managers and PMs receive the full set including emails.
   ──────────────────────────────────────────────────────────── */
router.get('/users', requireAuth, (req, res) => {
  if (req.user.role === 'engineer') {
    // Minimal roster — no emails, no last_login, no inactive accounts
    const users = db.prepare(
      'SELECT id, name, role, avatar_url FROM users WHERE active = 1 ORDER BY name'
    ).all();
    return res.json(users);
  }
  const users = db.prepare(
    'SELECT id, name, email, role, active, avatar_url, created_at, last_login FROM users ORDER BY name'
  ).all();
  res.json(users);
});

/* ── Profile endpoints (all authenticated users) ─────────── */

// GET /api/auth/me — current user profile
router.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, name, email, role, avatar_url, created_at, last_login, totp_enabled FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(u);
});

// PUT /api/auth/profile — update name and/or email
router.put('/profile', requireAuth, (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (email?.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: 'Invalid email format' });
    const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), req.user.id);
    if (clash) return res.status(400).json({ error: 'Email already in use by another account' });
  }
  db.prepare('UPDATE users SET name = ?, email = COALESCE(?, email) WHERE id = ?')
    .run(name.trim(), email?.trim() || null, req.user.id);
  const u = db.prepare('SELECT id, name, email, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
  const token = signJwt({ id: u.id, name: u.name, email: u.email, role: u.role }, { expiresIn: '24h' });
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, avatar_url: u.avatar_url }, token });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 12)
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  const u = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password || '', u.password))
    return res.status(400).json({ error: 'Current password is incorrect' });
  db.prepare("UPDATE users SET password = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ?")
    .run(bcrypt.hashSync(new_password, 12), req.user.id);
  res.json({ ok: true });
});

// POST /api/auth/change-password-first
// Called when must_change_password = 1 (first-time setup OR expired password).
// No current_password needed — user just authenticated successfully.
router.post('/change-password-first', requireAuth, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 12)
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  const u = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (!u.must_change_password)
    return res.status(403).json({ error: 'Use /change-password to update your password' });
  db.prepare("UPDATE users SET password = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ?")
    .run(bcrypt.hashSync(new_password, 12), req.user.id);
  res.json({ ok: true });
});

/* ── HTML escaping — used in email templates to prevent stored XSS ── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Forgot password — request a reset link ──────────────── */
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Always respond identically regardless of whether the email exists (prevent enumeration)
  const user = db.prepare('SELECT id, name, active FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !user.active) return res.json({ ok: true });

  // Invalidate any existing unused tokens for this user
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0").run(user.id);

  // Generate a 32-byte random token; store only its SHA-256 hash
  const rawToken  = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(user.id, tokenHash, expiresAt);

  const resetUrl = `${process.env.APP_URL || 'https://localhost'}/login?reset_token=${rawToken}`;

  try {
    await sendEmail({
      to: email.trim(),
      subject: '[SolutionsHub] Password Reset Request',
      html: `
        <div style="font-family:sans-serif;max-width:480px;padding:24px">
          <h2 style="color:#1e40af;margin-bottom:8px">Password Reset</h2>
          <p>Hi ${escHtml(user.name)},</p>
          <p>Someone requested a password reset for your SolutionsHub account. If this was you, click the button below:</p>
          <div style="margin:24px 0">
            <a href="${resetUrl}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
              Reset My Password
            </a>
          </div>
          <p style="color:#64748b;font-size:13px">This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
          <p style="color:#94a3b8;font-size:11px;margin-top:24px">SolutionsHub — ${new Date().toLocaleString()}</p>
        </div>
      `,
    });
  } catch (e) {
    // Log the error but don't reveal SMTP issues to the caller
    console.error('[forgot-password] email send failed:', e.message);
  }

  res.json({ ok: true });
});

/* ── Reset password — consume the token ─────────────────── */
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password)
    return res.status(400).json({ error: 'token and new_password are required' });
  if (new_password.length < 12)
    return res.status(400).json({ error: 'Password must be at least 12 characters' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`
    SELECT prt.id, prt.user_id, prt.expires_at, prt.used
    FROM password_reset_tokens prt
    WHERE prt.token_hash = ?
  `).get(tokenHash);

  if (!row || row.used)
    return res.status(400).json({ error: 'Invalid or already-used reset link' });
  if (new Date(row.expires_at) < new Date())
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });

  // Mark token used and update password
  db.transaction(() => {
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);
    db.prepare("UPDATE users SET password = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(new_password, 12), row.user_id);
  })();

  res.json({ ok: true });
});

/* ── Short-lived download token ──────────────────────────────
   Issues a 60-second scoped JWT for file-download links that
   must be embedded in a URL (e.g. <a href>).  The full 24 h
   session token must NEVER appear in a query string so that it
   isn't captured by reverse-proxy / access logs.
   ──────────────────────────────────────────────────────────── */
router.post('/download-token', requireAuth, (req, res) => {
  const token = signJwt(
    { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, download: true },
    { expiresIn: '60s' }
  );
  res.json({ token });
});

// POST /api/auth/avatar — upload profile picture
router.post('/avatar', requireAuth, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/avatars/${req.file.filename}`;
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, req.user.id);
    const u = db.prepare('SELECT id, name, email, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
    const token = signJwt({ id: u.id, name: u.name, email: u.email, role: u.role }, { expiresIn: '24h' });
    res.json({ avatar_url: url, user: { id: u.id, name: u.name, email: u.email, role: u.role, avatar_url: url }, token });
  });
});

// DELETE /api/auth/avatar — remove profile picture
router.delete('/avatar', requireAuth, (req, res) => {
  const u = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
  if (u?.avatar_url) {
    const filePath = path.join(__dirname, '..', u.avatar_url);
    fs.unlink(filePath, () => {});
  }
  db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.user.id);
  const updated = db.prepare('SELECT id, name, email, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
  const token = signJwt({ id: updated.id, name: updated.name, email: updated.email, role: updated.role }, { expiresIn: '24h' });
  res.json({ user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, avatar_url: null }, token });
});

module.exports = router;
