/* Checks a maintenance visit's date, time and engineers before it is saved
   (review I10), and again when it is saved.

   A visit is all day (no start time) or has a start time and a duration. Problems
   come back as warnings, each one either:
   - hard: a public holiday, an engineer on time off, or times that overlap another
     of the engineer's visits. Saving needs an explicit "save anyway".
   - advisory: a non-working day, less travel time between visits than the buffer
     (Settings → Time & region), another visit the same day when either is all day,
     a week marked with no available hours, or no Senior/Expert rating for the
     technologies involved (skill matrix). Shown, never blocking. */
const db = require('./db');
const calendar = require('./businessCalendar');

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = time => { const m = TIME.exec(time || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const SKILLED = 3; // Senior or Expert

/** Checks start_time / duration_minutes from a request: both, or neither (all day). */
function validateTimes(body, existing = {}) {
  const start = body.start_time === undefined ? existing.start_time ?? null : body.start_time || null;
  const duration = body.duration_minutes === undefined ? existing.duration_minutes ?? null : body.duration_minutes === '' || body.duration_minutes === null ? null : Number(body.duration_minutes);
  if (start !== null && !TIME.test(start)) return { error: 'start_time must be HH:MM (24-hour)' };
  if (duration !== null && (!Number.isInteger(duration) || duration < 15 || duration > 1440)) return { error: 'duration_minutes must be 15 to 1440' };
  if ((start === null) !== (duration === null)) return { error: 'Give both a start time and a duration, or neither for an all-day visit' };
  if (start !== null && minutesOf(start) + duration > 24 * 60) return { error: 'The visit must end the same day' };
  return { value: { start_time: start, duration_minutes: duration } };
}

const span = visit => (visit.start_time ? { from: minutesOf(visit.start_time), to: minutesOf(visit.start_time) + Number(visit.duration_minutes) } : null);
const label = visit => (visit.start_time ? `${visit.start_time}–${clock(minutesOf(visit.start_time) + Number(visit.duration_minutes))}` : 'all day');

/**
 * visit: { id?, customer_id, scheduled_date, start_time, duration_minutes, engineer_ids, asset_ids? }
 * → [{ code, severity: 'hard' | 'advisory', message }]
 */
async function checkVisit(visit, store = db) {
  const warnings = [];
  const add = (code, severity, message) => warnings.push({ code, severity, message });
  const cal = await calendar.load(store);
  const day = visit.scheduled_date;
  const off = calendar.dayOff(day, cal);
  if (off?.kind === 'holiday') add('holiday', 'hard', `${day} is a public holiday (${off.name}).`);
  else if (off) add('non_working_day', 'advisory', `${day} is not a working day.`);

  const ids = [...new Set((visit.engineer_ids || []).map(Number))].filter(Boolean);
  if (!ids.length) return warnings;
  const marks = ids.map(() => '?').join(',');
  const names = new Map((await store.prepare(`SELECT id, name FROM users WHERE id IN (${marks})`).all(...ids)).map(row => [Number(row.id), row.name]));

  const timeOff = await store.prepare(`SELECT user_id, reason FROM engineer_time_off WHERE start_date <= ? AND end_date >= ? AND user_id IN (${marks})`).all(day, day, ...ids);
  for (const row of timeOff) add('time_off', 'hard', `${names.get(Number(row.user_id))} is on time off that day${row.reason ? ` (${row.reason})` : ''}.`);

  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const noHours = await store.prepare(`SELECT user_id FROM workload_availability WHERE week_start = ? AND available_hours = 0 AND user_id IN (${marks})`).all(monday, ...ids);
  for (const row of noHours) add('no_hours', 'advisory', `${names.get(Number(row.user_id))} has no available hours that week (Workload).`);

  // The engineers' other visits that day.
  const others = await store.prepare(`SELECT mv.id, mv.title, mv.customer_id, mv.start_time, mv.duration_minutes, mve.user_id FROM maintenance_visits mv
    JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
    WHERE mv.scheduled_date = ? AND mv.status <> 'cancelled' AND mve.user_id IN (${marks})${visit.id ? ' AND mv.id <> ?' : ''}`).all(day, ...ids, ...(visit.id ? [visit.id] : []));
  const mine = span(visit), buffer = cal.travel_buffer_minutes;
  for (const other of others) {
    const who = names.get(Number(other.user_id)), theirs = span(other);
    if (mine && theirs) {
      if (mine.from < theirs.to && theirs.from < mine.to) add('overlap', 'hard', `${who} already has "${other.title}" at ${label(other)}, which overlaps.`);
      else {
        const gap = mine.from >= theirs.to ? mine.from - theirs.to : theirs.from - mine.to;
        const sameCustomer = Number(other.customer_id) === Number(visit.customer_id);
        if (!sameCustomer && gap < buffer) add('travel', 'advisory', `${who} has only ${gap} minutes between this visit and "${other.title}" (${label(other)}); the travel buffer is ${buffer} minutes.`);
      }
    } else add('same_day', 'advisory', `${who} already has "${other.title}" that day (${label(other)}).`);
  }

  // Skills: the technologies of the visit's assets (else the customer's active assets).
  const assetIds = (visit.asset_ids || []).map(Number).filter(Boolean);
  const technologies = assetIds.length
    ? await store.prepare(`SELECT DISTINCT a.technology_id, t.name FROM customer_assets a JOIN technologies t ON t.id = a.technology_id WHERE a.id IN (${assetIds.map(() => '?').join(',')})`).all(...assetIds)
    : visit.customer_id ? await store.prepare(`SELECT DISTINCT a.technology_id, t.name FROM customer_assets a JOIN technologies t ON t.id = a.technology_id WHERE a.customer_id = ? AND a.lifecycle_status = 'active'`).all(visit.customer_id) : [];
  if (technologies.length) {
    const ratings = await store.prepare(`SELECT user_id, technology_id, level FROM engineer_skills WHERE user_id IN (${marks}) AND technology_id IN (${technologies.map(() => '?').join(',')})`)
      .all(...ids, ...technologies.map(t => t.technology_id));
    const skilled = ids.some(id => ratings.some(r => Number(r.user_id) === id && Number(r.level) >= SKILLED));
    if (!skilled) add('skills', 'advisory', `No engineer on this visit is rated Senior or Expert in ${technologies.map(t => t.name).slice(0, 3).join(', ')}.`);
  }
  return warnings;
}

module.exports = { TIME, minutesOf, clock, validateTimes, checkVisit, label };
