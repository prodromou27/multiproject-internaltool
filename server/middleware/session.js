const SESSION_COOKIE = 'solutionshub_session';
const CSRF_HEADER = 'x-solutionshub-request';

function sessionCookie(req) {
  const entry = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1)); }
  catch { return null; }
}

function requestToken(req) {
  if (req.headers.authorization) return /^Bearer\s+(\S+)$/i.exec(req.headers.authorization)?.[1] || null;
  return sessionCookie(req);
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'strict', path: '/api',
    secure: req.secure || /^https:\/\//i.test(process.env.APP_URL || '') };
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: 24 * 60 * 60 * 1000 });
  res.setHeader('Cache-Control', 'no-store');
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.setHeader('Cache-Control', 'no-store');
}

function protectCookieRequests(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    const trusted = [process.env.APP_URL, process.env.ALLOWED_ORIGIN, `${req.protocol}://${req.get('host')}`];
    const allowed = trusted.some(value => {
      try { return value && new URL(value).origin === origin; } catch { return false; }
    });
    if (!allowed) return res.status(403).json({ error: 'Cross-origin request rejected' });
  }
  if (sessionCookie(req) && req.headers[CSRF_HEADER] !== '1')
    return res.status(403).json({ error: 'Missing request protection header' });
  next();
}

module.exports = { sessionCookie, requestToken, setSessionCookie, clearSessionCookie, protectCookieRequests };
