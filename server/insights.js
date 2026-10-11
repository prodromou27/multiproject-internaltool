/**
 * Management insights (Dashboard → Insights): the whole operation over a period
 * — work logged, tasks done on time, tickets, visits — as figures, series for
 * charts (by week, or by month for long periods), breakdowns by customer,
 * category and engineer, and what needs a manager: customer reports owed,
 * contracts ending, devices on old software, technologies few people know.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const PERIODS = Object.freeze([30, 90, 180, 365]);
const DONE = new Set(['completed', 'closed']), CLOSED = new Set(['completed', 'closed', 'cancelled']);

const dayNumber = iso => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);
const monday = iso => isoOf(dayNumber(iso) - ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The buckets of a period: weeks (from the Monday) up to 90 days, months beyond. */
function buckets(from, to, unit) {
  const out = [];
  if (unit === 'month') {
    let [y, m] = from.split('-').map(Number);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (`${key}-01` > to) break;
      out.push({ key, start: `${key}-01` });
      m++; if (m > 12) { m = 1; y++; }
    }
  } else {
    for (let n = dayNumber(monday(from)); isoOf(n) <= to; n += 7) out.push({ key: isoOf(n), start: isoOf(n) });
  }
  return out;
}
const bucketOf = (iso, unit) => (unit === 'month' ? iso.slice(0, 7) : monday(iso));

