/**
 * Live updates: tells every open browser when data changes, so pages refresh in
 * the background instead of waiting for a reload.
 *
 * Each signed-in tab holds a Server-Sent Events stream (GET /api/live). After any
 * successful change (POST/PUT/PATCH/DELETE under /api), and when background work
 * changes data (ticket sync, reminders), an event names the area that changed —
 * "tasks", "maintenance-visits", … — never the data itself; each browser then
 * re-reads what its user is allowed to see. The tab that made a change is told
 * too but skips its own events (X-Client-Id).
 *
 * With PostgreSQL, events also go through LISTEN/NOTIFY, so every server
 * instance tells its own browsers.
 */
const crypto = require('crypto');
const db = require('./db');
const { requireAuth, verifyJwt, freshActiveUser } = require('./middleware/auth');
const { requestToken } = require('./middleware/session');

const CHANNEL = 'app_changes';
const INSTANCE = crypto.randomUUID();
let HEARTBEAT_MS = 25 * 1000;
const MAX_STREAMS = 2000;
const MAX_STREAMS_PER_USER = 10; // a few tabs and devices each; stops one account exhausting the server
// Changes that only concern the person making them, or that are not data.
const QUIET = new Set(['auth', 'live', 'client-errors', 'search']);
// Requests that change only the requester's own things (reading notifications, private notes).
const PERSONAL = new Set(['notifications', 'notes']);
const streams = new Map();
let listener = null;

const cleanClientId = value => (typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null);

function deliver({ topic, exceptClient, userId }) {
  const payload = `event: change\ndata: ${JSON.stringify({ topic })}\n\n`;
  for (const stream of streams.values()) {
    if (exceptClient && stream.clientId === exceptClient) continue;
    if (userId != null && Number(stream.userId) !== Number(userId)) continue;
    try { stream.res.write(payload); stream.res.flush?.(); } catch { /* closed; cleaned up on 'close' */ }
  }
}

/** Announce that `topic` changed — to everyone, or with `userId` to that person only. Never throws. */
function emitChange(topic, { exceptClient = null, userId = null } = {}) {
  if (!topic || QUIET.has(topic)) return;
  const event = { topic: String(topic).slice(0, 60), exceptClient: cleanClientId(exceptClient), userId: userId == null ? null : Number(userId) };
  deliver(event);
  if (listener) {
    db.pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ ...event, origin: INSTANCE })])
      .catch(error => console.error('[live] notify failed:', error.message));
  }
}

/** Express middleware for /api: announce every successful change once the response is sent. */
function trackChanges(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const topic = String(req.originalUrl || '').split('?')[0].split('/')[2];
    if (PERSONAL.has(topic)) return;
    emitChange(topic, { exceptClient: req.get('x-client-id') });
  });
  next();
}

/** GET /api/live — the event stream for one browser tab. */
function stream(req, res) {
  if (streams.size >= MAX_STREAMS) return res.status(503).json({ error: 'Too many live connections' });
  const own = [...streams.values()].filter(item => item.userId === req.user.id);
  if (own.length >= MAX_STREAMS_PER_USER) {
    // Close this person's oldest stream rather than refusing: usually a tab that went away uncleanly.
    try { own[0].res.end(); } catch { /* already gone */ }
    streams.delete(own[0].id);
  }
  const token = requestToken(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // let nginx pass events straight through
  });
  res.write('retry: 5000\n\n');
  res.flush?.();
  const id = crypto.randomUUID();
  streams.set(id, { id, res, userId: req.user.id, clientId: cleanClientId(req.query.client) });
  // Each heartbeat re-checks the session, so signing out, a password reset or a
  // deactivated account ends the stream within one heartbeat.
  const heartbeat = setInterval(async () => {
    try {
      const check = await freshActiveUser(verifyJwt(token));
      if (check.errorStatus) { streams.delete(id); res.end(); return; }
      res.write(': ping\n\n'); res.flush?.();
    } catch { streams.delete(id); try { res.end(); } catch { /* closed */ } }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  req.on('close', () => { clearInterval(heartbeat); streams.delete(id); });
}

/** Hear other instances' changes through PostgreSQL (skipped in tests and without a database URL). */
async function startListening() {
  if (listener || !process.env.DATABASE_URL || process.env.NODE_ENV === 'test') return;
  try {
    listener = await db.pool.connect();
    listener.on('notification', message => {
      try {
        const event = JSON.parse(message.payload);
        if (event.origin !== INSTANCE) deliver(event);
      } catch { /* ignore malformed */ }
    });
    listener.on('error', error => {
      console.error('[live] listener lost:', error.message);
      try { listener.release(true); } catch { /* already gone */ }
      listener = null;
      setTimeout(startListening, 5000).unref?.();
    });
    await listener.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    console.error('[live] could not listen for changes:', error.message);
    if (listener) { try { listener.release(true); } catch { /* ignore */ } }
    listener = null;
    setTimeout(startListening, 15000).unref?.();
  }
}

const router = require('express').Router();
router.get('/', requireAuth, stream);

module.exports = { router, trackChanges, emitChange, startListening, _streams: streams, _setHeartbeat: ms => { HEARTBEAT_MS = ms; } };
