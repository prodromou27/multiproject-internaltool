/**
 * /api/reminders — each person's own reminders and their automatic-reminder
 * choices. A manager can also set a reminder for a person or a team: each
 * recipient gets a copy they can mark done or snooze but not change, and the
 * manager can change or remove every copy at once.
 *
 * A shared team reminder (e.g. "Renew the SSL certificate for X") is one
 * reminder for a whole team: every member is reminded, daily once due, until
 * anyone marks it done. Members of the team (and managers) can complete it;
 * whoever set it (or a manager) can change or remove it.
 */
const crypto = require('crypto');
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { decrypt } = require('../fieldCipher');
const { canAccessCustomer } = require('../customerAccess');
const { REPEATS, AUTOMATIC, automaticSettings, validTimeZone, nextOccurrence } = require('../reminders');

router.use(requireAuth);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

async function reminderInput(body, user, existing) {
  const has = key => Object.prototype.hasOwnProperty.call(body || {}, key);
  const value = key => (has(key) ? body[key] : existing?.[key]);
  const title = String(value('title') ?? '').trim();
  if (!title) fail('Give the reminder a title');
  if (title.length > 200) fail('The title must be at most 200 characters');
  const notes = value('notes') == null ? '' : value('notes');
  if (typeof notes !== 'string' || notes.length > 2000) fail('Notes must be text of at most 2,000 characters');
  const dueAt = has('due_at') ? instant(body.due_at) : existing?.due_at;
  if (!dueAt) fail('Choose a valid date and time');
  const repeat = value('repeat') || 'none';
  if (!REPEATS.includes(repeat)) fail(`Repeat must be one of: ${REPEATS.join(', ')}`);
  const timeZone = value('time_zone');
  if (!validTimeZone(timeZone)) fail('A valid time zone is required');
  let customerId = value('customer_id');
  customerId = customerId === '' || customerId == null ? null : customerId;
  if (customerId !== null) {
    if (!positiveId(customerId)) fail('Invalid customer');
    if (has('customer_id') && !await canAccessCustomer(user, customerId)) fail('You cannot link a reminder to that customer', 403);
    customerId = Number(customerId);
  }
  return { title, notes: notes.trim() || null, dueAt, repeat, timeZone, customerId };
}

const view = row => {
  const { user_id: owner, created_by: createdBy, set_by_name: setBy, ...rest } = row;
  const fromOther = createdBy != null && Number(createdBy) !== Number(owner);
  return { ...rest, id: Number(row.id), customer_id: row.customer_id == null ? null : Number(row.customer_id), customer_name: row.customer_name ? decrypt(row.customer_name) : null,
    set_by: fromOther ? (setBy || 'A former user') : null };
};
const setByOther = (reminder, userId) => reminder.created_by != null && Number(reminder.created_by) !== Number(userId);

// Who a manager's reminder goes to: { user_id } or { team_id }. Active users only.
async function recipientsFor(target, manager) {
  if (manager.role !== 'manager') fail('Only managers can set reminders for others', 403);
  if (!target || typeof target !== 'object') fail('Choose who the reminder is for');
  if (target.user_id != null) {
    if (!positiveId(target.user_id)) fail('Invalid person');
    const person = await db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(target.user_id);
    if (!person) fail('That person is not an active user');
    return { userIds: [Number(person.id)], teamId: null };
  }
  if (target.team_id != null) {
    if (!positiveId(target.team_id)) fail('Invalid team');
    const team = await db.prepare('SELECT id FROM teams WHERE id = ?').get(target.team_id);
    if (!team) fail('Team not found');
    const members = await db.prepare('SELECT u.id FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.active = 1 ORDER BY u.id').all(team.id);
    if (!members.length) fail('That team has no active members');
    return { userIds: members.map(row => Number(row.id)), teamId: Number(team.id) };
  }
  fail('Choose a person or a team');
}

