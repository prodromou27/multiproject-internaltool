// Load .env file (no dotenv dependency needed)
const fs0 = require('fs'), path0 = require('path');
const envPath = path0.join(__dirname, '.env');
if (fs0.existsSync(envPath)) {
  fs0.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const express    = require('express');
const https      = require('https');
const http       = require('http');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
require('./db'); // initialize DB
const db = require('./db');
const { notify } = require('./notifications');

const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
// HSTS is enabled whenever TLS certs exist (regardless of NODE_ENV).
const certsExist = fs.existsSync(path.join(__dirname, 'certs', 'cert.pem')) &&
                   fs.existsSync(path.join(__dirname, 'certs', 'key.pem'));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],                   // no inline scripts
      styleSrc:    ["'self'", "'unsafe-inline'"], // React uses inline styles
      imgSrc:      ["'self'", 'data:', 'blob:'],  // avatars & data URIs
      fontSrc:     ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
  hsts: certsExist ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// ── CORS — only allow same origin (the React build is served from this server)
// For local dev you can set ALLOWED_ORIGIN=http://localhost:5173
const allowedOrigin = process.env.ALLOWED_ORIGIN || null;
app.use(cors(allowedOrigin ? {
  origin: allowedOrigin,
  credentials: true,
} : {
  // Same-server deployment: no cross-origin needed; block all foreign origins
  origin: false,
}));

app.use(express.json({ limit: '1mb' }));

// ── Rate limiting on auth endpoints ──────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failures toward the limit
});
app.use('/api/auth/login',                  authLimiter);
app.use('/api/auth/2fa/verify',            authLimiter);
app.use('/api/auth/2fa/enable',            authLimiter); // brute-force 6-digit TOTP
app.use('/api/auth/change-password',       authLimiter);
app.use('/api/auth/change-password-first', authLimiter);
app.use('/api/auth/forgot-password',       authLimiter);
app.use('/api/auth/reset-password',        authLimiter);

// ── Rate limiting on bulk-import endpoints ───────────────────────────────────
// Each import can insert up to 5,000 rows; cap the burst rate to protect the DB.
const importLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,                  // max 10 imports per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many imports. Please wait a few minutes and try again.' },
});
app.use('/api/customers/import',          importLimiter);
app.use('/api/maintenance-visits/import', importLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────
// ── Health check (no auth) — used by Docker/compose healthchecks & load balancers
app.get('/api/health', async (req, res) => {
  try {
    await db.prepare('SELECT 1 AS ok').get();
    res.json({ status: 'ok', db: 'up' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/kpis', require('./routes/kpis'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/attachments', require('./routes/attachments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/scorecards', require('./routes/scorecards'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/maintenance-visits', require('./routes/maintenance-visits'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/search',         require('./routes/search'));
app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/templates',      require('./routes/templates'));
app.use('/api/workload',       require('./routes/workload'));
app.use('/api/time-logs',      require('./routes/time-logs'));
app.use('/api/notes',          require('./routes/notes'));
app.use('/api/sla',            require('./routes/sla'));
app.use('/api/report-settings', require('./routes/report-settings'));
app.use('/api/statuses',       require('./routes/statuses'));
app.use('/api/milestones',     require('./routes/milestones'));
app.use('/api/audit',          require('./routes/audit'));
app.use('/api/projects',       require('./routes/importExcel'));
app.use('/api/projects/:projectId/custom-fields', require('./routes/customFields'));
app.use('/api/calendar/ical',  require('./routes/ical'));

// ── 404 handler for unknown /api/* paths (must come before the SPA catchall) ─
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve uploaded files — avatars are displayed in-browser; all other uploads are forced to download
app.use('/uploads', (req, res, next) => {
  // Avatars are displayed as <img> in the UI — no forced download
  if (!req.path.startsWith('/avatars/')) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  // Never allow browser to sniff MIME type (defense-in-depth against SVG/HTML injection)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// ── Global error handler — catches unhandled errors from any route ────────────
// Keeps stack traces out of API responses in all environments.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  if (res.headersSent) return;
  // Only expose the message in development; production gets a generic message.
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal error occurred'
    : (err.message || 'An internal error occurred');
  res.status(err.status || 500).json({ error: message });
});

// Serve React build in production
const clientBuild = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

// ── Daily next-day visit reminders ───────────────────────────────────────────
async function sendNextDayReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const visits = await db.prepare(`
      SELECT mv.id, mv.title, mv.scheduled_date,
             cu.name AS customer_name,
             mve.user_id,
             u.name  AS engineer_name,
             u.email AS engineer_email
      FROM maintenance_visits mv
      JOIN customers cu ON mv.customer_id = cu.id
      JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
      JOIN users u ON mve.user_id = u.id
      WHERE mv.scheduled_date = ? AND mv.status = 'scheduled' AND u.active = 1
    `).all(tomorrowStr);

    console.log(`[reminders] ${visits.length} engineer-visit pair(s) for ${tomorrowStr}`);

    visits.forEach(v => {
      notify('visit.reminder', {
        visit_id:       v.id,
        visit_title:    v.title,
        customer_name:  v.customer_name,
        scheduled_date: v.scheduled_date,
        engineer_id:    v.user_id,
        engineer_name:  v.engineer_name,
        engineer_email: v.engineer_email,
      });
    });
  } catch (e) {
    console.error('[reminders]', e.message);
  }
}

function scheduleDailyReminders() {
  sendNextDayReminders();

  function scheduleNext() {
    const now  = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    console.log(`[reminders] Next run at ${next.toLocaleString()} (in ${Math.round(delay / 60000)} min)`);
    setTimeout(() => {
      sendNextDayReminders();
      setInterval(sendNextDayReminders, 24 * 60 * 60 * 1000);
    }, delay);
  }
  scheduleNext();
}

const { initScheduler } = require('./reportScheduler');

const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const HTTP_PORT  = process.env.HTTP_PORT  || 80;

const certDir  = path.join(__dirname, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile  = path.join(certDir, 'key.pem');

// Initialize the database (create schema + seed) before accepting traffic, then
// start the server. In containers there are no TLS certs, so we serve HTTP on
// PORT (TLS is terminated by an upstream proxy / load balancer).
(async () => {
  try {
    await db.init();
    console.log('[db] schema ready');
  } catch (e) {
    console.error('[db] initialization failed — refusing to start:', e.message);
    process.exit(1);
  }

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    const tlsOptions = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };

    https.createServer(tlsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`Server running on https://0.0.0.0:${HTTPS_PORT}`);
      scheduleDailyReminders();
      initScheduler();
    });

    const httpRedirect = http.createServer((req, res) => {
      const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    });
    httpRedirect.on('error', (err) => {
      console.warn(`[HTTP redirect] Could not bind port ${HTTP_PORT}: ${err.message} — skipping`);
    });
    httpRedirect.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`HTTP redirect listening on port ${HTTP_PORT} → HTTPS`);
    });

  } else {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT} (no TLS certs found)`);
      scheduleDailyReminders();
      initScheduler();
    });
  }
})();
