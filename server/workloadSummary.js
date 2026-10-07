/**
 * Workload → By engineer: one row per engineer for the last 1, 3, 6 or 12
 * months — tickets resolved (Request Tracker, any queue), tasks done, visits
 * completed, service activities and time logged — with what they have open
 * now, a month-by-month breakdown and the customers the work was for.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');
const { monthsBack, workload: ticketWorkload } = require('./ticketOwners');

const DONE = "('completed','closed')";
const round1 = value => Math.round(Number(value || 0) * 10) / 10;

async function engineerSummary({ months = 3, today = appTime.today() } = {}, store = db) {
  const from = monthsBack(today, months);
  const tickets = await ticketWorkload({ months, today }, store);
  const users = await store.prepare(`SELECT id, name, role, ticketing_username FROM users WHERE active=1 AND (role='engineer' OR ticketing_username IS NOT NULL) ORDER BY name, id`).all();
  const ids = users.map(user => Number(user.id));
  if (!ids.length) return { from, to: today, months: tickets.months, engineers: [], unlinked_engineers: tickets.unlinked_engineers };
  const ph = ids.map(() => '?').join(',');
  const [tasksDone, tasksOpen, visits, activities, logged, customers] = await Promise.all([
    store.prepare(`SELECT t.assigned_to AS user_id, t.updated_at, COALESCE(t.customer_id, p.customer_id) AS customer_id FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
      WHERE t.assigned_to IN (${ph}) AND t.status IN ${DONE} AND substr(t.updated_at,1,10)>=? AND substr(t.updated_at,1,10)<=?`).all(...ids, from, today),
    store.prepare(`SELECT assigned_to AS user_id, COUNT(*) AS open, SUM(CASE WHEN deadline IS NOT NULL AND deadline<? THEN 1 ELSE 0 END) AS overdue FROM tasks
      WHERE assigned_to IN (${ph}) AND status NOT IN ${DONE} AND status<>'cancelled' GROUP BY assigned_to`).all(today, ...ids),
    store.prepare(`SELECT e.user_id, v.scheduled_date, v.status, v.customer_id FROM maintenance_visits v JOIN maintenance_visit_engineers e ON e.visit_id=v.id
      WHERE e.user_id IN (${ph}) AND ((v.status='completed' AND v.scheduled_date>=? AND v.scheduled_date<=?) OR (v.status IN ('scheduled','in_progress') AND v.scheduled_date>=?))`).all(...ids, from, today, today),
    store.prepare(`SELECT engineer_id AS user_id, activity_date, duration_minutes, customer_id FROM service_activities
      WHERE engineer_id IN (${ph}) AND status<>'cancelled' AND activity_date>=? AND activity_date<=?`).all(...ids, from, today),
    store.prepare(`SELECT user_id, substr(logged_at,1,10) AS day, hours FROM time_logs WHERE user_id IN (${ph}) AND substr(logged_at,1,10)>=? AND substr(logged_at,1,10)<=?`).all(...ids, from, today),
    store.prepare('SELECT id, name FROM customers').all(),
  ]);
  const customerName = new Map(customers.map(row => [Number(row.id), decrypt(row.name)]));
  const ticketsBy = new Map(tickets.engineers.map(row => [row.id, row]));
  const openBy = new Map(tasksOpen.map(row => [Number(row.user_id), row]));
  const mine = (rows, id) => rows.filter(row => Number(row.user_id) === id);

  const engineers = users.map(user => {
    const id = Number(user.id), t = ticketsBy.get(id);
    const done = mine(tasksDone, id), myVisits = mine(visits, id), acts = mine(activities, id), logs = mine(logged, id);
    const completedVisits = myVisits.filter(v => v.status === 'completed');
    const byMonth = new Map(tickets.months.map(month => [month, { month, tickets: 0, tasks: 0, visits: 0, activities: 0, hours: 0 }]));
    const bump = (day, key, amount = 1) => { const entry = byMonth.get(String(day).slice(0, 7)); if (entry) entry[key] += amount; };
    for (const m of t?.by_month || []) bump(`${m.month}-01`, 'tickets', m.count);
    for (const row of done) bump(row.updated_at, 'tasks');
    for (const row of completedVisits) bump(row.scheduled_date, 'visits');
    for (const row of acts) { bump(row.activity_date, 'activities'); bump(row.activity_date, 'hours', Number(row.duration_minutes || 0) / 60); }
    // What the work was for: ticket customers (or RT queues), plus tasks, visits and activities.
    const work = new Map();
    const add = (label, count = 1) => { if (label) work.set(label, (work.get(label) || 0) + count); };
    for (const c of t?.customers || []) add(c.name, c.count);
    for (const row of [...done, ...completedVisits, ...acts]) if (row.customer_id) add(customerName.get(Number(row.customer_id)) || `Customer ${row.customer_id}`);
    const activityHours = acts.reduce((sum, row) => sum + Number(row.duration_minutes || 0), 0) / 60;
    return {
      id, name: user.name, role: user.role, rt_username: user.ticketing_username || null,
      tickets: t ? { linked: true, resolved: t.resolved, open_now: t.open_now, avg_days_to_resolve: t.avg_days_to_resolve, synced_at: t.synced_at, sync_error: t.sync_error } : { linked: false },
      tasks: { done: done.length, open: Number(openBy.get(id)?.open || 0), overdue: Number(openBy.get(id)?.overdue || 0) },
      visits: { completed: completedVisits.length, upcoming: myVisits.length - completedVisits.length },
      activities: { count: acts.length, hours: round1(activityHours) },
      logged_hours: round1(logs.reduce((sum, row) => sum + Number(row.hours || 0), 0)),
      by_month: [...byMonth.values()].map(entry => ({ ...entry, hours: round1(entry.hours) })),
      customers: [...work].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { from, to: today, months: tickets.months, engineers, unlinked_engineers: tickets.unlinked_engineers };
}

module.exports = { engineerSummary };