// A manager's reminders for others, one entry per set (all its copies).
async function setForOthers(managerId) {
  const rows = await db.prepare(`SELECT r.id, r.group_key, r.title, r.notes, r.due_at, r.time_zone, r.repeat, r.customer_id, c.name AS customer_name, r.status, r.completed_at,
      r.team_id, t.name AS team_name, u.id AS recipient_id, u.name AS recipient_name
    FROM reminders r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.id = r.team_id LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.created_by = ? AND r.user_id != ? AND r.group_key IS NOT NULL ORDER BY r.due_at, r.id LIMIT 2000`).all(managerId, managerId);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group_key)) groups.set(row.group_key, { group_key: row.group_key, title: row.title, notes: row.notes, due_at: row.due_at, time_zone: row.time_zone, repeat: row.repeat,
      customer_id: row.customer_id == null ? null : Number(row.customer_id), customer_name: row.customer_name ? decrypt(row.customer_name) : null, team_name: row.team_name || null, recipients: [] });
    const group = groups.get(row.group_key);
    if (row.status === 'active' && row.due_at < group.due_at) group.due_at = row.due_at;
    group.recipients.push({ id: Number(row.recipient_id), name: row.recipient_name, status: row.status, due_at: row.due_at, completed_at: row.completed_at });
  }
  // Keep sets still running, and finished ones for 30 days.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  return [...groups.values()].filter(group => group.recipients.some(item => item.status === 'active' || String(item.completed_at) >= cutoff));
}
const SELECT = `SELECT r.id, r.user_id, r.title, r.notes, r.due_at, r.time_zone, r.repeat, r.customer_id, c.name AS customer_name, r.status, r.notified_at, r.completed_at, r.created_at,
    r.created_by, s.name AS set_by_name
  FROM reminders r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users s ON s.id = r.created_by`;
const one = async (id, userId) => db.prepare(`${SELECT} WHERE r.id = ? AND r.user_id = ? AND r.shared = 0`).get(id, userId);

// ── Shared team reminders ──
const memberOf = async (userId, teamId) => !!await db.prepare('SELECT 1 FROM team_members WHERE user_id = ? AND team_id = ?').get(userId, teamId);
async function teamReminderList(user) {
  const teamIds = user.role === 'manager'
    ? (await db.prepare('SELECT id FROM teams').all()).map(row => Number(row.id))
    : (await db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(user.id)).map(row => Number(row.team_id));
  if (!teamIds.length) return [];
  const rows = await db.prepare(`SELECT r.id, r.title, r.notes, r.due_at, r.time_zone, r.repeat, r.customer_id, c.name AS customer_name, r.status, r.notified_at, r.completed_at,
      r.team_id, t.name AS team_name, r.user_id AS created_by, s.name AS set_by_name, d.name AS completed_by_name
    FROM reminders r JOIN teams t ON t.id = r.team_id LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN users s ON s.id = r.user_id LEFT JOIN users d ON d.id = r.completed_by
    WHERE r.shared = 1 AND r.team_id IN (${teamIds.map(() => '?').join(',')}) AND (r.status = 'active' OR r.completed_at >= ?)
    ORDER BY r.status, r.due_at, r.id LIMIT 500`).all(...teamIds, new Date(Date.now() - 30 * 86400000).toISOString());
  return rows.map(row => ({
    id: Number(row.id), title: row.title, notes: row.notes, due_at: row.due_at, time_zone: row.time_zone, repeat: row.repeat, status: row.status,
    customer_id: row.customer_id == null ? null : Number(row.customer_id), customer_name: row.customer_name ? decrypt(row.customer_name) : null,
    team_id: Number(row.team_id), team_name: row.team_name, set_by: row.set_by_name || 'A former user', completed_by: row.completed_by_name || null, completed_at: row.completed_at,
    reminded: !!row.notified_at && row.notified_at >= row.due_at,
    can_change: user.role === 'manager' || Number(row.created_by) === Number(user.id),
  }));
}
async function teamReminder(req, { change = false } = {}) {
  if (!positiveId(req.params.id)) fail('Invalid reminder', 400);
  const reminder = await db.prepare('SELECT * FROM reminders WHERE id = ? AND shared = 1').get(req.params.id);
  if (!reminder) fail('Reminder not found', 404);
  const manager = req.user.role === 'manager';
  if (!manager && !await memberOf(req.user.id, reminder.team_id)) fail('Reminder not found', 404);
  if (change && !manager && Number(reminder.user_id) !== Number(req.user.id)) fail('Only whoever set this team reminder, or a manager, can change it', 403);
  return reminder;
}