async function insights({ days = 90, store = db, today = appTime.today() } = {}) {
  const span = PERIODS.includes(Number(days)) ? Number(days) : 90;
  const to = today, from = appTime.addDays(today, -(span - 1));
  const unit = span > 90 ? 'month' : 'week';
  const series = buckets(from, to, unit).map(b => ({ ...b, hours: 0, activities: 0, tasks_on_time: 0, tasks_late: 0, tasks_created: 0, tickets_created: 0, tickets_resolved: 0, visits: 0 }));
  const at = new Map(series.map(b => [b.key, b]));
  const add = (iso, field, value = 1) => { if (iso && iso >= from && iso <= to) { const b = at.get(bucketOf(iso, unit)); if (b) b[field] += value; } };

  const [activities, completed, created, open, visits, tickets, openTickets, customers, users, categories] = await Promise.all([
    store.prepare(`SELECT activity_date, customer_id, engineer_id, category_id, COUNT(*) AS n, SUM(COALESCE(duration_minutes, 0)) AS minutes
      FROM service_activities WHERE activity_date >= ? AND activity_date <= ? AND status <> 'cancelled'
      GROUP BY activity_date, customer_id, engineer_id, category_id`).all(from, to),
    store.prepare(`SELECT completed_at, deadline, assigned_to FROM tasks WHERE completed_at IS NOT NULL AND completed_at >= ?`).all(from),
    store.prepare(`SELECT created_at FROM tasks WHERE created_at >= ?`).all(from),
    store.prepare(`SELECT status, deadline, assigned_to, team_id FROM tasks WHERE status NOT IN ('completed', 'closed', 'cancelled')`).all(),
    store.prepare(`SELECT scheduled_date, status FROM maintenance_visits WHERE scheduled_date >= ? AND scheduled_date <= ?`).all(from, to),
    store.prepare(`SELECT created_at_external, resolved_at_external FROM external_tickets WHERE created_at_external >= ? OR resolved_at_external >= ?`).all(from, from),
    store.prepare(`SELECT COUNT(*) AS n FROM external_tickets WHERE status_group = 'open'`).get(),
    store.prepare('SELECT id, name FROM customers').all(),
    store.prepare("SELECT id, name, role, active FROM users").all(),
    store.prepare('SELECT id, name FROM activity_categories').all(),
  ]);
  const customerName = new Map(customers.map(c => [Number(c.id), decrypt(c.name)]));
  const userName = new Map(users.map(u => [Number(u.id), u.name]));
  const categoryName = new Map(categories.map(c => [Number(c.id), c.name]));

  // Work logged.
  const byCustomer = new Map(), byCategory = new Map(), byEngineer = new Map();
  let minutes = 0, activityCount = 0;
  const bump = (map, id, mins, n) => { const v = map.get(id) || { minutes: 0, activities: 0 }; v.minutes += mins; v.activities += n; map.set(id, v); };
  for (const row of activities) {
    const mins = Number(row.minutes) || 0, n = Number(row.n) || 0;
    minutes += mins; activityCount += n;
    add(row.activity_date, 'hours', mins / 60); add(row.activity_date, 'activities', n);
    bump(byCustomer, Number(row.customer_id), mins, n); bump(byCategory, Number(row.category_id), mins, n); bump(byEngineer, Number(row.engineer_id), mins, n);
  }

  // Tasks: done on time (by the deadline) or late, created, open and overdue.
  let onTime = 0, late = 0;
  const doneBy = new Map();
  for (const t of completed) {
    const day = String(t.completed_at).slice(0, 10);
    if (day < from || day > to) continue;
    const lateOne = t.deadline && day > t.deadline;
    if (lateOne) late++; else onTime++;
    add(day, lateOne ? 'tasks_late' : 'tasks_on_time');
    if (t.assigned_to) doneBy.set(Number(t.assigned_to), (doneBy.get(Number(t.assigned_to)) || 0) + 1);
  }
  for (const t of created) add(String(t.created_at).slice(0, 10), 'tasks_created');
  const openBy = new Map(), overdueBy = new Map();
  let overdue = 0, teamOpen = 0;
  for (const t of open) {
    const isLate = t.deadline && t.deadline < today;
    if (isLate) overdue++;
    if (!t.assigned_to) { teamOpen++; continue; }
    const id = Number(t.assigned_to);
    openBy.set(id, (openBy.get(id) || 0) + 1);
    if (isLate) overdueBy.set(id, (overdueBy.get(id) || 0) + 1);
  }

  // Visits and tickets.
  let visitsDone = 0;
  for (const v of visits) { if (v.status === 'completed') { visitsDone++; add(v.scheduled_date, 'visits'); } }
  let ticketsCreated = 0, ticketsResolved = 0;
  for (const t of tickets) {
    const c = t.created_at_external && String(t.created_at_external).slice(0, 10), r = t.resolved_at_external && String(t.resolved_at_external).slice(0, 10);
    if (c && c >= from && c <= to) { ticketsCreated++; add(c, 'tickets_created'); }
    if (r && r >= from && r <= to) { ticketsResolved++; add(r, 'tickets_resolved'); }
  }

  const top = (map, names, limit = 8) => [...map.entries()].filter(([id]) => names.has(id)).map(([id, v]) => ({ id, name: names.get(id), hours: Math.round(v.minutes / 6) / 10, activities: v.activities }))
    .sort((a, b) => b.hours - a.hours || b.activities - a.activities).slice(0, limit);
  const engineers = users.filter(u => u.active && u.role === 'engineer').map(u => {
    const id = Number(u.id), work = byEngineer.get(id) || { minutes: 0, activities: 0 };
    return { id, name: u.name, open_tasks: openBy.get(id) || 0, overdue_tasks: overdueBy.get(id) || 0, done_tasks: doneBy.get(id) || 0, hours: Math.round(work.minutes / 6) / 10, activities: work.activities };
  }).sort((a, b) => b.open_tasks + b.hours - (a.open_tasks + a.hours) || a.name.localeCompare(b.name));

  const attention = await attentionLists(store, today);
  const totalDone = onTime + late;
  return {
    period: { from, to, days: span, unit },
    kpis: {
      hours: Math.round(minutes / 6) / 10, activities: activityCount,
      tasks_done: totalDone, on_time_rate: totalDone ? Math.round((onTime / totalDone) * 100) : null,
      open_tasks: open.length, overdue_tasks: overdue, team_tasks_waiting: teamOpen,
      visits_done: visitsDone, tickets_created: ticketsCreated, tickets_resolved: ticketsResolved, open_tickets: Number(openTickets?.n || 0),
      reports_owed: attention.reports_owed.length, reports_overdue: attention.reports_owed.filter(r => r.overdue).length,
      contracts_ending: attention.contracts_ending.length, devices_behind: attention.devices.counts.behind || 0, devices_eol: attention.devices.counts.end_of_life || 0,
      skill_gaps: attention.skills.filter(s => s.status === 'gap').length,
    },
    series: series.map(({ hours, ...b }) => ({ ...b, hours: Math.round(hours * 10) / 10 })),
    hours_by_customer: top(byCustomer, customerName),
    hours_by_category: top(byCategory, categoryName),
    engineers,
    attention: { reports_owed: attention.reports_owed, contracts_ending: attention.contracts_ending, devices: attention.devices.list, skills: attention.skills.filter(s => s.status !== 'covered').slice(0, 8) },
  };
}

