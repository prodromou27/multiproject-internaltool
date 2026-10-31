/**
 * Approval aging and delegation (enhancement E04). A review request has a due
 * target in working days (the business calendar), so the queue shows how long
 * each item has waited and which are overdue. A manager may hand an item to a
 * named reviewer: only someone who may already make that decision, and never the
 * person who asked for it, so delegation routes work without granting anything.
 * Overdue items remind their reviewer once a day; nothing is ever decided for them.
 */
const db = require('./db');
const appTime = require('./appTime');
const calendar = require('./businessCalendar');
const { notifyUser } = require('./notifications');

const TARGET_DAYS = { closure: 3 };

/** The first date on which `days` working days have passed after `start`. */
function addWorkingDays(start, days, cal) {
  let day = String(start).slice(0, 10);
  for (let counted = 0; counted < days;) {
    const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); day = next.toISOString().slice(0, 10);
    if (calendar.isWorkingDay(day, cal)) counted++;
  }
  return day;
}

/** { waiting_days, due_on, overdue } for a request submitted at `submittedAt`. */
function aging(submittedAt, kind, cal, today = appTime.today()) {
  if (!submittedAt) return { waiting_days: null, due_on: null, overdue: false, target_days: TARGET_DAYS[kind] };
  const due = addWorkingDays(submittedAt, TARGET_DAYS[kind], cal);
  return { waiting_days: calendar.workingDaysBetween(submittedAt, today, cal), due_on: due, overdue: today > due, target_days: TARGET_DAYS[kind] };
}

/** Who may decide a closure: active managers (the closure routes require the manager role). */
async function reviewers(kind, store = db) {
  return (await store.prepare("SELECT id, name FROM users WHERE role = 'manager' AND active = 1 ORDER BY name, id").all()).map(u => ({ id: Number(u.id), name: u.name }));
}

/** The eligible reviewer with the fewest items assigned, other than the requester. */
function suggestDelegate(eligible, assignedCounts, requesterId) {
  return eligible.filter(r => r.id !== Number(requesterId))
    .sort((a, b) => (assignedCounts.get(a.id) || 0) - (assignedCounts.get(b.id) || 0) || a.name.localeCompare(b.name))[0] || null;
}

const SOURCES = {
  closure: { table: 'projects', assigned: 'closure_assigned_to', requester: 'closure_requested_by', submitted: 'closure_requested_at',
    pending: "status = 'pending_approval'", title: 'title', event: 'project_closure', link: '/approvals' },
};

async function assignedCounts(kind, store = db) {
  const s = SOURCES[kind];
  const rows = await store.prepare(`SELECT ${s.assigned} AS user_id, COUNT(*) AS n FROM ${s.table} WHERE ${s.pending} AND ${s.assigned} IS NOT NULL GROUP BY ${s.assigned}`).all();
  return new Map(rows.map(r => [Number(r.user_id), Number(r.n)]));
}

/**
 * Hands a pending request to a reviewer (or back to everyone with `userId` null).
 * Returns { error, status } or { item, delegate }.
 */
async function delegate(kind, id, userId, { by, store = db } = {}) {
  const s = SOURCES[kind];
  const item = await store.prepare(`SELECT id, ${s.title} AS title, ${s.requester} AS requester, ${s.assigned} AS assigned FROM ${s.table} WHERE id = ? AND ${s.pending}`).get(id);
  if (!item) return { status: 404, error: 'That request is not waiting for review' };
  let target = null;
  if (userId !== null) {
    target = (await reviewers(kind, store)).find(r => r.id === userId);
    if (!target) return { status: 400, error: 'Choose someone who can make this decision' };
    if (target.id === Number(item.requester)) return { status: 400, error: 'The person who asked cannot review their own request' };
  }
  await store.prepare(`UPDATE ${s.table} SET ${s.assigned} = ? WHERE id = ?`).run(target?.id ?? null, id);
  if (target && target.id !== Number(by?.id)) {
    const title = `${by?.name || 'A manager'} asked you to review: ${item.title}`;
    notifyUser(target.id, s.event, { title, body: 'It is waiting in Approvals.' }, { title, body: 'Waiting in Approvals', link: s.link });
  }
  return { item, delegate: target };
}

/** Once a day: each overdue request reminds its assigned reviewer, or every eligible reviewer when none is. */
async function remindOverdue({ store = db, today = appTime.today() } = {}) {
  const cal = await calendar.load(store);
  let sent = 0;
  for (const kind of Object.keys(SOURCES)) {
    const s = SOURCES[kind];
    const rows = await store.prepare(`SELECT id, ${s.title} AS title, ${s.requester} AS requester, ${s.assigned} AS assigned, ${s.submitted} AS submitted FROM ${s.table} WHERE ${s.pending}`).all();
    const everyone = await reviewers(kind, store);
    for (const row of rows) {
      const age = aging(row.submitted, kind, cal, today);
      if (!age.overdue) continue;
      const to = row.assigned ? [Number(row.assigned)] : everyone.map(r => r.id).filter(id => id !== Number(row.requester));
      for (const userId of to) {
        const first = await store.prepare('INSERT INTO reminder_deliveries (user_id, kind, ref, occasion) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(userId, 'approval_overdue', `${kind}:${row.id}`, today);
        if (first.changes !== 1) continue;
        const title = `Overdue for review: ${row.title}`;
        await notifyUser(userId, s.event, { title, body: `Waiting ${age.waiting_days} working days; it was due ${age.due_on}.` }, { title, body: `Due ${age.due_on}`, link: s.link });
        sent++;
      }
    }
  }
  return sent;
}

module.exports = { TARGET_DAYS, addWorkingDays, aging, reviewers, suggestDelegate, assignedCounts, delegate, remindOverdue };
