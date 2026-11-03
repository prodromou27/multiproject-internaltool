/**
 * Reports → Tasks: a Monday.com-style dashboard of the tasks — how many are open,
 * overdue, waiting and done; created against completed over time; open work by
 * status, priority, person and customer; subtasks; and the lists that need a
 * look (overdue, waiting for more than a week). For reports.access.
 *
 * Filters: one customer, one team (its members' tasks and the team's own) and/or
 * one engineer. The period (days) applies to what was created and completed in it;
 * open work is as of today.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');
const { buckets } = require('./insights');

const OPEN = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'pending_approval'];
const DONE = ['completed', 'closed'];
const WAITING = ['waiting_customer', 'waiting_vendor'];
const STUCK_DAYS = 7;
const dayOf = value => (value ? String(value).slice(0, 10) : null);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

async function taskInsights({ days = 90, customerId = null, teamId = null, engineerId = null, store = db, today = appTime.today() } = {}) {
  const from = appTime.addDays(today, -(days - 1)), to = today, weekEnd = appTime.addDays(today, 6);
  const unit = days > 90 ? 'month' : 'week';
  const [tasks, subtasks, users, customers, members] = await Promise.all([
    store.prepare(`SELECT tk.id, tk.title, tk.status, tk.priority, tk.deadline, tk.created_at, tk.completed_at, tk.updated_at, tk.assigned_to, tk.team_id,
      tk.pending_from_customer, tk.project_id, COALESCE(tk.customer_id, p.customer_id) AS customer_id
      FROM tasks tk LEFT JOIN projects p ON p.id = tk.project_id`).all(),
    store.prepare('SELECT task_id, done, assigned_to, due_date FROM task_subtasks').all(),
    store.prepare('SELECT id, name, role, active FROM users').all(),
    store.prepare('SELECT id, name FROM customers').all(),
    teamId ? store.prepare('SELECT user_id FROM team_members WHERE team_id = ?').all(teamId) : Promise.resolve([]),
  ]);
  const team = teamId ? new Set(members.map(m => Number(m.user_id))) : null;
  const inScope = task => (customerId == null || Number(task.customer_id) === Number(customerId))
    && (engineerId == null || Number(task.assigned_to) === Number(engineerId))
    && (!team || (task.assigned_to != null ? team.has(Number(task.assigned_to)) : Number(task.team_id) === Number(teamId)));
  const scoped = tasks.filter(inScope);
  const open = scoped.filter(t => OPEN.includes(t.status));
  const late = t => t.deadline && dayOf(t.deadline) < today;
  const overdue = open.filter(late);
  const created = scoped.filter(t => dayOf(t.created_at) >= from && dayOf(t.created_at) <= to);
  const completed = scoped.filter(t => DONE.includes(t.status) && t.completed_at && dayOf(t.completed_at) >= from && dayOf(t.completed_at) <= to);
  const withDeadline = completed.filter(t => t.deadline);
  const onTime = t => t.deadline && dayOf(t.completed_at) <= dayOf(t.deadline);
  const durations = completed.filter(t => t.created_at).map(t => Math.max(0, daysBetween(dayOf(t.created_at), dayOf(t.completed_at))));

  const openIds = new Set(open.map(t => Number(t.id)));
  const openSubtasks = subtasks.filter(s => !s.done && openIds.has(Number(s.task_id)));
  const names = new Map(users.map(u => [Number(u.id), u.name]));
  const customerName = id => { const row = customers.find(c => Number(c.id) === Number(id)); return row ? decrypt(row.name) : null; };
  const who = t => names.get(Number(t.assigned_to)) || null;

  // Created against completed (on time / late), per week or month.
  const series = buckets(from, to, unit).map(bucket => ({ ...bucket, created: 0, on_time: 0, late: 0 }));
  const bucketOf = day => [...series].reverse().find(b => day >= b.start);
  for (const t of created) { const b = bucketOf(dayOf(t.created_at)); if (b) b.created++; }
  for (const t of completed) { const b = bucketOf(dayOf(t.completed_at)); if (b) { if (!t.deadline || onTime(t)) b.on_time++; else b.late++; } }

  const count = (list, key) => list.reduce((map, t) => map.set(t[key], (map.get(t[key]) || 0) + 1), new Map());
  const byStatus = count(open, 'status'), byPriority = count(open, 'priority');

  // People: engineers with open work, work done in the period, or open subtasks.
  const peopleIds = new Set([...open, ...completed].map(t => t.assigned_to).filter(Boolean).map(Number));
  for (const s of openSubtasks) if (s.assigned_to) peopleIds.add(Number(s.assigned_to));
  if (engineerId) { peopleIds.clear(); peopleIds.add(Number(engineerId)); }
  if (team) for (const id of [...peopleIds]) if (!team.has(id)) peopleIds.delete(id);
  const people = [...peopleIds].map(id => {
    const mine = open.filter(t => Number(t.assigned_to) === id), done = completed.filter(t => Number(t.assigned_to) === id);
    const timed = done.filter(t => t.deadline);
    const subs = openSubtasks.filter(s => Number(s.assigned_to) === id);
    return { id, name: names.get(id) || 'Unknown', open: mine.length, overdue: mine.filter(late).length, done: done.length,
      on_time_rate: timed.length ? Math.round(timed.filter(onTime).length / timed.length * 100) : null,
      open_subtasks: subs.length, overdue_subtasks: subs.filter(s => s.due_date && s.due_date < today).length };
  }).sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name));

  const customerIds = [...new Set(open.map(t => t.customer_id).filter(Boolean).map(Number))];
  const byCustomer = customerIds.map(id => ({ id, name: customerName(id), open: open.filter(t => Number(t.customer_id) === id).length, overdue: overdue.filter(t => Number(t.customer_id) === id).length }))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue).slice(0, 8);

  const row = t => ({ id: Number(t.id), title: t.title, status: t.status, priority: t.priority, deadline: dayOf(t.deadline), who: who(t),
    team_task: !t.assigned_to && !!t.team_id, customer_id: t.customer_id ? Number(t.customer_id) : null, customer_name: t.customer_id ? customerName(t.customer_id) : null, project_id: t.project_id || null });
  const overdueList = [...overdue].sort((a, b) => String(a.deadline).localeCompare(String(b.deadline))).slice(0, 10)
    .map(t => ({ ...row(t), days_overdue: daysBetween(dayOf(t.deadline), today) }));
  const stuck = open.filter(t => WAITING.includes(t.status) && t.updated_at && daysBetween(dayOf(t.updated_at), today) > STUCK_DAYS)
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))).slice(0, 10)
    .map(t => ({ ...row(t), waiting_days: daysBetween(dayOf(t.updated_at), today), reason: t.pending_from_customer || null }));

  return {
    period: { from, to, days, unit },
    kpis: {
      open: open.length, overdue: overdue.length, due_this_week: open.filter(t => t.deadline && dayOf(t.deadline) >= today && dayOf(t.deadline) <= weekEnd).length,
      unassigned: open.filter(t => !t.assigned_to).length, waiting: open.filter(t => WAITING.includes(t.status)).length,
      created: created.length, completed: completed.length,
      on_time_rate: withDeadline.length ? Math.round(withDeadline.filter(onTime).length / withDeadline.length * 100) : null,
      avg_days_to_complete: durations.length ? Math.round(durations.reduce((sum, n) => sum + n, 0) / durations.length * 10) / 10 : null,
      open_subtasks: openSubtasks.length, overdue_subtasks: openSubtasks.filter(s => s.due_date && s.due_date < today).length,
    },
    series,
    by_status: OPEN.map(status => ({ status, count: byStatus.get(status) || 0 })),
    by_priority: ['critical', 'high', 'medium', 'low'].map(priority => ({ priority, count: byPriority.get(priority) || 0 })),
    people, by_customer: byCustomer, overdue: overdueList, stuck, stuck_days: STUCK_DAYS,
  };
}

module.exports = { taskInsights };