// Customers a person may link a reminder to (the same rule as customerAccess.canAccessCustomer).
async function linkableCustomers(user) {
  if (['manager', 'planner'].includes(user.role)) return db.prepare('SELECT id, name FROM customers WHERE active = 1').all();
  if (user.role !== 'engineer') return [];
  return db.prepare(`SELECT id, name FROM customers WHERE active = 1 AND id IN (
    SELECT p.customer_id FROM projects p JOIN project_assignments pa ON pa.project_id = p.id WHERE pa.user_id = ?
    UNION SELECT mv.customer_id FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id WHERE mve.user_id = ?
    UNION SELECT ce.customer_id FROM customer_engineers ce WHERE ce.user_id = ?
    UNION SELECT ct.customer_id FROM customer_teams ct JOIN team_members tm ON tm.team_id = ct.team_id WHERE tm.user_id = ?)`).all(user.id, user.id, user.id, user.id);
}

// One customer's reminders, for Customer 360: the team reminders about it that
// this person can see, their own reminders linked to it, and which team a new
// one should go to by default (the managed-services team, else one of theirs).
router.get('/customer/:id', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer' });
  const customerId = Number(req.params.id);
  if (!await canAccessCustomer(req.user, customerId)) return res.status(404).json({ error: 'Customer not found' });
  const team = (await teamReminderList(req.user)).filter(row => row.customer_id === customerId);
  const own = (await db.prepare(`${SELECT} WHERE r.user_id = ? AND r.shared = 0 AND r.customer_id = ? AND (r.status = 'active' OR r.completed_at >= ?) ORDER BY r.status, r.due_at, r.id LIMIT 200`)
    .all(req.user.id, customerId, new Date(Date.now() - 30 * 86400000).toISOString())).map(view);
  const manager = req.user.role === 'manager';
  const sharedTeams = manager
    ? await db.prepare('SELECT id, name FROM teams ORDER BY name').all()
    : await db.prepare('SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ? ORDER BY t.name').all(req.user.id);
  const responsible = await db.prepare('SELECT responsible_team_id FROM managed_customer_configurations WHERE customer_id = ? AND managed_services_enabled = 1').get(customerId);
  const customerTeams = (await db.prepare('SELECT team_id FROM customer_teams WHERE customer_id = ? ORDER BY team_id').all(customerId)).map(row => Number(row.team_id));
  const allowed = new Set(sharedTeams.map(row => Number(row.id)));
  const defaultTeam = [responsible?.responsible_team_id, ...customerTeams].map(value => (value == null ? null : Number(value))).find(value => value && allowed.has(value)) || null;
  res.json({
    team: { active: team.filter(row => row.status === 'active'), done: team.filter(row => row.status === 'done').slice(0, 10) },
    own: { active: own.filter(row => row.status === 'active'), done: own.filter(row => row.status === 'done').slice(0, 10) },
    shared_teams: sharedTeams.map(row => ({ id: Number(row.id), name: row.name })),
    default_team_id: defaultTeam,
  });
});

