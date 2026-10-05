/**
 * Reminders: personal ones people set for themselves, and automatic ones the app
 * raises (visit tomorrow, task due or overdue, customer report due, asset support
 * or warranty expiring). Both go to the bell and the person's own channels.
 *
 * A personal reminder's time is stored as a UTC instant with the person's time
 * zone, so a weekly 09:00 reminder stays at 09:00 local across daylight saving.
 */
const db = require('./db');
const { decrypt } = require('./fieldCipher');
const { notifyUser, notify } = require('./notifications');
const { obligations } = require('./managedReportObligations');

const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const AUTOMATIC = Object.freeze([
  { key: 'visit_tomorrow', label: 'The day before one of my maintenance visits' },
  { key: 'task_due', label: 'A task assigned to me is due tomorrow, or has just become overdue' },
  { key: 'report_due', label: 'A customer report is due within 3 days, or is overdue', roles: ['manager'] },
  { key: 'asset_expiring', label: 'A managed customer\'s asset support or warranty expires within 30 days', roles: ['manager'] },
]);

function automaticSettings(raw, role) {
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  return Object.fromEntries(AUTOMATIC.filter(item => !item.roles || item.roles.includes(role)).map(item => [item.key, stored?.[item.key] !== false]));
}

// ── Local wall-clock arithmetic in an IANA time zone, without a library ──────
function validTimeZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
function localParts(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}
function fromLocal({ year, month, day, hour, minute }, zone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(guess), zone);
    guess += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return new Date(guess);
}
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** The occurrence after `due` for a repeating reminder, at the same local time. */
function nextOccurrence(due, repeat, zone) {
  const local = localParts(new Date(due), zone);
  let { year, month, day } = local;
  if (repeat === 'daily' || repeat === 'weekly') {
    const shifted = new Date(Date.UTC(year, month - 1, day + (repeat === 'daily' ? 1 : 7)));
    year = shifted.getUTCFullYear(); month = shifted.getUTCMonth() + 1; day = shifted.getUTCDate();
  } else if (repeat === 'monthly') {
    month += 1; if (month > 12) { month = 1; year += 1; }
    day = Math.min(day, daysIn(year, month));
  } else if (repeat === 'yearly') {
    year += 1; day = Math.min(day, daysIn(year, month));
  } else return null;
  return fromLocal({ year, month, day, hour: local.hour, minute: local.minute }, zone).toISOString();
}

// ── Personal reminders ───────────────────────────────────────────────────────
/** Deliver every personal reminder that has fallen due and not yet been sent for this occurrence. */
async function sendDueReminders(now = new Date(), store = db) {
  const at = now.toISOString();
  const due = await store.prepare(`SELECT r.id, r.user_id, r.title, r.notes, r.due_at, r.customer_id, c.name AS customer_name, r.created_by, s.name AS set_by_name
    FROM reminders r JOIN users u ON u.id = r.user_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users s ON s.id = r.created_by
    WHERE r.status = 'active' AND r.shared = 0 AND r.due_at <= ? AND (r.notified_at IS NULL OR r.notified_at < r.due_at) AND u.active = 1
    ORDER BY r.due_at, r.id LIMIT 200`).all(at);
  let sent = 0;
  for (const reminder of due) {
    // Claim the occurrence first, so two servers (or two ticks) never send it twice.
    const claimed = await store.prepare("UPDATE reminders SET notified_at = ? WHERE id = ? AND status = 'active' AND (notified_at IS NULL OR notified_at < due_at)").run(at, reminder.id);
    if (claimed.changes !== 1) continue;
    const customer = reminder.customer_name ? decrypt(reminder.customer_name) : null;
    await notifyUser(Number(reminder.user_id), 'reminder_due', {
      title: `⏰ ${reminder.title}`,
      body: reminder.notes || 'Your reminder is due.',
      facts: [...(customer ? [{ name: 'Customer', value: customer }] : []),
        ...(reminder.created_by && Number(reminder.created_by) !== Number(reminder.user_id) ? [{ name: 'Set by', value: reminder.set_by_name || 'A former user' }] : [])],
    }, { title: `Reminder: ${reminder.title}`, body: customer || reminder.notes || null, link: '/reminders' });
    sent++;
  }
  if (sent) require('./liveUpdates').emitChange('reminders');
  return sent;
}

