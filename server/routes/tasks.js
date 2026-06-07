const router  = require('express').Router();
const db      = require('../db');
const ExcelJS = require('exceljs');
const { requireAuth, requireManager, requireDownloadAuth } = require('../middleware/auth');
const { notify } = require('../notifications');

/* ── helper: log activity into a project ──────────────────── */
function logActivity(project_id, user_id, action, detail) {
  if (!project_id) return;
  try {
    db.prepare(`INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)`)
      .run(project_id, user_id, action, detail || null);
  } catch (_) { /* non-fatal */ }
}

router.get('/', requireAuth, (req, res) => {
  const { project_id, assigned_to, adhoc } = req.query;
  let q = `SELECT t.*, u.name as assigned_to_name, c.name as created_by_name,
    COALESCE((SELECT ROUND(SUM(hours),1) FROM time_logs WHERE task_id = t.id),0) as logged_hours
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    JOIN users c ON t.created_by = c.id WHERE 1=1`;
  const params = [];

  if (req.user.role === 'planner' || req.user.role === 'pm') {
    // Planners and PMs have no task visibility — return empty list
    return res.json([]);
  } else if (req.user.role === 'engineer') {
    q += ' AND t.assigned_to = ?'; params.push(req.user.id);
  } else {
    // manager — unrestricted
    if (assigned_to) { q += ' AND t.assigned_to = ?'; params.push(assigned_to); }
  }
  if (project_id) { q += ' AND t.project_id = ?'; params.push(project_id); }
  if (adhoc === '1') { q += ' AND t.is_adhoc = 1'; }
  q += ' ORDER BY t.created_at DESC';

  let rows = db.prepare(q).all(...params);

  // Augment with is_blocked (has unfinished dependencies)
  if (rows.length && project_id) {
    const ids = rows.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    const deps = db.prepare(`
      SELECT td.task_id, t.status as dep_status
      FROM task_dependencies td
      JOIN tasks t ON td.depends_on_id = t.id
      WHERE td.task_id IN (${placeholders})
    `).all(...ids);
    const depsMap = {};
    deps.forEach(d => {
      if (!depsMap[d.task_id]) depsMap[d.task_id] = [];
      depsMap[d.task_id].push(d.dep_status);
    });
    rows = rows.map(t => ({
      ...t,
      is_blocked: (depsMap[t.id] || []).some(s => s !== 'completed' && s !== 'closed' && s !== 'cancelled'),
      dep_count:  (depsMap[t.id] || []).length,
    }));
  }

  res.json(rows);
});

const VALID_TASK_STATUSES = new Set(['open','in_progress','waiting_customer','waiting_vendor','completed','pending_approval','cancelled','closed']);
const VALID_PRIORITIES    = new Set(['low','medium','high','critical']);

