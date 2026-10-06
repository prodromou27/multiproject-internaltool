/**
 * Maintenance visit planning: who is free on which day, and suggested slots.
 *
 * An engineer is free on a weekday unless they already have a visit that day,
 * are on time off, or their week is marked as 0 available hours (Workload).
 * Suggestions rank free engineers: those who serve the customer first (its
 * teams and directly assigned engineers), then the least busy in the period.
 */
const db = require('./db');
const appTime = require('./appTime');

const MAX_DAYS = 62;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const weekday = iso => new Date(`${iso}T00:00:00Z`).getUTCDay();
const mondayOf = iso => appTime.addDays(iso, -((weekday(iso) + 6) % 7));

function days(from, to) {
  const out = [];
  for (let day = from; day <= to && out.length <= MAX_DAYS; day = appTime.addDays(day, 1)) out.push(day);
  return out;
}

/** { from, to, team_id?, customer_id? } → availability grid and suggestions. */
async function availability({ from, to, teamId = null, customerId = null, store = db, today = appTime.today() }) {
  const range = days(from, to);
  const engineers = await store.prepare(teamId
    ? "SELECT u.id, u.name FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? AND u.role = 'engineer' AND u.active = 1 ORDER BY u.name"
    : "SELECT id, name FROM users WHERE role = 'engineer' AND active = 1 ORDER BY name").all(...(teamId ? [teamId] : []));
  const ids = engineers.map(engineer => Number(engineer.id));
  if (!ids.length) return { days: range.map(day => ({ date: day, weekend: [0, 6].includes(weekday(day)) })), engineers: [], suggestions: [] };
  const marks = ids.map(() => '?').join(',');

  const serving = new Set(customerId ? (await store.prepare(`SELECT tm.user_id FROM customer_teams ct JOIN team_members tm ON tm.team_id = ct.team_id WHERE ct.customer_id = ?
    UNION SELECT user_id FROM customer_engineers WHERE customer_id = ?`).all(customerId, customerId)).map(row => Number(row.user_id)) : []);
  const visits = await store.prepare(`SELECT mv.id, mv.title, mv.scheduled_date, mv.status, mve.user_id, mv.customer_id FROM maintenance_visits mv
    JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
    WHERE mv.scheduled_date >= ? AND mv.scheduled_date <= ? AND mv.status <> 'cancelled' AND mve.user_id IN (${marks})`).all(from, to, ...ids);
  const customers = new Map((await store.prepare(`SELECT id, name FROM customers WHERE id IN (${[...new Set(visits.map(v => Number(v.customer_id)))].map(() => '?').join(',') || 'NULL'})`)
    .all(...new Set(visits.map(v => Number(v.customer_id))))).map(row => [Number(row.id), require('./fieldCipher').decrypt(row.name)]));
  const timeOff = await store.prepare(`SELECT id, user_id, start_date, end_date, reason FROM engineer_time_off WHERE start_date <= ? AND end_date >= ? AND user_id IN (${marks})`).all(to, from, ...ids);
  const tasks = await store.prepare(`SELECT assigned_to, deadline, COUNT(*) AS n FROM tasks WHERE deadline >= ? AND deadline <= ? AND status NOT IN ('completed','closed','cancelled') AND assigned_to IN (${marks}) GROUP BY assigned_to, deadline`).all(from, to, ...ids);
  const weeks = await store.prepare(`SELECT user_id, week_start, available_hours FROM workload_availability WHERE week_start >= ? AND week_start <= ? AND user_id IN (${marks})`).all(mondayOf(from), to, ...ids);

  const grid = engineers.map(engineer => {
    const id = Number(engineer.id);
    const cells = range.map(day => {
      const dayVisits = visits.filter(v => Number(v.user_id) === id && v.scheduled_date === day).map(v => ({ id: Number(v.id), title: v.title, customer: customers.get(Number(v.customer_id)) || '', status: v.status }));
      const off = timeOff.find(row => Number(row.user_id) === id && row.start_date <= day && row.end_date >= day);
      const week = weeks.find(row => Number(row.user_id) === id && row.week_start === mondayOf(day));
      const tasksDue = Number(tasks.find(row => Number(row.assigned_to) === id && row.deadline === day)?.n || 0);
      const weekend = [0, 6].includes(weekday(day));
      const noHours = week && Number(week.available_hours) === 0;
      return { date: day, visits: dayVisits, time_off: off ? { id: Number(off.id), reason: off.reason || 'Time off' } : null, tasks_due: tasksDue, no_hours: !!noHours,
        free: !weekend && !off && !noHours && dayVisits.length === 0 };
    });
    return { id, name: engineer.name, serves_customer: serving.has(id), visit_count: cells.reduce((sum, cell) => sum + cell.visits.length, 0), cells };
  });

  // Suggested slots: upcoming weekdays with a free engineer, the best engineers first.
  const suggestions = [];
  for (const [index, day] of range.entries()) {
    if (day < today || [0, 6].includes(weekday(day))) continue;
    const free = grid.filter(engineer => engineer.cells[index].free)
      .sort((a, b) => Number(b.serves_customer) - Number(a.serves_customer) || a.visit_count - b.visit_count || a.cells[index].tasks_due - b.cells[index].tasks_due || a.name.localeCompare(b.name));
    if (!free.length) continue;
    suggestions.push({ date: day, engineers: free.slice(0, 3).map(engineer => ({ id: engineer.id, name: engineer.name, serves_customer: engineer.serves_customer, tasks_due: engineer.cells[index].tasks_due })), free_count: free.length });
  }
  // Days where someone who serves the customer is free come first, then the earliest.
  suggestions.sort((a, b) => Number(!!b.engineers[0]?.serves_customer) - Number(!!a.engineers[0]?.serves_customer) || a.date.localeCompare(b.date));
  return { days: range.map(day => ({ date: day, weekend: [0, 6].includes(weekday(day)) })), engineers: grid, suggestions: suggestions.slice(0, 8) };
}

module.exports = { MAX_DAYS, isDay, days, availability };