// ── Shared team reminders ────────────────────────────────────────────────────
const NUDGE_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * Remind every active member of the team when a shared reminder falls due, and
 * again each day after, until someone marks it done.
 */
async function sendTeamReminders(now = new Date(), store = db) {
  const at = now.toISOString(), again = new Date(now.getTime() - NUDGE_EVERY_MS + 60 * 1000).toISOString();
  const due = await store.prepare(`SELECT r.id, r.title, r.notes, r.due_at, r.notified_at, r.team_id, t.name AS team_name, r.customer_id, c.name AS customer_name
    FROM reminders r JOIN teams t ON t.id = r.team_id LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.shared = 1 AND r.status = 'active' AND r.due_at <= ? AND (r.notified_at IS NULL OR r.notified_at < r.due_at OR r.notified_at <= ?)
    ORDER BY r.due_at, r.id LIMIT 200`).all(at, again);
  let sent = 0;
  for (const reminder of due) {
    const claimed = await store.prepare(`UPDATE reminders SET notified_at = ? WHERE id = ? AND status = 'active'
      AND (notified_at IS NULL OR notified_at < due_at OR notified_at <= ?)`).run(at, reminder.id, again);
    if (claimed.changes !== 1) continue;
    const members = await store.prepare('SELECT u.id FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.active = 1').all(reminder.team_id);
    const customer = reminder.customer_name ? decrypt(reminder.customer_name) : null;
    const repeatNotice = reminder.notified_at && reminder.notified_at >= reminder.due_at;
    for (const member of members) {
      await notifyUser(Number(member.id), 'reminder_due', {
        title: `⏰ ${reminder.title}`,
        body: `${repeatNotice ? 'Still open: ' : ''}${reminder.notes || `A ${reminder.team_name} team reminder is due. Whoever completes it, mark it done for everyone.`}`,
        facts: [{ name: 'Team', value: reminder.team_name }, ...(customer ? [{ name: 'Customer', value: customer }] : [])],
      }, { title: `${repeatNotice ? 'Still open' : 'Team reminder'}: ${reminder.title}`, body: [reminder.team_name, customer].filter(Boolean).join(' · '), link: '/reminders' });
    }
    sent++;
  }
  if (sent) require('./liveUpdates').emitChange('reminders');
  return sent;
}

// ── Automatic reminders ──────────────────────────────────────────────────────
const addDays = (iso, days) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