router.post('/', requireAuth, (req, res) => {
  if (req.user.role === 'pm' || req.user.role === 'planner') return res.status(403).json({ error: 'Forbidden' });
  const { project_id, title, description, priority, deadline, is_adhoc } = req.body;
  let { assigned_to } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (description && description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (req.user.role === 'engineer' && !project_id) return res.status(400).json({ error: 'Engineers must link a project' });

  // Engineers always self-assign regardless of what was passed
  if (req.user.role === 'engineer') {
    assigned_to = req.user.id;
  }

  const result = db.prepare(`INSERT INTO tasks (project_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project_id || null, title, description, priority || 'medium', deadline || null, assigned_to || null, req.user.id, is_adhoc ? 1 : 0);

  // Log activity
  const taskId = result.lastInsertRowid;
  logActivity(project_id, req.user.id, 'task_created', title);

  // Notify if engineer is assigned
  if (assigned_to) {
    const engineer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(assigned_to);
    const project  = project_id ? db.prepare('SELECT title FROM projects WHERE id = ?').get(project_id) : null;
    if (engineer) {
      notify('task.assigned', {
        engineer_id:    assigned_to,
        engineer_name:  engineer.name,
        engineer_email: engineer.email,
        task_title:     title,
        project_title:  project?.title || null,
        deadline:       deadline || null,
        priority:       priority || 'medium',
        is_adhoc:       !!is_adhoc,
      });
    }
  }

  res.json({ id: taskId });
});

router.put('/:id', requireAuth, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'engineer') {
    if (task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { status, pending_from_customer, title, description, priority, deadline } = req.body;
    if (status && !VALID_TASK_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status value' });
    if (priority && !VALID_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
    const newStatus = status || task.status;
    let newPfc = task.pending_from_customer;
    if (newStatus === 'waiting_customer' || newStatus === 'waiting_vendor') {
      newPfc = pending_from_customer !== undefined ? pending_from_customer : task.pending_from_customer;
    } else if (newStatus !== task.status) {
      newPfc = null;
    }
    db.prepare(`UPDATE tasks SET
      title=COALESCE(?,title), description=COALESCE(?,description),
      priority=COALESCE(?,priority), deadline=?,
      status=COALESCE(?,status), pending_from_customer=?,
      updated_at=datetime('now') WHERE id=?`)
      .run(
        title?.trim() || null,
        description !== undefined ? description : null,
        priority || null,
        deadline !== undefined ? (deadline || null) : task.deadline,
        status || null,
        newPfc,
        task.id
      );
    if (status && task.status !== status) {
      logActivity(task.project_id, req.user.id, 'task_status', `"${title || task.title}" → ${status}`);
    }
    return res.json({ ok: true });
  }

  // Planners and PMs cannot edit tasks
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });

  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { title, description, priority, deadline, assigned_to, status, is_adhoc, pending_from_customer } = req.body;

  // Validate enum fields for non-engineer callers
  if (status    && !VALID_TASK_STATUSES.has(status))    return res.status(400).json({ error: 'Invalid status value' });
  if (priority  && !VALID_PRIORITIES.has(priority))     return res.status(400).json({ error: 'Invalid priority value' });

  // Manage pending_from_customer
  let newPfc;
  if (status === 'waiting_customer' || status === 'waiting_vendor') {
    newPfc = pending_from_customer !== undefined ? pending_from_customer : task.pending_from_customer;
  } else if (status && status !== task.status) {
    newPfc = null;
  } else {
    newPfc = pending_from_customer !== undefined ? pending_from_customer : task.pending_from_customer;
  }

  db.prepare(`UPDATE tasks SET title=COALESCE(?,title), description=COALESCE(?,description),
    priority=COALESCE(?,priority), deadline=?, assigned_to=COALESCE(?,assigned_to),
    status=COALESCE(?,status), is_adhoc=COALESCE(?,is_adhoc),
    pending_from_customer=?, updated_at=datetime('now') WHERE id=?`)
    .run(title, description, priority, deadline ?? task.deadline, assigned_to, status,
         is_adhoc != null ? (is_adhoc ? 1 : 0) : null, newPfc, task.id);

  // Log status change
  if (status && status !== task.status) {
    logActivity(task.project_id, req.user.id, 'task_status', `"${title || task.title}" → ${status}`);
  }

  // Notify if engineer assignment changed
  if (assigned_to != null && assigned_to !== task.assigned_to && assigned_to) {
    const engineer = db.prepare('SELECT name, email FROM users WHERE id = ?').get(assigned_to);
    const project  = task.project_id ? db.prepare('SELECT title FROM projects WHERE id = ?').get(task.project_id) : null;
    if (engineer) {
      notify('task.assigned', {
        engineer_id:    assigned_to,
        engineer_name:  engineer.name,
        engineer_email: engineer.email,
        task_title:     title || task.title,
        project_title:  project?.title || null,
        deadline:       deadline ?? task.deadline,
        priority:       priority || task.priority,
        is_adhoc:       is_adhoc != null ? !!is_adhoc : !!task.is_adhoc,
      });
    }
  }

  res.json({ ok: true });
});

/* ── Bulk operations ──────────────────────────────────────── */
router.post('/bulk', requireAuth, (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const { ids, action, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No task IDs provided' });
  if (ids.length > 500) return res.status(400).json({ error: 'Maximum 500 IDs per bulk operation' });
  // Validate all IDs are positive integers
  if (!ids.every(id => Number.isInteger(id) && id > 0)) return res.status(400).json({ error: 'All IDs must be positive integers' });

  if (action === 'delete') {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    const del = db.prepare('DELETE FROM tasks WHERE id = ?');
    const run = db.transaction(() => ids.forEach(id => del.run(id)));
    run();
    return res.json({ ok: true, affected: ids.length });
  }

  if (action === 'status') {
    if (!status) return res.status(400).json({ error: 'Status required' });
    if (!VALID_TASK_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status value' });
    const upd = db.prepare(`UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=?`);
    // engineers can only update their own tasks
    const tasks = db.prepare(`SELECT id, assigned_to, project_id FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    let allowed_ids;
    if (req.user.role === 'manager') {
      allowed_ids = tasks.map(t => t.id);
    } else if (req.user.role === 'engineer') {
      allowed_ids = tasks.filter(t => t.assigned_to === req.user.id).map(t => t.id);
    } else {
      // planner/pm: tasks in their assigned projects or assigned to them
      const myProjects = new Set(
        db.prepare('SELECT project_id FROM project_assignments WHERE user_id = ?').all(req.user.id).map(r => r.project_id)
      );
      allowed_ids = tasks.filter(t => t.assigned_to === req.user.id || myProjects.has(t.project_id)).map(t => t.id);
    }
    const run = db.transaction(() => allowed_ids.forEach(id => upd.run(status, id)));
    run();
    return res.json({ ok: true, affected: allowed_ids.length });
  }

  res.status(400).json({ error: 'Unknown action' });
});

/* ── Export tasks to Excel ────────────────────────────────── */
router.get('/export', requireDownloadAuth, async (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const { filter } = req.query;
  let q = `SELECT t.title, t.status, t.priority, t.deadline, t.is_adhoc,
    u.name as assigned_to, c.name as created_by,
    p.title as project,
    COALESCE((SELECT ROUND(SUM(hours),1) FROM time_logs WHERE task_id = t.id),0) as logged_hours
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    JOIN users c ON t.created_by = c.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE 1=1`;
  const exportParams = [];
  if (req.user.role === 'engineer') {
    q += ' AND t.assigned_to = ?';
    exportParams.push(req.user.id);
  } else if (req.user.role === 'planner' || req.user.role === 'pm') {
    // Scope to projects this user is assigned to (mirrors the main GET / filter)
    q += ' AND (t.project_id IS NULL OR t.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = ?))';
    exportParams.push(req.user.id);
  }
  if (filter === 'open')  q += ` AND t.status IN ('open','in_progress','waiting_customer','waiting_vendor')`;
  if (filter === 'done')  q += ` AND t.status IN ('completed','closed')`;
  if (filter === 'adhoc') q += ` AND t.is_adhoc = 1`;
  q += ' ORDER BY t.created_at DESC';

  const rows = db.prepare(q).all(...exportParams);
  const wsData = [
    ['Title','Status','Priority','Deadline','Project','Assigned To','Created By','Hours Logged','Ad-hoc'],
    ...rows.map(r => [r.title, r.status, r.priority, r.deadline || '', r.project || '', r.assigned_to || '', r.created_by, r.logged_hours, r.is_adhoc ? 'Yes' : 'No']),
  ];

  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Tasks');
  wsData.forEach(row => worksheet.addRow(row));
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="tasks.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

/* ── Duplicate a task ─────────────────────────────────────── */
router.post('/:id/duplicate', requireAuth, (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  // Engineers: can only duplicate tasks assigned to them
  if (req.user.role === 'engineer') {
    if (task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const result = db.prepare(`
    INSERT INTO tasks (project_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.project_id, task.title + ' (copy)', task.description, task.priority, task.deadline,
         task.assigned_to, req.user.id, task.is_adhoc);
  logActivity(task.project_id, req.user.id, 'task_created', task.title + ' (copy)');
  res.json({ id: result.lastInsertRowid });
});

/* ── Overdue counts (lightweight — used by sidebar badges) ── */
router.get('/overdue-counts', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let taskCount = 0;
  if (req.user.role === 'engineer') {
    taskCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE assigned_to = ? AND deadline < ? AND status NOT IN ('completed','closed','cancelled')
    `).get(req.user.id, today).cnt;
  } else if (req.user.role === 'manager') {
    taskCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE deadline < ? AND status NOT IN ('completed','closed','cancelled')
    `).get(today).cnt;
  }
  // planners and PMs have no task visibility — taskCount stays 0

  const visitCount = req.user.role === 'engineer'
    ? db.prepare(`SELECT COUNT(*) AS cnt FROM maintenance_visits mv
        JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
        WHERE mve.user_id = ? AND mv.scheduled_date < ? AND mv.status = 'scheduled'
      `).get(req.user.id, today).cnt
    : db.prepare(`SELECT COUNT(*) AS cnt FROM maintenance_visits
        WHERE scheduled_date < ? AND status = 'scheduled'
      `).get(today).cnt;

  res.json({ tasks: taskCount, visits: visitCount });
});

router.delete('/:id', requireManager, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (task) logActivity(task.project_id, req.user.id, 'task_deleted', task.title);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ── Task Comments ────────────────────────────────────────── */
router.get('/:id/comments', requireAuth, (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  // Engineers can only access their own tasks
  if (req.user.role === 'engineer' && task.assigned_to !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare(`
    SELECT tc.*, u.name as user_name, u.role as user_role
    FROM task_comments tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.task_id = ?
    ORDER BY tc.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/:id/comments', requireAuth, (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && task.assigned_to !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const result = db.prepare(`INSERT INTO task_comments (task_id, user_id, message) VALUES (?, ?, ?)`)
    .run(req.params.id, req.user.id, message.trim());
  logActivity(task.project_id, req.user.id, 'task_comment', `"${task.title}"`);

  // Detect @mentions and notify each unique mentioned user
  const allUsers = db.prepare('SELECT id, name FROM users WHERE active = 1').all();
  const lower = message.toLowerCase();
  const notified = new Set();
  allUsers.forEach(u => {
    if (u.id === req.user.id) return; // don't self-notify
    const firstName = u.name.split(' ')[0].toLowerCase();
    const fullName  = u.name.toLowerCase().replace(/\s+/g, '');
    if (lower.includes('@' + firstName) || lower.includes('@' + fullName)) {
      if (!notified.has(u.id)) {
        notified.add(u.id);
        try {
          db.prepare(`INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`)
            .run(u.id, 'mention', `${req.user.name} mentioned you`, `In task "${task.title}": ${message.trim().slice(0, 80)}`,
              task.project_id ? `/projects/${task.project_id}` : null);
        } catch (_) {}
      }
    }
  });

  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id/comments/:cid', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(req.params.cid, req.params.id);
  if (!comment) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'manager') {
    // managers can delete any comment
  } else if (comment.user_id !== req.user.id) {
    // everyone else can only delete their own comments
    return res.status(403).json({ error: 'Forbidden' });
  }
  db.prepare('DELETE FROM task_comments WHERE id = ?').run(req.params.cid);
  res.json({ ok: true });
});

/* ── Task Dependencies ────────────────────────────────────── */
// GET tasks this task depends on
router.get('/:id/dependencies', requireAuth, (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  // Verify the caller has visibility of the parent task before exposing its deps
  const task = db.prepare('SELECT assigned_to, project_id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer') {
    if (task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.deadline
    FROM task_dependencies td
    JOIN tasks t ON td.depends_on_id = t.id
    WHERE td.task_id = ?
    ORDER BY t.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

// BFS reachability: returns true if startId can reach targetId via existing dependencies
function canReach(startId, targetId) {
  const visited = new Set();
  const queue = [Number(startId)];
  const depStmt = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?');
  while (queue.length) {
    const current = queue.shift();
    if (current === Number(targetId)) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    depStmt.all(current).forEach(d => queue.push(d.depends_on_id));
  }
  return false;
}

// Add a dependency
router.post('/:id/dependencies', requireManager, (req, res) => {
  const { depends_on_id } = req.body;
  if (!depends_on_id) return res.status(400).json({ error: 'depends_on_id required' });
  if (Number(depends_on_id) === Number(req.params.id))
    return res.status(400).json({ error: 'A task cannot depend on itself' });
  // Full transitive cycle check: would depends_on_id eventually reach this task?
  if (canReach(depends_on_id, req.params.id))
    return res.status(400).json({ error: 'Circular dependency detected' });
  try {
    db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)').run(req.params.id, depends_on_id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Remove a dependency
router.delete('/:id/dependencies/:depId', requireManager, (req, res) => {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').run(req.params.id, req.params.depId);
  res.json({ ok: true });
});

module.exports = router;
