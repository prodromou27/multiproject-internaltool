const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { worksOnTask } = require('../taskAccess');
const { hasPermission } = require('../permissions');
const appTime = require('../appTime');
const { decrypt } = require('../fieldCipher');

// A log belongs to a task (tasks.access) or a visit (visits.access); revoking the
// module also closes its time logs. General time (neither) needs no module.
const moduleOf = target => (target.task_id ? 'tasks.access' : target.visit_id ? 'visits.access' : null);
const CATEGORIES = { meeting: 'Meeting', admin: 'Admin', internal: 'Internal work', training: 'Training', other: 'Other' };
async function moduleDenied(req, res, target) {
  const module = moduleOf(target);
  if (!module || await hasPermission(req.user, module)) return false;
  res.status(403).json({ error: 'You do not have permission to access this module' });
  return true;
}

function validId(value) {
  return (typeof value === 'number' || typeof value === 'string')
    && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function targetError(task_id, visit_id) {
  if ((!task_id && !visit_id) || (task_id && visit_id)) return 'Provide exactly one of task_id or visit_id';
  if (!validId(task_id || visit_id)) return 'Task or visit ID must be a positive integer';
  return null;
}

// GET /api/time-logs?task_id=X  or  ?visit_id=X
router.get('/', requireAuth, async (req, res) => {
  const { task_id, visit_id } = req.query;
  const error = targetError(task_id, visit_id);
  if (!error && await moduleDenied(req, res, { task_id, visit_id })) return;
  if (error) return res.status(400).json({ error });
  if (task_id && req.user.role !== 'manager' && req.user.role !== 'engineer')
    return res.status(403).json({ error: 'Forbidden' });

  // ── Access control: verify the caller can see the target task / visit ────
  if (task_id) {
    const task = (await db.prepare('SELECT assigned_to, team_id, project_id FROM tasks WHERE id = ?').get(task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'engineer') {
      if (!await worksOnTask(req.user, task))
        return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (visit_id) {
    const visit = (await db.prepare('SELECT id FROM maintenance_visits WHERE id = ?').get(visit_id));
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (req.user.role === 'engineer') {
      const a = (await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id = ?').get(visit_id, req.user.id));
      if (!a) return res.status(403).json({ error: 'Forbidden' });
    }
    // Planners/PMs can see all visit logs (they manage maintenance)
  }

  let q = `SELECT tl.*, u.name as user_name
           FROM time_logs tl
           JOIN users u ON tl.user_id = u.id
           WHERE `;
  const params = [];

  if (task_id)  { q += 'tl.task_id = ?';  params.push(task_id);  }
  if (visit_id) { q += 'tl.visit_id = ?'; params.push(visit_id); }
  q += ' ORDER BY COALESCE(tl.work_date, substr(tl.logged_at, 1, 10)) DESC, tl.logged_at DESC';

  res.json((await db.prepare(q).all(...params)));
});

// POST /api/time-logs
router.post('/', requireAuth, async (req, res) => {
  const { task_id, visit_id, hours, description } = req.body;
  // The day the work was done: today unless given; not in the future, at most a year back.
  const today = appTime.today();
  const workDate = req.body.work_date === undefined || req.body.work_date === null ? today : req.body.work_date;
  if (!validDate(workDate) || workDate > today || workDate < appTime.addDays(today, -366))
    return res.status(400).json({ error: 'The work date must be a date within the last year, not in the future' });
  // General time: no task or visit, a category, and optionally a customer you work with.
  const general = !task_id && !visit_id;
  let category = null, customerId = null;
  if (general) {
    if (!['manager', 'engineer'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (!Object.hasOwn(CATEGORIES, req.body.category)) return res.status(400).json({ error: `Choose what the time was: ${Object.values(CATEGORIES).join(', ')}` });
    category = req.body.category;
    if (req.body.customer_id != null) {
      if (!validId(req.body.customer_id)) return res.status(400).json({ error: 'Invalid customer' });
      if (!await require('../customerAccess').canAccessCustomer(req.user, Number(req.body.customer_id))) return res.status(404).json({ error: 'Customer not found' });
      customerId = Number(req.body.customer_id);
    }
  } else {
    const error = targetError(task_id, visit_id);
    if (!error && await moduleDenied(req, res, { task_id, visit_id })) return;
    if (error) return res.status(400).json({ error });
  }
  if (task_id && req.user.role !== 'manager' && req.user.role !== 'engineer')
    return res.status(403).json({ error: 'Forbidden' });
  if (!['number', 'string'].includes(typeof hours) || !Number.isFinite(Number(hours)))
    return res.status(400).json({ error: 'hours must be a positive finite number' });
  if (description != null && typeof description !== 'string')
    return res.status(400).json({ error: 'Description must be text' });
  if (!hours || isNaN(hours) || Number(hours) <= 0)
    return res.status(400).json({ error: 'hours must be a positive number' });
  if (Number(hours) > 24)
    return res.status(400).json({ error: 'Hours per entry cannot exceed 24' });
  if (description && description.length > 2000)
    return res.status(400).json({ error: 'Description cannot exceed 2000 characters' });

  if (task_id) {
    const task = (await db.prepare('SELECT assigned_to, team_id, project_id FROM tasks WHERE id = ?').get(task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'engineer' && !await worksOnTask(req.user, task))
      return res.status(403).json({ error: 'You can only log time to your own tasks' });
  }

  if (visit_id) {
    const visit = (await db.prepare('SELECT id FROM maintenance_visits WHERE id = ?').get(visit_id));
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (req.user.role === 'engineer') {
      const assigned = (await db.prepare(
        'SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id = ?'
      ).get(visit_id, req.user.id));
      if (!assigned) return res.status(403).json({ error: 'You can only log time to your own visits' });
    }
  }

  const result = (await db.prepare(
    'INSERT INTO time_logs (user_id, task_id, visit_id, hours, description, work_date, category, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, task_id || null, visit_id || null, Number(hours), description?.trim() || null, workDate, category, customerId));

  res.json({ id: result.lastInsertRowid });
});

// GET /api/time-logs/mine?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/mine', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to))
    return res.status(400).json({ error: 'from and to must use YYYY-MM-DD format' });
  if (from > to) return res.status(400).json({ error: 'from must be before or equal to to' });
  const rows = await db.prepare(`
    SELECT tl.*, COALESCE(tl.work_date, substr(tl.logged_at, 1, 10)) AS work_date, t.title AS task_title, t.ticket_reference, mv.title AS visit_title,
      p.title AS project_title, c.name AS customer_name
    FROM time_logs tl
    LEFT JOIN tasks t ON tl.task_id = t.id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN maintenance_visits mv ON tl.visit_id = mv.id
    LEFT JOIN customers c ON c.id = COALESCE(t.customer_id, p.customer_id, mv.customer_id, tl.customer_id)
    WHERE tl.user_id = ? AND COALESCE(tl.work_date, substr(tl.logged_at, 1, 10)) BETWEEN ? AND ?
    ORDER BY COALESCE(tl.work_date, substr(tl.logged_at, 1, 10)) DESC, tl.logged_at DESC
  `).all(req.user.id, from, to);
  const [tasks, visits] = await Promise.all([hasPermission(req.user, 'tasks.access'), hasPermission(req.user, 'visits.access')]);
  res.json(rows.filter(row => (row.task_id ? tasks : row.visit_id ? visits : true))
    .map(row => ({ ...row, customer_name: decrypt(row.customer_name) || null, category_label: row.category ? CATEGORIES[row.category] || row.category : null })));
});

// The kinds of general time (for the form).
router.get('/categories', requireAuth, (req, res) => {
  res.json(Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })));
});

// DELETE /api/time-logs/:id
router.delete('/:id', requireAuth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid time log ID' });
  const log = (await db.prepare('SELECT * FROM time_logs WHERE id = ?').get(req.params.id));
  if (!log) return res.status(404).json({ error: 'Not found' });
  if (await moduleDenied(req, res, log)) return;
  // Only managers can delete other people's logs; everyone else must own the log
  if (req.user.role !== 'manager' && log.user_id !== req.user.id)
    return res.status(403).json({ error: "Cannot delete another user's time log" });
  (await db.prepare('DELETE FROM time_logs WHERE id = ?').run(req.params.id));
  res.json({ ok: true });
});

// GET /api/time-logs/summary?user_id=X&month=YYYY-MM
router.get('/summary', requireAuth, async (req, res) => {
  const { user_id, month } = req.query;
  if (month && !validDate(`${month}-01`))
    return res.status(400).json({ error: 'month must use YYYY-MM format' });
  if (user_id && !validId(user_id)) return res.status(400).json({ error: 'Invalid user ID' });
  const uid = req.user.role !== 'manager' ? req.user.id : (user_id ? Number(user_id) : null);
  let q = 'SELECT COALESCE(SUM(hours),0) as total, COUNT(*) as entries FROM time_logs WHERE 1=1';
  const params = [];
  if (uid) { q += ' AND user_id = ?'; params.push(uid); }
  if (month) { q += " AND substr(logged_at,1,7) = ?"; params.push(month); }
  if (!await hasPermission(req.user, 'tasks.access')) q += ' AND task_id IS NULL';
  if (!await hasPermission(req.user, 'visits.access')) q += ' AND visit_id IS NULL';
  res.json((await db.prepare(q).get(...params)));
});

module.exports = router;