/** What needs a manager now, from the features that track it. Each part fails soft. */
async function attentionLists(store, today) {
  const safe = (work, fallback) => work().catch(error => { console.error('[insights]', error.message); return fallback; });
  const [reports, contracts, devices, skills] = await Promise.all([
    safe(async () => {
      const rows = await require('./managedCustomerService').listManagedCustomers(store);
      return rows.filter(r => r.report_due && !['sent', 'not_yet_due'].includes(r.report_due.status))
        .map(r => ({ customer_id: Number(r.id), customer_name: decrypt(r.name), label: r.report_due.label, due_date: r.report_due.due_date, status: r.report_due.status, overdue: !!r.report_due.overdue }))
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_date.localeCompare(b.due_date));
    }, []),
    safe(async () => {
      const all = await require('./customerContracts').contractsFor(null, store, today);
      const names = new Map((await store.prepare('SELECT id, name FROM customers').all()).map(c => [Number(c.id), decrypt(c.name)]));
      return all.filter(c => ['ending_soon', 'expired'].includes(c.status))
        .filter(c => c.status === 'ending_soon' || c.days_left >= -60) // recently expired and not renewed
        .map(c => ({ id: c.id, customer_id: c.customer_id, customer_name: names.get(c.customer_id) || '', reference: c.reference, end_date: c.end_date, status: c.status, days_left: c.days_left }))
        .sort((a, b) => a.end_date.localeCompare(b.end_date)).slice(0, 10);
    }, []),
    safe(async () => {
      const { assets } = await require('./softwareCompliance').assetSoftwareStatus({ store, today });
      const counts = assets.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {});
      const list = assets.filter(a => ['behind', 'end_of_life'].includes(a.status))
        .sort((a, b) => (b.status === 'end_of_life') - (a.status === 'end_of_life') || (b.behind || 0) - (a.behind || 0)).slice(0, 8)
        .map(a => ({ id: a.id, customer_id: a.customer_id, customer_name: a.customer_name, name: a.name, product_name: a.product_name, software_version: a.software_version, status: a.status, behind: a.behind, behind_unit: a.behind_unit, latest: a.latest, line: a.line }));
      return { counts, list };
    }, { counts: {}, list: [] }),
    safe(async () => {
      const { coverage } = require('./skillMatrix');
      const [techs, ratings] = await Promise.all([
        store.prepare('SELECT id, name, skill_target FROM technologies WHERE active = 1').all(),
        store.prepare("SELECT s.technology_id, s.level FROM engineer_skills s JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND u.role = 'engineer'").all(),
      ]);
      const names = new Map(techs.map(t => [Number(t.id), t.name]));
      return coverage(techs, ratings).map(c => ({ ...c, name: names.get(Number(c.technology_id)) }))
        .sort((a, b) => ({ gap: 0, at_risk: 1, covered: 2 }[a.status] - { gap: 0, at_risk: 1, covered: 2 }[b.status]));
    }, []),
  ]);
  return { reports_owed: reports, contracts_ending: contracts, devices, skills };
}

module.exports = { PERIODS, insights, buckets };
