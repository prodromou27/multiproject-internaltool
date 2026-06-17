const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

// GET /api/time-logs?task_id=X  or  ?visit_id=X
router.get('/', requireAuth, async (req, res) => {
  const { task_id, visit_id } = req.query;
  if (!task_id && !visit_id)
    return res.status(400).json({ error: 'task_id or visit_id required' });

  // ── Access control: verify the caller can see the target task / visit ────
  if (task_id) {
    const task = (await db.prepare('SELECT assigned_to, project_id FROM tasks WHERE id = ?').get(task_id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'engineer') {
      if (task.assigned_to !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });
    } else if ((req.user.role === 'planner' || req.user.role === 'pm') && task.project_id) {
      const a = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(task.project_id, req.user.id));
      if (!a) return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (visit_id) {
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
  if (!hours || isNaN(hours) || Number(hours) <= 0)
    return res.status(400).json({ error: 'hours must be a positive number' });
  if (Number(hours) > 24)
    return res.status(400).json({ error: 'Hours per entry cannot exceed 24' });
  if (!task_id && !visit_id)
    return res.status(400).json({ error: 'task_id or visit_id required' });

  // Engineers can only log time to their own tasks/visits
  if (req.user.role === 'engineer') {
    if (task_id) {
      const task = (await db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(task_id));
      if (!task || task.assigned_to !== req.user.id)
        return res.status(403).json({ error: 'You can only log time to your own tasks' });
    }
    if (visit_id) {
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

// DELETE /api/time-logs/:id
router.delete('/:id', requireAuth, async (req, res) => {
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
  const uid = (req.user.role === 'engineer') ? req.user.id : (user_id ? Number(user_id) : null);
  let q = 'SELECT COALESCE(SUM(hours),0) as total, COUNT(*) as entries FROM time_logs WHERE 1=1';
  const params = [];
  if (uid) { q += ' AND user_id = ?'; params.push(uid); }
  if (month) { q += " AND strftime('%Y-%m', logged_at) = ?"; params.push(month); }
  res.json((await db.prepare(q).get(...params)));
});

module.exports = router;