router.get('/', async (req, res) => {
  const rows = (await db.prepare(`${SELECT} WHERE r.user_id = ? AND r.shared = 0 AND (r.status = 'active' OR r.completed_at >= ?) ORDER BY r.status, r.due_at, r.id LIMIT 500`)
    .all(req.user.id, new Date(Date.now() - 30 * 86400000).toISOString())).map(view);
  const settingsRow = await db.prepare('SELECT reminder_settings FROM users WHERE id = ?').get(req.user.id);
  const customers = (await linkableCustomers(req.user)).map(row => ({ id: Number(row.id), name: decrypt(row.name) })).sort((a, b) => a.name.localeCompare(b.name));
  const settings = automaticSettings(settingsRow?.reminder_settings, req.user.role);
  const manager = req.user.role === 'manager';
  const team = await teamReminderList(req.user);
  const ownTeams = manager ? [] : await db.prepare('SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ? ORDER BY t.name').all(req.user.id);
  const [people, teams, others] = manager ? await Promise.all([
    db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all(),
    db.prepare(`SELECT t.id, t.name, COUNT(u.id) AS members FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id LEFT JOIN users u ON u.id = tm.user_id AND u.active = 1
      GROUP BY t.id, t.name ORDER BY t.name`).all(),
    setForOthers(req.user.id),
  ]) : [[], [], []];
  res.json({
    now: new Date().toISOString(),
    active: rows.filter(row => row.status === 'active'),
    done: rows.filter(row => row.status === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 20),
    automatic: AUTOMATIC.filter(item => item.key in settings).map(({ key, label }) => ({ key, label, enabled: settings[key] })),
    customers,
    team_reminders: { active: team.filter(row => row.status === 'active'), done: team.filter(row => row.status === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 20) },
    shared_teams: (manager ? teams : ownTeams).map(row => ({ id: Number(row.id), name: row.name })),
    ...(manager ? { set_for_others: others, people: people.filter(row => Number(row.id) !== Number(req.user.id)).map(row => ({ id: Number(row.id), name: row.name })),
      teams: teams.map(row => ({ id: Number(row.id), name: row.name, members: Number(row.members) })) } : {}),
  });
});

