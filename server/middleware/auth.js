const jwt = require('jsonwebtoken');
const db = require('../db');
const { requestToken, sessionCookie } = require('./session');

// Fail fast at startup if JWT_SECRET is missing or too short
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET env var is missing or shorter than 32 chars. Refusing to start.');
    process.exit(1);
  } else {
    console.warn('[auth] WARNING: JWT_SECRET not set. Using a random per-process secret. Set JWT_SECRET in your .env for stable tokens.');
  }
}

// Secret is module-private — never exported
const _secret = JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

/** Sign a JWT payload with the module-private secret */
function signJwt(payload, options) {
  return jwt.sign(payload, _secret, { algorithm: 'HS256', ...options });
}

/** Verify a JWT and return its decoded payload (throws on invalid/expired) */
function verifyJwt(token) {
  return jwt.verify(token, _secret, { algorithms: ['HS256'] });
}

async function freshActiveUser(payload) {
  if (!payload?.id) return { errorStatus: 401, error: 'Invalid token' };
  const user = await db.prepare(
    'SELECT id, name, email, role, active, token_version, must_change_password FROM users WHERE id = ?'
  ).get(payload.id);
  if (!user || !user.active) return { errorStatus: 401, error: 'Account is deactivated or no longer exists' };
  if ((payload.token_version ?? 0) !== (user.token_version ?? 0)) return { errorStatus: 401, error: 'Session expired' };
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role,
      token_version: user.token_version ?? 0, must_change_password: !!user.must_change_password },
  };
}

async function requireAuth(req, res, next) {
  const token = requestToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });
  let payload;
  try {
    payload = verifyJwt(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (payload.partial || payload.download) return res.status(401).json({ error: 'Invalid token scope' });
  const result = await freshActiveUser(payload);
  if (result.errorStatus) return res.status(result.errorStatus).json({ error: result.error });
  if (result.user.must_change_password && !(req.baseUrl === '/api/auth'
    && ['/me', '/change-password-first', '/change-password', '/logout'].includes(req.path)))
    return res.status(403).json({ error: 'Change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
  req.user = result.user;
  next();
}

// Used only by file-download routes that must accept ?token= (export, template endpoints).
// When the token arrives via the Authorization header the full session JWT is accepted.
// When it arrives via the URL query string (?token=) we only accept short-lived download
// tokens (issued by POST /api/auth/download-token, TTL 60 s, claim download:true) so that
// full 24-hour session JWTs are never captured in server / proxy access logs.
async function requireDownloadAuth(req, res, next) {
  const header = req.headers.authorization;
  const fromHeader = header ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : null;
  const fromQuery  = req.query.token || null;
  const fromCookie = sessionCookie(req);
  const token = fromHeader || fromQuery || fromCookie;
  if (!token) return res.status(401).json({ error: 'No token' });
  let payload;
  try { payload = verifyJwt(token); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
  // URL-embedded tokens must be explicitly scoped for downloads.
  if (fromQuery && !fromHeader && !payload.download)
    return res.status(401).json({ error: 'A scoped download token is required for URL-based downloads. Use POST /api/auth/download-token.' });
  if (payload.partial || (!fromHeader && !fromQuery && payload.download)) return res.status(401).json({ error: 'Invalid token scope' });
  const result = await freshActiveUser(payload);
  if (result.errorStatus) return res.status(result.errorStatus).json({ error: result.error });
  if (result.user.must_change_password) return res.status(403).json({ error: 'Change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
  req.user = result.user;
  next();
}

function requireManager(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    next();
  });
}

function requireManagerOrPlanner(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user.role !== 'manager' && req.user.role !== 'planner')
      return res.status(403).json({ error: 'Managers and planners only' });
    next();
  });
}

function requireDownloadManagerOrPlanner(req, res, next) {
  return requireDownloadAuth(req, res, () => {
    if (req.user.role !== 'manager' && req.user.role !== 'planner')
      return res.status(403).json({ error: 'Managers and planners only' });
    next();
  });
}

function requireDownloadManager(req, res, next) {
  return requireDownloadAuth(req, res, () => {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    next();
  });
}

module.exports = { requireAuth, requireDownloadAuth, requireManager, requireManagerOrPlanner, requireDownloadManager, requireDownloadManagerOrPlanner, signJwt, verifyJwt };
