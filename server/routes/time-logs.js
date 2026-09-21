const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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
  if (error) return res.status(400).json({ error });
  if (task_id && req.user.role !== 'manager' && req.user.role !== 'engineer')
    return res.status(403).json({ error: 'Forbidden' });

  // ── Access control: verify the caller can see the target task / visit ────
  if (task_id) {
    const task = (await db.prepare('SELECT assigned_to, project_id FROM tasks WHERE id = ?').get(task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'engineer') {
      if (task.assigned_to !== req.user.id)
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
  q += ' ORDER BY tl.logged_at DESC';

  res.json((await db.prepare(q).all(...params)));
});

// POST /api/time-logs
router.post('/', requireAuth, async (req, res) => {
  const { task_id, visit_id, hours, description } = req.body;
  const error = targetError(task_id, visit_id);
  if (error) return res.status(400).json({ error });
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
    const task = (await db.prepare('SELECT assigned_to, project_id FROM tasks WHERE id = ?').get(task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'engineer' && task.assigned_to !== req.user.id)
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
    'INSERT INTO time_logs (user_id, task_id, visit_id, hours, description) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, task_id || null, visit_id || null, Number(hours), description?.trim() || null));

  res.json({ id: result.lastInsertRowid });
});

// GET /api/time-logs/mine?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/mine', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to))
    return res.status(400).json({ error: 'from and to must use YYYY-MM-DD format' });
  if (from > to) return res.status(400).json({ error: 'from must be before or equal to to' });
  const rows = await db.prepare(`
    SELECT tl.*, t.title AS task_title, mv.title AS visit_title
    FROM time_logs tl
    LEFT JOIN tasks t ON tl.task_id = t.id
    LEFT JOIN maintenance_visits mv ON tl.visit_id = mv.id
    WHERE tl.user_id = ? AND substr(tl.logged_at, 1, 10) BETWEEN ? AND ?
    ORDER BY tl.logged_at DESC
  `).all(req.user.id, from, to);
  res.json(rows);
});

// DELETE /api/time-logs/:id
router.delete('/:id', requireAuth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid time log ID' });
  const log = (await db.prepare('SELECT * FROM time_logs WHERE id = ?').get(req.params.id));
  if (!log) return res.status(404).json({ error: 'Not found' });
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
  res.json((await db.prepare(q).get(...params)));
});

module.exports = router;