router.post('/', async (req, res) => {
  try {
    if (req.body?.for?.shared === true) {
      const teamId = req.body.for.team_id;
      if (!positiveId(teamId) || !await db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) fail('Choose a team');
      if (req.user.role !== 'manager' && !await memberOf(req.user.id, teamId)) fail('You can only set shared reminders for your own teams', 403);
      const input = await reminderInput(req.body, req.user);
      const created = await db.prepare(`INSERT INTO reminders (user_id, title, notes, due_at, scheduled_at, time_zone, repeat, customer_id, created_by, team_id, shared)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(req.user.id, input.title, input.notes, input.dueAt, input.dueAt, input.timeZone, input.repeat, input.customerId, req.user.id, Number(teamId));
      return res.status(201).json((await teamReminderList(req.user)).find(row => row.id === Number(created.lastInsertRowid)));
    }
    if (req.body?.for !== undefined) {
      const { userIds, teamId } = await recipientsFor(req.body.for, req.user);
      const input = await reminderInput(req.body, req.user);
      const groupKey = crypto.randomUUID();
      await db.transaction(async tx => {
        for (const userId of userIds) {
          await tx.prepare(`INSERT INTO reminders (user_id, title, notes, due_at, scheduled_at, time_zone, repeat, customer_id, created_by, group_key, team_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, input.title, input.notes, input.dueAt, input.dueAt, input.timeZone, input.repeat, input.customerId, req.user.id, groupKey, teamId);
          if (userId !== Number(req.user.id)) await tx.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)')
            .run(userId, 'reminder_set', `${req.user.name} set a reminder for you: ${input.title}`, null, '/reminders');
        }
      });
      return res.status(201).json({ group_key: groupKey, recipients: userIds.length });
    }
    const count = await db.prepare("SELECT COUNT(*) AS total FROM reminders WHERE user_id = ? AND shared = 0 AND status = 'active'").get(req.user.id);
    if (Number(count.total) >= 500) fail('You have 500 active reminders; complete or delete some first');
    const input = await reminderInput(req.body, req.user);
    const created = await db.prepare('INSERT INTO reminders (user_id, title, notes, due_at, scheduled_at, time_zone, repeat, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, input.title, input.notes, input.dueAt, input.dueAt, input.timeZone, input.repeat, input.customerId);
    res.status(201).json(view(await one(created.lastInsertRowid, req.user.id)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});

// The automatic-reminder choices (before /:id so "settings" is not taken for an id).
router.put('/settings', async (req, res) => {
  const body = req.body || {};
  const row = await db.prepare('SELECT reminder_settings FROM users WHERE id = ?').get(req.user.id);
  const settings = automaticSettings(row?.reminder_settings, req.user.role);
  for (const [key, value] of Object.entries(body)) {
    if (!(key in settings)) return res.status(400).json({ error: `Unknown automatic reminder: ${key}` });
    if (typeof value !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
    settings[key] = value;
  }
  await db.prepare('UPDATE users SET reminder_settings = ? WHERE id = ?').run(JSON.stringify(settings), req.user.id);
  res.json({ automatic: AUTOMATIC.filter(item => item.key in settings).map(({ key, label }) => ({ key, label, enabled: settings[key] })) });
});

// Anyone in the team completes a shared reminder for everyone; a repeating one moves to its next time.
router.post('/team/:id/done', async (req, res) => {
  try {
    const reminder = await teamReminder(req);
    if (reminder.status !== 'active') fail('This reminder is already done', 409);
    if (reminder.repeat === 'none') {
      const done = await db.prepare("UPDATE reminders SET status = 'done', completed_at = ?, completed_by = ?, updated_at = app_now() WHERE id = ? AND status = 'active'").run(new Date().toISOString(), req.user.id, reminder.id);
      if (done.changes !== 1) fail('This reminder is already done', 409);
    } else {
      let next = nextOccurrence(reminder.scheduled_at || reminder.due_at, reminder.repeat, reminder.time_zone);
      const now = new Date().toISOString();
      for (let guard = 0; next <= now && guard < 1000; guard++) next = nextOccurrence(next, reminder.repeat, reminder.time_zone);
      await db.prepare('UPDATE reminders SET due_at = ?, scheduled_at = ?, notified_at = NULL, completed_at = ?, completed_by = ?, updated_at = app_now() WHERE id = ?')
        .run(next, next, now, req.user.id, reminder.id);
    }
    res.json((await teamReminderList(req.user)).find(row => row.id === Number(reminder.id)) || { id: Number(reminder.id), status: 'done' });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not complete the reminder' }); }
});
router.put('/team/:id', async (req, res) => {
  try {
    const reminder = await teamReminder(req, { change: true });
    const input = await reminderInput(req.body, req.user, reminder);
    const retimed = input.dueAt !== reminder.due_at;
    await db.prepare(`UPDATE reminders SET title = ?, notes = ?, due_at = ?, scheduled_at = ?, time_zone = ?, repeat = ?, customer_id = ?, updated_at = app_now()${retimed ? ", notified_at = NULL, status = 'active', completed_at = NULL, completed_by = NULL" : ''} WHERE id = ?`)
      .run(input.title, input.notes, input.dueAt, retimed ? input.dueAt : (reminder.scheduled_at || reminder.due_at), input.timeZone, input.repeat, input.customerId, reminder.id);
    res.json((await teamReminderList(req.user)).find(row => row.id === Number(reminder.id)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});
router.delete('/team/:id', async (req, res) => {
  try {
    const reminder = await teamReminder(req, { change: true });
    await db.prepare('DELETE FROM reminders WHERE id = ?').run(reminder.id);
    res.json({ ok: true });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not delete the reminder' }); }
});

// The manager who set a reminder for others changes or removes every copy at once.
async function ownGroup(req) {
  if (typeof req.params.key !== 'string' || !/^[0-9a-f-]{36}$/.test(req.params.key)) fail('Invalid reminder', 400);
  const copies = await db.prepare('SELECT * FROM reminders WHERE group_key = ? AND created_by = ? ORDER BY id').all(req.params.key, req.user.id);
  if (!copies.length) fail('Reminder not found', 404);
  return copies;
}
router.put('/group/:key', async (req, res) => {
  try {
    const copies = await ownGroup(req);
    const input = await reminderInput(req.body, req.user, copies[0]);
    // Every recipient starts again from the new details, as if newly set.
    await db.prepare(`UPDATE reminders SET title = ?, notes = ?, due_at = ?, scheduled_at = ?, time_zone = ?, repeat = ?, customer_id = ?, notified_at = NULL,
      status = 'active', completed_at = NULL, updated_at = app_now() WHERE group_key = ? AND created_by = ?`)
      .run(input.title, input.notes, input.dueAt, input.dueAt, input.timeZone, input.repeat, input.customerId, req.params.key, req.user.id);
    res.json({ ok: true, recipients: copies.length });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});
router.delete('/group/:key', async (req, res) => {
  try {
    await ownGroup(req);
    await db.prepare('DELETE FROM reminders WHERE group_key = ? AND created_by = ?').run(req.params.key, req.user.id);
    res.json({ ok: true });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not delete the reminder' }); }
});

router.put('/:id', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  try {
    const existing = await db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ? AND shared = 0').get(req.params.id, req.user.id);
    if (!existing) fail('Reminder not found', 404);
    if (setByOther(existing, req.user.id)) fail('This reminder was set for you by someone else; only they can change it', 403);
    const input = await reminderInput(req.body, req.user, existing);
    // A new time is a new occurrence, which should be delivered again.
    const retimed = input.dueAt !== existing.due_at;
    // Editing the time sets the schedule too (unlike a snooze).
    await db.prepare(`UPDATE reminders SET title = ?, notes = ?, due_at = ?, scheduled_at = ?, time_zone = ?, repeat = ?, customer_id = ?, updated_at = app_now()${retimed ? ', notified_at = NULL' : ''}
      ${existing.status === 'done' && retimed ? ", status = 'active', completed_at = NULL" : ''} WHERE id = ? AND user_id = ?`)
      .run(input.title, input.notes, input.dueAt, retimed ? input.dueAt : (existing.scheduled_at || existing.due_at), input.timeZone, input.repeat, input.customerId, existing.id, req.user.id);
    res.json(view(await one(existing.id, req.user.id)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});

// Done: a repeating reminder moves to its next future occurrence; a one-off is completed.
router.post('/:id/done', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const reminder = await db.prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ? AND shared = 0 AND status = 'active'").get(req.params.id, req.user.id);
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
  if (reminder.repeat === 'none') {
    await db.prepare("UPDATE reminders SET status = 'done', completed_at = ?, updated_at = app_now() WHERE id = ?").run(new Date().toISOString(), reminder.id);
  } else {
    // From the scheduled time, not a snoozed one, so the reminder keeps its usual time.
    let next = nextOccurrence(reminder.scheduled_at || reminder.due_at, reminder.repeat, reminder.time_zone);
    const now = new Date().toISOString();
    for (let guard = 0; next <= now && guard < 1000; guard++) next = nextOccurrence(next, reminder.repeat, reminder.time_zone);
    await db.prepare('UPDATE reminders SET due_at = ?, scheduled_at = ?, notified_at = NULL, updated_at = app_now() WHERE id = ?').run(next, next, reminder.id);
  }
  res.json(view(await one(reminder.id, req.user.id)));
});

// Snooze until a given time (the page offers an hour, this afternoon and tomorrow morning).
router.post('/:id/snooze', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const until = instant(req.body?.until);
  if (!until || until <= new Date().toISOString()) return res.status(400).json({ error: 'Snooze until a time in the future' });
  const updated = await db.prepare("UPDATE reminders SET due_at = ?, notified_at = NULL, updated_at = app_now() WHERE id = ? AND user_id = ? AND shared = 0 AND status = 'active'").run(until, req.params.id, req.user.id);
  if (updated.changes !== 1) return res.status(404).json({ error: 'Reminder not found' });
  res.json(view(await one(req.params.id, req.user.id)));
});

router.delete('/:id', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const mine = await db.prepare('SELECT created_by FROM reminders WHERE id = ? AND user_id = ? AND shared = 0').get(req.params.id, req.user.id);
  if (mine && setByOther(mine, req.user.id)) return res.status(403).json({ error: 'This reminder was set for you by someone else; only they can remove it' });
  const removed = await db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ? AND shared = 0').run(req.params.id, req.user.id);
  if (removed.changes !== 1) return res.status(404).json({ error: 'Reminder not found' });
  res.json({ ok: true });
});

module.exports = router;
