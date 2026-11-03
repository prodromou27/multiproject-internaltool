const router = require('express').Router();
const crypto = require('crypto');
const db     = require('../db');
const { decrypt } = require('../fieldCipher');
const { PRODUCT_NAME } = require('../product');
const { fold } = require('../icalFold');
const { ownTasksSql, ownTasksParams } = require('../taskAccess');
const { hasPermission } = require('../permissions');

// Escape special iCal text characters
function icalEsc(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
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
// Also /api/calendar/ical/<token>.ics: some calendar apps (Outlook among them) only
// accept a subscription address that ends in .ics, or drop query strings.
router.get('/:token.ics', (req, res, next) => { feed(req.params.token, req, res).catch(next); });
router.get('/', (req, res, next) => { feed(req.query.token, req, res).catch(next); });

async function feed(raw, req, res) {
  if (!raw || typeof raw !== 'string')
    return res.status(401).send('Invalid or missing token');

  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const user = (await db.prepare(
    "SELECT id, name, role FROM users WHERE ical_token_hash = ? AND active = 1"
  ).get(tokenHash));
  if (!user) return res.status(401).send('Invalid or missing token');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${PRODUCT_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${PRODUCT_NAME} – ${icalEsc(user.name)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  // ── Maintenance visits ──────────────────────────────────────
  const visitQuery = user.role === 'engineer'
    ? `SELECT mv.id, mv.title, mv.scheduled_date, mv.end_date, mv.start_time, mv.duration_minutes, mv.description, c.name as customer_name
       FROM maintenance_visits mv
       JOIN customers c ON mv.customer_id = c.id
       JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
       WHERE mve.user_id = ? AND mv.status NOT IN ('cancelled','completed')
       ORDER BY mv.scheduled_date`
    : (user.role === 'planner' || user.role === 'pm')
    ? `SELECT DISTINCT mv.id, mv.title, mv.scheduled_date, mv.end_date, mv.description, c.name as customer_name
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
    : `SELECT mv.id, mv.title, mv.scheduled_date, mv.end_date, mv.start_time, mv.duration_minutes, mv.description, c.name as customer_name
       FROM maintenance_visits mv
       JOIN customers c ON mv.customer_id = c.id
       WHERE mv.status NOT IN ('cancelled','completed')
       ORDER BY mv.scheduled_date`;

  // Permissions are checked every time the feed is fetched, so revoking a module
  // removes its events from calendars that subscribed earlier.
  const [canVisits, canTasks] = [await hasPermission(user, 'visits.access'), await hasPermission(user, 'tasks.access')];
  const visits = !canVisits ? []
    : user.role === 'engineer'
    ? (await db.prepare(visitQuery).all(user.id))
    : (user.role === 'planner' || user.role === 'pm')
    ? (await db.prepare(visitQuery).all(user.id))
    : (await db.prepare(visitQuery).all());

  for (const v of visits) {
    const dtstart = icalDate(v.scheduled_date);
    if (!dtstart) continue;
    const visitEndDate = String(v.end_date || v.scheduled_date).slice(0, 10);
    const multiDay = visitEndDate > v.scheduled_date.slice(0, 10);
    // Next day after the visit's last day for DTEND (all-day event)
    const end = new Date(visitEndDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const dtend = end.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:visit-${v.id}@solutionshub`));
    lines.push(fold(`SUMMARY:🔧 ${icalEsc(v.title)} – ${icalEsc(decrypt(v.customer_name))}`));
    if (v.start_time && v.duration_minutes && !multiDay) {
      // A single-day timed visit: its local start (the organisation's time zone) as a UTC instant.
      const [year, month, day] = v.scheduled_date.slice(0, 10).split('-').map(Number), [hour, minute] = v.start_time.split(':').map(Number);
      const startsAt = require('../appTime').fromLocal({ year, month, day, hour, minute });
      lines.push(`DTSTART:${icalDateTime(startsAt)}`);
      lines.push(`DTEND:${icalDateTime(new Date(startsAt.getTime() + Number(v.duration_minutes) * 60000))}`);
    } else {
      // All day, or spanning more than one day: a single VEVENT can't express a daily
      // time slot repeated across several days, so a multi-day visit is shown all-day.
      lines.push(fold(`DTSTART;VALUE=DATE:${dtstart}`));
      lines.push(fold(`DTEND;VALUE=DATE:${dtend}`));
    }
    if (v.description) lines.push(fold(`DESCRIPTION:${icalEsc(v.description)}`));
    lines.push(`DTSTAMP:${icalDateTime(new Date())}`);
    lines.push('END:VEVENT');
  }

  // ── Tasks with deadlines ────────────────────────────────────
  const taskQuery = user.role === 'engineer'
    ? `SELECT id, title, deadline, project_id FROM tasks
       WHERE ${ownTasksSql()} AND deadline IS NOT NULL AND status NOT IN ('completed','closed','cancelled')
       ORDER BY deadline`
    : user.role === 'manager'
    ? `SELECT id, title, deadline, project_id FROM tasks
       WHERE deadline IS NOT NULL AND status NOT IN ('completed','closed','cancelled')
       ORDER BY deadline`
    : `SELECT t.id, t.title, t.deadline, t.project_id FROM tasks t
       WHERE t.deadline IS NOT NULL AND t.status NOT IN ('completed','closed','cancelled')
         AND t.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = ?)
       ORDER BY t.deadline`;

  const taskParams = user.role === 'manager' ? [] : user.role === 'engineer' ? ownTasksParams(user.id) : [user.id];
  const tasks = canTasks ? (await db.prepare(taskQuery).all(...taskParams)) : [];

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

  // Public holidays (Settings → Time & region): the last month and the year ahead, shown as free time.
  const businessCalendar = require('../businessCalendar');
  const dayIso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  for (const holiday of businessCalendar.holidaysBetween(dayIso(-31), dayIso(366), await businessCalendar.load())) {
    const next = new Date(`${holiday.date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:holiday-${holiday.date.replace(/-/g, '')}@solutionshub`));
    lines.push(fold(`SUMMARY:${icalEsc(holiday.name)} (public holiday)`));
    lines.push(`DTSTART;VALUE=DATE:${holiday.date.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push(`DTSTAMP:${icalDateTime(new Date())}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // Inline: a calendar app subscribes to it; a browser that opens it may still save it.
  res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\r\n') + '\r\n');
}

module.exports = router;
module.exports.icalEsc = icalEsc;
