const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireManager } = require('../middleware/auth');

// All admin routes require manager role
router.use(requireManager);

// Number of active managers OTHER than the given user. Used to prevent the
// system from being left with zero administrators (demote/deactivate/delete
// of the final manager would lock everyone out of admin functions).
async function otherActiveManagerCount(excludeUserId) {
  return (await db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'manager' AND active = 1 AND id != ?"
  ).get(excludeUserId)).c;
}

/* ─── Users ─────────────────────────────────────────────── */

router.get('/users', async (req, res) => {
  const users = (await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, u.last_login,
      u.totp_enabled, u.must_change_password,
      (SELECT COUNT(*) FROM project_assignments WHERE user_id = u.id) as project_count,
      (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND status NOT IN ('completed','cancelled','closed')) as open_tasks,
      (SELECT COUNT(*) FROM maintenance_visit_engineers mve JOIN maintenance_visits mv ON mv.id = mve.visit_id WHERE mve.user_id = u.id AND mv.status != 'cancelled') as mv_count
    FROM users u ORDER BY u.role DESC, u.name ASC
  `).all());
  res.json(users);
});

router.post('/users', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !password || !role)
    return res.status(400).json({ error: 'name, password and role are required' });
  if (name.trim().length < 2 || name.trim().length > 100)
    return res.status(400).json({ error: 'Name must be between 2 and 100 characters' });
  if (!['manager', 'engineer', 'planner', 'pm'].includes(role))
    return res.status(400).json({ error: 'role must be manager, engineer, planner or pm' });
  const emailVal = email ? email.trim().toLowerCase() : null;
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal))
    return res.status(400).json({ error: 'Invalid email format' });
  if (password.length < 12)
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  try {
    const hash = bcrypt.hashSync(password, 12);
    const result = (await db.prepare(
      "INSERT INTO users (name, email, password, role, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, 1, datetime('now'))"
    ).run(name.trim(), emailVal, hash, role));
    res.json({ id: result.lastInsertRowid, name, email: emailVal, role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    console.error('[admin/users POST]', e.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', async (req, res) => {
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, email, role } = req.body;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Invalid email format' });
  if (role && !['manager', 'engineer', 'planner', 'pm'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  // Block demoting the last active manager (incl. self) out of the manager role.
  if (role && role !== 'manager' && user.role === 'manager' && user.active && (await otherActiveManagerCount(user.id)) === 0)
    return res.status(400).json({ error: 'Cannot change the role of the last active manager' });
  try {
    (await db.prepare(`UPDATE users SET
      name  = COALESCE(?, name),
      email = COALESCE(?, email),
      role  = COALESCE(?, role)
      WHERE id = ?`
    ).run(name?.trim() || null, email ? email.trim().toLowerCase() : null, role || null, user.id));
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    console.error('[admin/users PUT]', e.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 12)
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  const hash = bcrypt.hashSync(password, 12);
  // Force the user to choose a new password on their next login
  (await db.prepare("UPDATE users SET password = ?, must_change_password = 1, password_changed_at = datetime('now') WHERE id = ?").run(hash, req.params.id));
  res.json({ ok: true });
});

router.post('/users/:id/toggle-active', async (req, res) => {
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  // Prevent deactivating yourself
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate yourself' });
  // Prevent deactivating the last remaining active manager
  if (user.active && user.role === 'manager' && (await otherActiveManagerCount(user.id)) === 0)
    return res.status(400).json({ error: 'Cannot deactivate the last active manager' });
  (await db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, user.id));
  res.json({ active: !user.active });
});

router.delete('/users/:id', async (req, res) => {
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  // Prevent deleting the last remaining active manager
  if (user.role === 'manager' && user.active && (await otherActiveManagerCount(user.id)) === 0)
    return res.status(400).json({ error: 'Cannot delete the last active manager' });
  try {
    (await db.prepare('DELETE FROM users WHERE id = ?').run(user.id));
    res.json({ ok: true });
  } catch (e) {
    // created_by / authored references (projects, tasks, comments, activity) are
    // NOT NULL with no cascade, so deleting a user who has authored records hits
    // a foreign-key constraint. Surface an actionable message instead of a 500.
    if (e.code && e.code.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({
        error: 'This user has created projects, tasks or other records and cannot be deleted. Deactivate the account instead to preserve history.',
      });
    }
    console.error('[admin/users DELETE]', e.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.post('/users/:id/toggle-2fa-exempt', async (req, res) => {
  const user = (await db.prepare('SELECT id, totp_exempt FROM users WHERE id = ?').get(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newVal = user.totp_exempt ? 0 : 1;
  (await db.prepare('UPDATE users SET totp_exempt = ? WHERE id = ?').run(newVal, user.id));
  res.json({ totp_exempt: !!newVal });
});

/* ─── System Stats ───────────────────────────────────────── */

router.get('/stats', async (req, res) => {
  // Consolidate all counts into a single SQL query (was 13 separate queries)
  const s = (await db.prepare(`SELECT
    (SELECT COUNT(*) FROM users)                                                              AS users_total,
    (SELECT COUNT(*) FROM users WHERE active = 1)                                             AS users_active,
    (SELECT COUNT(*) FROM users WHERE role = 'manager')                                       AS users_managers,
    (SELECT COUNT(*) FROM users WHERE role = 'engineer')                                      AS users_engineers,
    (SELECT COUNT(*) FROM users WHERE role = 'planner')                                       AS users_planners,
    (SELECT COUNT(*) FROM users WHERE role = 'pm')                                            AS users_pms,
    (SELECT COUNT(*) FROM projects)                                                           AS proj_total,
    (SELECT COUNT(*) FROM projects WHERE status NOT IN ('closed','cancelled'))                AS proj_active,
    (SELECT COUNT(*) FROM projects WHERE status = 'closed')                                   AS proj_closed,
    (SELECT COUNT(*) FROM projects WHERE status = 'pending_approval')                         AS proj_pending,
    (SELECT COUNT(*) FROM projects WHERE deadline < date('now') AND status NOT IN ('closed','cancelled')) AS proj_overdue,
    (SELECT COUNT(*) FROM tasks WHERE status != 'cancelled')                                  AS tasks_total,
    (SELECT COUNT(*) FROM tasks WHERE status IN ('open','in_progress','waiting_customer','waiting_vendor')) AS tasks_open,
    (SELECT COUNT(*) FROM tasks WHERE status IN ('completed','closed'))                       AS tasks_done,
    (SELECT COUNT(*) FROM tasks WHERE is_adhoc = 1 AND status != 'cancelled')                 AS tasks_adhoc,
    (SELECT COUNT(*) FROM maintenance_visits WHERE status != 'cancelled')                     AS mv_total,
    (SELECT COUNT(*) FROM maintenance_visits WHERE report_sent = 0 AND status != 'cancelled') AS mv_pending,
    (SELECT COUNT(*) FROM maintenance_visits WHERE report_sent = 1)                           AS mv_sent,
    (SELECT COUNT(*) FROM customers)                                                          AS customers,
    (SELECT COUNT(*) FROM attachments)                                                        AS att_count,
    (SELECT COALESCE(SUM(size), 0) FROM attachments)                                          AS att_size
  `).get());

  res.json({
    users:       { total: s.users_total, active: s.users_active, managers: s.users_managers, engineers: s.users_engineers, planners: s.users_planners, pms: s.users_pms },
    projects:    { total: s.proj_total, active: s.proj_active, closed: s.proj_closed, pending_closure: s.proj_pending, overdue: s.proj_overdue },
    tasks:       { total: s.tasks_total, open: s.tasks_open, done: s.tasks_done, adhoc: s.tasks_adhoc },
    maintenance: { total: s.mv_total, report_pending: s.mv_pending, report_sent: s.mv_sent },
    customers:   s.customers,
    attachments: { count: s.att_count, total_size: s.att_size },
  });
});

/* ─── Activity Feed ──────────────────────────────────────── */

router.get('/activity', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  // Status updates
  const updates = (await db.prepare(`SELECT 'status_update' as type, s.created_at, u.name as actor,
    'Posted update on project "' || p.title || '": ' || s.message as description
    FROM project_status_updates s JOIN users u ON s.user_id = u.id JOIN projects p ON s.project_id = p.id
    ORDER BY s.created_at DESC LIMIT ?`).all(limit));

  // Task completions
  const taskDone = (await db.prepare(`SELECT 'task_done' as type, t.updated_at as created_at, COALESCE(u.name, 'Unassigned') as actor,
    'Marked task "' || t.title || '" as completed' || COALESCE(' on project "' || p.title || '"', '') as description
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status IN ('completed','closed') ORDER BY t.updated_at DESC LIMIT ?`).all(limit));

  // Project closures
  const closures = (await db.prepare(`SELECT 'project_closed' as type, p.closed_at as created_at, u.name as actor,
    'Closed project "' || p.title || '"' as description
    FROM projects p JOIN users u ON p.closed_by = u.id
    WHERE p.status = 'closed' ORDER BY p.closed_at DESC LIMIT ?`).all(limit));

  // MV report sent
  const mvReports = (await db.prepare(`SELECT 'mv_report' as type, mv.report_sent_at as created_at, u.name as actor,
    'Marked MV report sent for "' || c.name || '" — ' || mv.title as description
    FROM maintenance_visits mv JOIN users u ON mv.report_sent_by = u.id JOIN customers c ON mv.customer_id = c.id
    WHERE mv.report_sent = 1 ORDER BY mv.report_sent_at DESC LIMIT ?`).all(limit));

  // New projects
  const newProjects = (await db.prepare(`SELECT 'new_project' as type, p.created_at, u.name as actor,
    'Created project "' || p.title || '"' as description
    FROM projects p JOIN users u ON p.created_by = u.id ORDER BY p.created_at DESC LIMIT ?`).all(limit));

  // New users
  const newUsers = (await db.prepare(`SELECT 'new_user' as type, u.created_at, 'System' as actor,
    'New user registered: ' || u.name || ' (' || u.role || ')' as description
    FROM users u ORDER BY u.created_at DESC LIMIT ?`).all(limit));

  const all = [...updates, ...taskDone, ...closures, ...mvReports, ...newProjects, ...newUsers]
    .filter(r => r.created_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);

  res.json(all);
});

module.exports = router;
