/**
 * The organisation's time zone (Settings → Localization) for everything that
 * means "today", "this month" or "08:00": due and overdue checks, default report
 * periods, scheduled runs. Stored timestamps stay in UTC; only calendar dates
 * and wall-clock times follow the configured zone.
 */
const db = require('./db');

const DEFAULT_TIME_ZONE = 'Asia/Nicosia';
let zone = DEFAULT_TIME_ZONE;

function validTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

/** Re-read the configured zone (at start-up, after it is saved, and periodically). */
async function refreshTimeZone(store = db) {
  try {
    const row = await store.prepare("SELECT value FROM settings WHERE key='localization_config'").get();
    const configured = row ? JSON.parse(row.value).timezone : null;
    zone = validTimeZone(configured) ? configured : DEFAULT_TIME_ZONE;
  } catch { /* keep the last known zone */ }
  return zone;
}

const timeZone = () => zone;

function localParts(date = new Date(), tz = zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}
const pad = value => String(value).padStart(2, '0');

/** Today's date (YYYY-MM-DD) in the organisation's time zone. */
function today(date = new Date()) {
  const { year, month, day } = localParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}
const thisMonth = (date = new Date()) => today(date).slice(0, 7);
const addDays = (iso, days) => { const value = new Date(`${iso}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

/** The UTC instant of a wall-clock time in a zone (handles daylight saving). */
function fromLocal({ year, month, day, hour, minute }, tz = zone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(guess), tz);
    guess += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return new Date(guess);
}

/** The next time the clock in the organisation's zone shows hour:minute. */
function nextLocalTime(hour, minute = 0, now = new Date()) {
  const date = today(now);
  let [year, month, day] = date.split('-').map(Number);
  let next = fromLocal({ year, month, day, hour, minute });
  if (next <= now) {
    [year, month, day] = addDays(date, 1).split('-').map(Number);
    next = fromLocal({ year, month, day, hour, minute });
  }
  return next;
}

module.exports = { DEFAULT_TIME_ZONE, validTimeZone, refreshTimeZone, timeZone, localParts, today, thisMonth, addDays, fromLocal, nextLocalTime };
