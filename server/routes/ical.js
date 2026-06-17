const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../db');

// Escape special iCal text characters
function icalEsc(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Format a YYYY-MM-DD date string as iCal DATE value
function icalDate(d) {
  if (!d) return null;
  return String(d).slice(0, 10).replace(/-/g, '');
}

// Format a datetime as iCal UTC timestamp
function icalDateTime(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fold(line) {
  // iCal line folding: max 75 octets, continuation lines start with a space
  const result = [];
  while (line.length > 75) {
    result.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  result.push(line);
  return result.join('\r\n');
}

/**
 * GET /api/calendar/ical?token=FEED_TOKEN
 *
 * Returns an .ics feed containing:
 *  - Upcoming maintenance visits (as events)
 *  - Tasks with deadlines (as all-day events)
 *
 * Authentication is via a dedicated, long-lived iCal feed token passed in the
 * ?token= query param so the URL can be pasted into a calendar app. The token
 * is an opaque random value (issued by POST /api/auth/ical-token) stored only
 * as a SHA-256 hash; we look the user up by that hash. Unlike a session JWT it
 * is scoped to this read-only feed and grants NO access to any other API — so
 * it is safe for it to land in third-party calendar-server and proxy logs.
 */
router.get('/', (req, res) => {
  const raw = req.query.token;
  if (!raw || typeof raw !== 'string')
    return res.status(401).send('Invalid or missing token');

  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const user = db.prepare(
    "SELECT id, name, role FROM users WHERE ical_token_hash = ? AND active = 1"
  ).get(tokenHash);
  if (!user) return res.status(401).send('Invalid or missing token');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SolutionsHub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:SolutionsHub – ${icalEsc(user.name)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  // ── Maintenance visits ──────────────────────────────────────
  const visitQuery = user.role === 'engineer'
    ? `SELECT mv.id, mv.title, mv.scheduled_date, mv.description, c.name as customer_name
       FROM maintenance_visits mv
       JOIN customers c ON mv.customer_id = c.id
       JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
       WHERE mve.user_id = ? AND mv.status NOT IN ('cancelled','completed')
       ORDER BY mv.scheduled_date`
    : (user.role === 'planner' || user.role === 'pm')
    ? `SELECT DISTINCT mv.id, mv.title, mv.scheduled_date, mv.description, c.name as customer_name
       FROM maintenance_visits mv
       JOIN customers c ON mv.customer_id = c.id
       WHERE mv.status NOT IN ('cancelled','completed')
         AND EXISTS (
           SELECT 1 FROM maintenance_visit_engineers mve
           JOIN project_assignments pa ON pa.user_id = mve.user_id
           WHERE mve.visit_id = mv.id
             AND pa.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = ?)
         )
       ORDER BY mv.scheduled_date`
    : `SELECT mv.id, mv.title, mv.scheduled_date, mv.description, c.name as customer_name
       FROM maintenance_visits mv
       JOIN customers c ON mv.customer_id = c.id
       WHERE mv.status NOT IN ('cancelled','completed')
       ORDER BY mv.scheduled_date`;

  const visits = user.role === 'engineer'
    ? db.prepare(visitQuery).all(user.id)
    : (user.role === 'planner' || user.role === 'pm')
    ? db.prepare(visitQuery).all(user.id)
    : db.prepare(visitQuery).all();

  for (const v of visits) {
    const dtstart = icalDate(v.scheduled_date);
    if (!dtstart) continue;
    // Next day for DTEND (all-day event)
    const end = new Date(v.scheduled_date + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const dtend = end.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:visit-${v.id}@solutionshub`));
    lines.push(fold(`SUMMARY:🔧 ${icalEsc(v.title)} – ${icalEsc(v.customer_name)}`));
    lines.push(fold(`DTSTART;VALUE=DATE:${dtstart}`));
    lines.push(fold(`DTEND;VALUE=DATE:${dtend}`));
    if (v.description) lines.push(fold(`DESCRIPTION:${icalEsc(v.description)}`));
    lines.push(`DTSTAMP:${icalDateTime(new Date())}`);
    lines.push('END:VEVENT');
  }

  // ── Tasks with deadlines ────────────────────────────────────
  const taskQuery = user.role === 'engineer'
    ? `SELECT id, title, deadline, project_id FROM tasks
       WHERE assigned_to = ? AND deadline IS NOT NULL AND status NOT IN ('completed','closed','cancelled')
       ORDER BY deadline`
    : user.role === 'manager'
    ? `SELECT id, title, deadline, project_id FROM tasks
       WHERE deadline IS NOT NULL AND status NOT IN ('completed','closed','cancelled')
       ORDER BY deadline`
    : `SELECT t.id, t.title, t.deadline, t.project_id FROM tasks t
       WHERE t.deadline IS NOT NULL AND t.status NOT IN ('completed','closed','cancelled')
         AND t.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = ?)
       ORDER BY t.deadline`;

  const taskParams = user.role === 'manager' ? [] : [user.id];
  const tasks = db.prepare(taskQuery).all(...taskParams);

  for (const t of tasks) {
    const dtstart = icalDate(t.deadline);
    if (!dtstart) continue;
    const end = new Date(t.deadline + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const dtend = end.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:task-${t.id}@solutionshub`));
    lines.push(fold(`SUMMARY:✅ ${icalEsc(t.title)}`));
    lines.push(fold(`DTSTART;VALUE=DATE:${dtstart}`));
    lines.push(fold(`DTEND;VALUE=DATE:${dtend}`));
    lines.push(`DTSTAMP:${icalDateTime(new Date())}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="solutionshub.ics"');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\r\n'));
});

module.exports = router;
