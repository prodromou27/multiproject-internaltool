/**
 * Weekly report scheduler.
 * Calculates the next run time based on configured day/hour, fires it,
 * then repeats every 7 days. Call reschedule() when settings change.
 */
const db = require('./db');
const { sendWeeklyReport } = require('./weeklyReport');

let _timeout  = null;
let _interval = null;

// ── Read config from DB ───────────────────────────────────────────────────────
function getConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

// ── Calculate ms until next occurrence of (dayOfWeek, hour, minute) ──────────
// day: 0=Sun, 1=Mon, …, 6=Sat
function msUntilNext(day, hour, minute) {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  const currentDay = now.getDay();
  let daysAhead    = (day - currentDay + 7) % 7;
  // If it's today but the time has already passed, push to next week
  if (daysAhead === 0 && next <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);

  return { ms: next - now, next };
}

// ── Clear any running timers ──────────────────────────────────────────────────
function clearSchedule() {
  if (_timeout)  { clearTimeout(_timeout);   _timeout  = null; }
  if (_interval) { clearInterval(_interval); _interval = null; }
}

// ── Schedule or re-schedule based on current DB config ───────────────────────
function reschedule() {
  clearSchedule();
  const cfg = getConfig();

  if (!cfg?.enabled) {
    console.log('[weekly-report] Scheduler disabled.');
    return;
  }

  const day    = cfg.day    ?? 1;   // default: Monday
  const hour   = cfg.hour   ?? 9;   // default: 09:00
  const minute = cfg.minute ?? 0;

  const { ms, next } = msUntilNext(day, hour, minute);

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  console.log(`[weekly-report] Next run: ${next.toLocaleString()} (${DAY_NAMES[day]} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}) — in ${Math.round(ms/60000)} min`);

  _timeout = setTimeout(() => {
    sendWeeklyReport();
    // Repeat every 7 days
    _interval = setInterval(sendWeeklyReport, 7 * 24 * 60 * 60 * 1000);
  }, ms);
}

// ── Init on startup ───────────────────────────────────────────────────────────
function initScheduler() {
  // Ensure default config exists if none set
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'weekly_report_config'").get();
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('weekly_report_config', ?)")
      .run(JSON.stringify({
        enabled:    false,
        day:        1,      // Monday
        hour:       9,
        minute:     0,
        recipients: [],
        last_sent:  null,
      }));
  }
  reschedule();
}

module.exports = { initScheduler, reschedule };