async function wants(userId, key, store) {
  const user = await store.prepare('SELECT role, active, reminder_settings FROM users WHERE id = ?').get(userId);
  return !!user && !!user.active && automaticSettings(user.reminder_settings, user.role)[key] === true;
}
/** Record a delivery once per person, kind, item and occasion; false if it was already sent. */
async function firstDelivery(store, userId, kind, ref, occasion) {
  const result = await store.prepare('INSERT INTO reminder_deliveries (user_id, kind, ref, occasion) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').run(userId, kind, String(ref), occasion);
  return result.changes === 1;
}
async function managersFor(store, serviceManagerId) {
  if (serviceManagerId) {
    const manager = await store.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager' AND active = 1").get(serviceManagerId);
    if (manager) return [Number(manager.id)];
  }
  return (await store.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1").all()).map(row => Number(row.id));
}

async function sendAutomaticReminders(store = db) {
  const { today } = await store.prepare('SELECT app_today() AS today').get();
  const tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  const counts = { visit_tomorrow: 0, task_due: 0, report_due: 0, asset_expiring: 0 };

  // Maintenance visits tomorrow (the existing visit reminder, now per-person optional).
  const visits = await store.prepare(`SELECT mv.id, mv.title, mv.scheduled_date, cu.name AS customer_name, mve.user_id, u.name AS engineer_name, u.email AS engineer_email
    FROM maintenance_visits mv JOIN customers cu ON mv.customer_id = cu.id
    JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id JOIN users u ON mve.user_id = u.id
    WHERE mv.scheduled_date = ? AND mv.status = 'scheduled' AND u.active = 1`).all(tomorrow);
  for (const visit of visits) {
    if (!await wants(visit.user_id, 'visit_tomorrow', store) || !await firstDelivery(store, visit.user_id, 'visit_tomorrow', visit.id, tomorrow)) continue;
    notify('visit.reminder', { visit_id: visit.id, visit_title: visit.title, customer_name: decrypt(visit.customer_name), scheduled_date: visit.scheduled_date,
      engineer_id: visit.user_id, engineer_name: visit.engineer_name, engineer_email: visit.engineer_email });
    counts.visit_tomorrow++;
  }

  // Tasks due tomorrow, and tasks that became overdue today.
  const tasks = (await store.prepare(`SELECT id, title, deadline, assigned_to, project_id, status FROM tasks
    WHERE substr(deadline,1,10) = ? OR substr(deadline,1,10) = ?`).all(tomorrow, yesterday))
    .filter(task => task.assigned_to && !['completed', 'closed', 'cancelled'].includes(task.status));
  const projectIds = [...new Set(tasks.map(task => task.project_id).filter(Boolean))];
  const projectTitles = new Map(projectIds.length ? (await store.prepare(`SELECT id, title FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')})`).all(...projectIds)).map(row => [Number(row.id), row.title]) : []);
  for (const task of tasks) {
    task.project_title = projectTitles.get(Number(task.project_id)) || null;
    const overdue = String(task.deadline).slice(0, 10) === yesterday;
    if (!await wants(task.assigned_to, 'task_due', store) || !await firstDelivery(store, task.assigned_to, 'task_due', task.id, overdue ? 'overdue' : 'due_tomorrow')) continue;
    await notifyUser(Number(task.assigned_to), 'task_due', {
      title: overdue ? '⚠️ Task overdue' : '📅 Task due tomorrow',
      body: `**${task.title}** ${overdue ? 'was due yesterday.' : 'is due tomorrow.'}`,
      facts: [{ name: 'Task', value: task.title }, ...(task.project_title ? [{ name: 'Project', value: task.project_title }] : []), { name: 'Due', value: String(task.deadline).slice(0, 10) }],
    }, { title: overdue ? `Overdue: ${task.title}` : `Due tomorrow: ${task.title}`, body: task.project_title || null, link: '/tasks' });
    counts.task_due++;
  }

  // Customer reports owed: three days before the due date, and the day after it passes.
  const managed = await store.prepare(`SELECT c.id, c.name, mc.reporting_frequency, mc.created_at AS managed_since, mc.service_manager_id
    FROM managed_customer_configurations mc JOIN customers c ON c.id = mc.customer_id
    WHERE mc.managed_services_enabled = 1 AND c.active = 1 AND mc.reporting_frequency IS NOT NULL`).all();
  const owed = await obligations(managed, store);
  for (const customer of managed) {
    const due = owed.get(Number(customer.id));
    if (!due || ['not_yet_due', 'sent'].includes(due.status)) continue;
    const occasion = today === addDays(due.due_date, -3) ? 'due_soon' : today === addDays(due.due_date, 1) ? 'overdue' : null;
    if (!occasion) continue;
    const name = decrypt(customer.name);
    for (const userId of await managersFor(store, customer.service_manager_id)) {
      if (!await wants(userId, 'report_due', store) || !await firstDelivery(store, userId, 'report_due', `${customer.id}:${due.from}`, occasion)) continue;
      await notifyUser(userId, 'report_due', {
        title: occasion === 'overdue' ? '⚠️ Customer report overdue' : '📄 Customer report due soon',
        body: `The **${due.label}** report for **${name}** ${occasion === 'overdue' ? 'was due' : 'is due'} on ${due.due_date}.`,
        facts: [{ name: 'Customer', value: name }, { name: 'Period', value: due.label }, { name: 'Due', value: due.due_date }],
      }, { title: `${name}: ${due.label} report ${occasion === 'overdue' ? 'overdue' : 'due soon'}`, body: `Due ${due.due_date}`, link: `/managed-customers/${customer.id}` });
      counts.report_due++;
    }
  }

  // Asset support or warranty ending in 30 days, and again in 7.
  const assets = await store.prepare(`SELECT a.id, a.name, a.customer_id, a.support_end_date, a.warranty_expiry_date, c.name AS customer_name, mc.service_manager_id
    FROM customer_assets a JOIN customers c ON c.id = a.customer_id
    JOIN managed_customer_configurations mc ON mc.customer_id = a.customer_id AND mc.managed_services_enabled = 1
    WHERE a.lifecycle_status NOT IN ('retired','decommissioned') AND c.active = 1
      AND (substr(a.support_end_date,1,10) IN (?, ?) OR substr(a.warranty_expiry_date,1,10) IN (?, ?))`)
    .all(addDays(today, 30), addDays(today, 7), addDays(today, 30), addDays(today, 7));
  for (const asset of assets) {
    const name = decrypt(asset.name), customer = decrypt(asset.customer_name);
    for (const [what, date] of [['Support', asset.support_end_date], ['Warranty', asset.warranty_expiry_date]]) {
      const day = date ? String(date).slice(0, 10) : null;
      if (day !== addDays(today, 30) && day !== addDays(today, 7)) continue;
      for (const userId of await managersFor(store, asset.service_manager_id)) {
        if (!await wants(userId, 'asset_expiring', store) || !await firstDelivery(store, userId, 'asset_expiring', `${asset.id}:${what}:${day}`, day === addDays(today, 7) ? '7_days' : '30_days')) continue;
        await notifyUser(userId, 'asset_expiring', {
          title: `🛡️ ${what} expiring`,
          body: `${what} for **${name}** (${customer}) ends on ${day}.`,
          facts: [{ name: 'Asset', value: name }, { name: 'Customer', value: customer }, { name: 'Ends', value: day }],
        }, { title: `${what} expiring: ${name}`, body: `${customer} · ends ${day}`, link: `/customers/${asset.customer_id}/service-profile?section=assets` });
        counts.asset_expiring++;
      }
    }
  }
  return counts;
}

// ── Scheduling ───────────────────────────────────────────────────────────────
function startReminderSchedules() {
  const tick = () => Promise.all([
    sendDueReminders().catch(error => console.error('[reminders] personal:', error.message)),
    sendTeamReminders().catch(error => console.error('[reminders] team:', error.message)),
  ]);
  tick();
  setInterval(tick, 60 * 1000).unref?.();

  const daily = () => sendAutomaticReminders()
    .then(counts => console.log('[reminders] automatic:', JSON.stringify(counts)))
    .catch(error => console.error('[reminders] automatic:', error.message));
  daily(); // deliveries are recorded, so a restart the same day sends nothing twice
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  console.log(`[reminders] Next automatic run at ${next.toLocaleString()} (in ${Math.round((next - now) / 60000)} min)`);
  setTimeout(() => { daily(); setInterval(daily, 24 * 60 * 60 * 1000).unref?.(); }, next - now).unref?.();
}

module.exports = { REPEATS, AUTOMATIC, automaticSettings, validTimeZone, nextOccurrence, fromLocal, localParts, sendDueReminders, sendTeamReminders, sendAutomaticReminders, startReminderSchedules };
