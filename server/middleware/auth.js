const jwt = require('jsonwebtoken');

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
  return jwt.sign(payload, _secret, options);
}

/** Verify a JWT and return its decoded payload (throws on invalid/expired) */
function verifyJwt(token) {
  return jwt.verify(token, _secret);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token  = header ? header.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = verifyJwt(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Used only by file-download routes that must accept ?token= (export, template endpoints).
// When the token arrives via the Authorization header the full session JWT is accepted.
// When it arrives via the URL query string (?token=) we only accept short-lived download
// tokens (issued by POST /api/auth/download-token, TTL 60 s, claim download:true) so that
// full 24-hour session JWTs are never captured in server / proxy access logs.
function requireDownloadAuth(req, res, next) {
  const header = req.headers.authorization;
  const fromHeader = header ? header.split(' ')[1] : null;
  const fromQuery  = req.query.token || null;
  const token = fromHeader || fromQuery;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = verifyJwt(token);
    // URL-embedded tokens must be explicitly scoped for downloads
    if (fromQuery && !fromHeader && !payload.download)
      return res.status(401).json({ error: 'A scoped download token is required for URL-based downloads. Use POST /api/auth/download-token.' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireManager(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    next();
  });
}

function requireManagerOrPlanner(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'manager' && req.user.role !== 'planner')
      return res.status(403).json({ error: 'Managers and planners only' });
    next();
  });
}

function requireDownloadManagerOrPlanner(req, res, next) {
  requireDownloadAuth(req, res, () => {
    if (req.user.role !== 'manager' && req.user.role !== 'planner')
      return res.status(403).json({ error: 'Managers and planners only' });
    next();
  });
}

module.exports = { requireAuth, requireDownloadAuth, requireManager, requireManagerOrPlanner, requireDownloadManagerOrPlanner, signJwt, verifyJwt };
