const router  = require('express').Router();
const db      = require('../db');
const ExcelJS = require('exceljs');
const { taskFilters, taskPagination } = require('../taskFilters');
const { requireAuth, requireManager, requireDownloadAuth } = require('../middleware/auth');
const { notify } = require('../notifications');

/* ── helper: log activity into a project ──────────────────── */
async function logActivity(project_id, user_id, action, detail) {
  if (!project_id) return;
  try {
    (await db.prepare(`INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)`)
      .run(project_id, user_id, action, detail || null));
  } catch (_) { /* non-fatal */ }
}

async function attachTaskHours(rows) {
  if (!rows.length) return rows;
  const totals = await db.prepare(`SELECT task_id,SUM(hours) AS hours FROM time_logs
    WHERE task_id IN (${rows.map(() => '?').join(',')}) GROUP BY task_id`).all(...rows.map(row => row.id));
  const hours = new Map(totals.map(row => [row.task_id, Math.round(Number(row.hours) * 10) / 10]));
  return rows.map(row => ({ ...row, logged_hours: hours.get(row.id) || 0 }));
}

router.get('/', requireAuth, async (req, res) => {
  const filters = taskFilters(req.query, req.user);
  if (filters.error) return res.status(400).json({ error: filters.error });
  const pagination = taskPagination(req.query);
  if (pagination?.error) return res.status(400).json({ error: pagination.error });
  if (!['manager', 'engineer'].includes(req.user.role)) return res.json(pagination ? { rows: [], total: 0, counts: {}, page: pagination.page, page_size: pagination.page_size } : []);
  let q = `SELECT t.*, u.name as assigned_to_name, c.name as created_by_name, p.title as project_title FROM tasks t
    LEFT JOIN users u ON t.assigned_to=u.id JOIN users c ON t.created_by=c.id
    LEFT JOIN projects p ON p.id=t.project_id
    WHERE ${filters.where} ORDER BY ${filters.order}`;
  const params = [...filters.params];
  let counts;
  if (pagination) {
    const base = taskFilters({ ...req.query, filter: 'all' }, req.user);
    const asOf = filters.as_of;
    const end = new Date(`${asOf}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const raw = await db.prepare(`SELECT COUNT(*) AS "all",
      SUM(CASE WHEN t.status IN ('open','in_progress','waiting_customer','waiting_vendor') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN t.status IN ('completed','closed') THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN t.is_adhoc=1 THEN 1 ELSE 0 END) AS adhoc,
      SUM(CASE WHEN t.status IN ('waiting_customer','waiting_vendor') THEN 1 ELSE 0 END) AS waiting_customer,
      SUM(CASE WHEN t.status='pending_approval' THEN 1 ELSE 0 END) AS pending_approval,
      SUM(CASE WHEN t.status NOT IN ('completed','closed','cancelled') AND t.deadline<? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN t.status NOT IN ('completed','closed','cancelled') AND t.deadline=? THEN 1 ELSE 0 END) AS due_today,
      SUM(CASE WHEN t.status NOT IN ('completed','closed','cancelled') AND t.deadline BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_week
      FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN projects p ON p.id=t.project_id
      WHERE ${base.where}`).get(asOf, asOf, asOf, end.toISOString().slice(0, 10), ...base.params);
    counts = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value || 0)]));
    q += ' LIMIT ? OFFSET ?';
    params.push(pagination.page_size, pagination.offset);
  }

  let rows = await attachTaskHours(await db.prepare(q).all(...params));

  // Augment with is_blocked (has unfinished dependencies)
  if (rows.length) {
    const ids = rows.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    const deps = (await db.prepare(`
      SELECT td.task_id, t.status as dep_status
      FROM task_dependencies td
      JOIN tasks t ON td.depends_on_id = t.id
      WHERE td.task_id IN (${placeholders})
    `).all(...ids));
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

  res.json(pagination ? { rows, total: counts[req.query.filter || 'all'], counts, page: pagination.page, page_size: pagination.page_size } : rows);
});

const VALID_TASK_STATUSES = new Set(['open','in_progress','waiting_customer','waiting_vendor','completed','pending_approval','cancelled','closed']);
const VALID_PRIORITIES    = new Set(['low','medium','high','critical']);

function validateTaskInput(body, creating = false) {
  if (creating || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return 'Title required';
    if (body.title.trim().length > 500) return 'Title cannot exceed 500 characters';
  }
  for (const [field, max] of [['description', 10000], ['pending_from_customer', 10000]]) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > max))
      return `${field} must be text of at most ${max} characters`;
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.has(body.priority)) return 'Invalid priority value';
  if (body.status !== undefined && !VALID_TASK_STATUSES.has(body.status)) return 'Invalid status value';
  if (body.deadline != null && body.deadline !== '') {
    if (typeof body.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.deadline)
      || Number.isNaN(Date.parse(body.deadline)) || new Date(body.deadline).toISOString().slice(0, 10) !== body.deadline)
      return 'Deadline must be a valid YYYY-MM-DD date';
  }
  for (const field of ['project_id', 'assigned_to']) {
    if (body[field] != null && body[field] !== '' && (!Number.isSafeInteger(Number(body[field])) || Number(body[field]) < 1))
      return `${field} must be a positive integer`;
  }
  return null;
}

async function validateTaskRelationships(projectId, assigneeId) {
  if (projectId && !await db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) return 'Project not found';
  if (assigneeId) {
    const user = await db.prepare('SELECT role, active FROM users WHERE id = ?').get(assigneeId);
    if (!user || !user.active || user.role !== 'engineer') return 'Assign tasks to an active engineer';
  }
  return null;
}

router.post('/', requireAuth, async (req, res) => {
  if (req.user.role === 'pm' || req.user.role === 'planner') return res.status(403).json({ error: 'Forbidden' });
  const inputError = validateTaskInput(req.body, true);
  if (inputError) return res.status(400).json({ error: inputError });
  const { project_id, title, description, priority, deadline, is_adhoc } = req.body;
  let { assigned_to } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (description && description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (req.user.role === 'engineer' && !project_id) return res.status(400).json({ error: 'Engineers must link a project' });

  // Engineers may only create tasks on projects they are assigned to,
  // and always self-assign regardless of what was passed.
  if (req.user.role === 'engineer') {
    const member = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(project_id, req.user.id));
    if (!member) return res.status(403).json({ error: 'You can only add tasks to projects you are assigned to' });
    assigned_to = req.user.id;
  }

  const relationshipError = await validateTaskRelationships(project_id, assigned_to);
  if (relationshipError) return res.status(400).json({ error: relationshipError });

  const result = (await db.prepare(`INSERT INTO tasks (project_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(project_id || null, title.trim(), description, priority || 'medium', deadline || null, assigned_to || null, req.user.id, is_adhoc ? 1 : 0));

  // Log activity
  const taskId = result.lastInsertRowid;
  logActivity(project_id, req.user.id, 'task_created', title);

  // Notify if engineer is assigned
  if (assigned_to) {
    const engineer = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(assigned_to));
    const project  = project_id ? (await db.prepare('SELECT title FROM projects WHERE id = ?').get(project_id)) : null;
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

router.put('/:id', requireAuth, async (req, res) => {
  const task = (await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && (req.user.role !== 'engineer' || task.assigned_to !== req.user.id))
    return res.status(403).json({ error: 'Forbidden' });
  const inputError = validateTaskInput(req.body);
  if (inputError) return res.status(400).json({ error: inputError });

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
    (await db.prepare(`UPDATE tasks SET
      title=COALESCE(?,title), description=COALESCE(?,description),
      priority=COALESCE(?,priority), deadline=?,
      status=COALESCE(?,status), pending_from_customer=?,
      updated_at=app_now() WHERE id=?`)
      .run(
        title?.trim() || null,
        description !== undefined ? description : null,
        priority || null,
        deadline !== undefined ? (deadline || null) : task.deadline,
        status || null,
        newPfc,
        task.id
      ));
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
  const nextAssignee = assigned_to === undefined ? task.assigned_to : (assigned_to || null);
  if (assigned_to !== undefined && nextAssignee !== task.assigned_to) {
    const relationshipError = await validateTaskRelationships(null, nextAssignee);
    if (relationshipError) return res.status(400).json({ error: relationshipError });
  }

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

  (await db.prepare(`UPDATE tasks SET title=COALESCE(?,title), description=COALESCE(?,description),
    priority=COALESCE(?,priority), deadline=?, assigned_to=?,
    status=COALESCE(?,status), is_adhoc=COALESCE(?,is_adhoc),
    pending_from_customer=?, updated_at=app_now() WHERE id=?`)
    .run(title?.trim(), description, priority, deadline === undefined ? task.deadline : (deadline || null), nextAssignee, status,
         is_adhoc != null ? (is_adhoc ? 1 : 0) : null, newPfc, task.id));

  // Log status change
  if (status && status !== task.status) {
    logActivity(task.project_id, req.user.id, 'task_status', `"${title || task.title}" → ${status}`);
  }

  // Notify if engineer assignment changed
  if (assigned_to != null && assigned_to !== task.assigned_to && assigned_to) {
    const engineer = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(assigned_to));
    const project  = task.project_id ? (await db.prepare('SELECT title FROM projects WHERE id = ?').get(task.project_id)) : null;
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
router.post('/bulk', requireAuth, async (req, res) => {
  if (req.user.role !== 'manager' && req.user.role !== 'engineer') return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const { ids, action, status, pending_from_customer } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No task IDs provided' });
  if (ids.length > 500) return res.status(400).json({ error: 'Maximum 500 IDs per bulk operation' });
  // Validate all IDs are positive integers
  if (!ids.every(id => Number.isSafeInteger(id) && id > 0)) return res.status(400).json({ error: 'All IDs must be positive integers' });

  if (action === 'delete') {
    if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
    await db.transaction(async (tx) => {
      const del = tx.prepare('DELETE FROM tasks WHERE id = ?');
      for (const id of ids) await del.run(id);
    });
    return res.json({ ok: true, affected: ids.length });
  }

  if (action === 'status') {
    if (!status) return res.status(400).json({ error: 'Status required' });
    if (!VALID_TASK_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status value' });
    const waiting = ['waiting_customer', 'waiting_vendor'].includes(status);
    if (pending_from_customer !== undefined && (typeof pending_from_customer !== 'string' || pending_from_customer.length > 10000 || waiting && !pending_from_customer.trim())) {
      return res.status(400).json({ error: 'pending_from_customer must be non-empty text of at most 10000 characters for waiting statuses' });
    }
    const uniqueIds = [...new Set(ids)];
    const owned = req.user.role === 'engineer' ? ' AND assigned_to=?' : '';
    const result = await db.prepare(`UPDATE tasks SET status=?,
      pending_from_customer=CASE WHEN ? IN ('waiting_customer','waiting_vendor') THEN COALESCE(?,pending_from_customer) ELSE NULL END,
      updated_at=app_now() WHERE id IN (${uniqueIds.map(() => '?').join(',')})${owned}`)
      .run(status, status, pending_from_customer === undefined ? null : pending_from_customer.trim(), ...uniqueIds, ...(owned ? [req.user.id] : []));
    return res.json({ ok: true, affected: result.changes });
  }

  res.status(400).json({ error: 'Unknown action' });
});

/* ── Export tasks to Excel ────────────────────────────────── */
router.get('/export', requireDownloadAuth, async (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const filters = taskFilters(req.query, req.user);
  if (filters.error) return res.status(400).json({ error: filters.error });
  const pagination = taskPagination(req.query);
  if (pagination?.error) return res.status(400).json({ error: pagination.error });
  const rows = await attachTaskHours(await db.prepare(`SELECT t.id, t.title, t.status, t.priority, t.deadline, t.is_adhoc,
    u.name as assigned_to, c.name as created_by, p.title as project
    FROM tasks t LEFT JOIN users u ON t.assigned_to=u.id JOIN users c ON t.created_by=c.id
    LEFT JOIN projects p ON p.id=t.project_id
    WHERE ${filters.where} ORDER BY ${filters.order}`).all(...filters.params));
  const wsData = [
    ['Title','Status','Priority','Deadline','Project','Assigned To','Created By','Hours Logged','Ad-hoc'],
    ...rows.map(r => [r.title, r.status, r.priority, r.deadline || '', r.project || '', r.assigned_to || '', r.created_by, Math.round(Number(r.logged_hours) * 10) / 10, r.is_adhoc ? 'Yes' : 'No']),
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
router.post('/:id/duplicate', requireAuth, async (req, res) => {
  if (req.user.role === 'planner' || req.user.role === 'pm')
    return res.status(403).json({ error: 'Forbidden' });
  const task = (await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  if (!task) return res.status(404).json({ error: 'Not found' });
  // Engineers: can only duplicate tasks assigned to them
  if (req.user.role === 'engineer') {
    if (task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  }
  const result = (await db.prepare(`
    INSERT INTO tasks (project_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.project_id, task.title + ' (copy)', task.description, task.priority, task.deadline,
         task.assigned_to, req.user.id, task.is_adhoc));
  logActivity(task.project_id, req.user.id, 'task_created', task.title + ' (copy)');
  res.json({ id: result.lastInsertRowid });
});

/* ── Overdue counts (lightweight — used by sidebar badges) ── */
router.get('/overdue-counts', requireAuth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let taskCount = 0;
  if (req.user.role === 'engineer') {
    taskCount = (await db.prepare(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE assigned_to = ? AND deadline < ? AND status NOT IN ('completed','closed','cancelled')
    `).get(req.user.id, today)).cnt;
  } else if (req.user.role === 'manager') {
    taskCount = (await db.prepare(`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE deadline < ? AND status NOT IN ('completed','closed','cancelled')
    `).get(today)).cnt;
  }
  // planners and PMs have no task visibility — taskCount stays 0

  const visitCount = req.user.role === 'engineer'
    ? (await db.prepare(`SELECT COUNT(*) AS cnt FROM maintenance_visits mv
        JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
        WHERE mve.user_id = ? AND mv.scheduled_date < ? AND mv.status = 'scheduled'
      `).get(req.user.id, today)).cnt
    : (await db.prepare(`SELECT COUNT(*) AS cnt FROM maintenance_visits
        WHERE scheduled_date < ? AND status = 'scheduled'
      `).get(today)).cnt;

  res.json({ tasks: taskCount, visits: visitCount });
});

router.delete('/:id', requireManager, async (req, res) => {
  const task = (await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  if (task) logActivity(task.project_id, req.user.id, 'task_deleted', task.title);
  (await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id));
  res.json({ ok: true });
});

/* ── Task Comments ────────────────────────────────────────── */
function positiveId(value) {
  return typeof value === 'number' ? Number.isSafeInteger(value) && value > 0
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

async function requireVisibleTask(req, res, next) {
  if (!['manager', 'engineer'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid task ID' });
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  req.task = task;
  next();
}

router.get('/:id/comments', requireAuth, requireVisibleTask, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT tc.*, u.name as user_name, u.role as user_role
    FROM task_comments tc
    JOIN users u ON tc.user_id = u.id
    WHERE tc.task_id = ?
    ORDER BY tc.created_at ASC
  `).all(req.params.id));
  res.json(rows);
});

router.post('/:id/comments', requireAuth, requireVisibleTask, async (req, res) => {
  const task = req.task;
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Message required' });
  if (message.length > 10000) return res.status(400).json({ error: 'Message cannot exceed 10000 characters' });
  const result = (await db.prepare(`INSERT INTO task_comments (task_id, user_id, message) VALUES (?, ?, ?)`)
    .run(req.params.id, req.user.id, message.trim()));
  logActivity(task.project_id, req.user.id, 'task_comment', `"${task.title}"`);

  // Detect @mentions and notify each unique mentioned user
  const allUsers = await db.prepare("SELECT id, name FROM users WHERE active = 1 AND (role='manager' OR (role='engineer' AND id=?))").all(task.assigned_to);
  const lower = message.toLowerCase();
  const notified = new Set();
  for (const u of allUsers) {
    if (u.id === req.user.id) continue; // don't self-notify
    const firstName = u.name.split(' ')[0].toLowerCase();
    const fullName  = u.name.toLowerCase().replace(/\s+/g, '');
    if (lower.includes('@' + firstName) || lower.includes('@' + fullName)) {
      if (!notified.has(u.id)) {
        notified.add(u.id);
        try {
          await db.prepare(`INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`)
            .run(u.id, 'mention', `${req.user.name} mentioned you`, `In task "${task.title}": ${message.trim().slice(0, 80)}`,
              '/tasks');
        } catch (_) {}
      }
    }
  }

  res.json({ id: result.lastInsertRowid });
});

router.delete('/:id/comments/:cid', requireAuth, requireVisibleTask, async (req, res) => {
  if (!positiveId(req.params.cid)) return res.status(400).json({ error: 'Invalid comment ID' });
  const comment = (await db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(req.params.cid, req.params.id));
  if (!comment) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'manager') {
    // managers can delete any comment
  } else if (comment.user_id !== req.user.id) {
    // everyone else can only delete their own comments
    return res.status(403).json({ error: 'Forbidden' });
  }
  (await db.prepare('DELETE FROM task_comments WHERE id = ?').run(req.params.cid));
  res.json({ ok: true });
});

/* ── Task Dependencies ────────────────────────────────────── */
// GET tasks this task depends on
router.get('/:id/dependencies', requireAuth, requireVisibleTask, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.assigned_to
    FROM task_dependencies td
    JOIN tasks t ON td.depends_on_id = t.id
    WHERE td.task_id = ?
    ORDER BY t.created_at ASC
  `).all(req.params.id));
  res.json(rows.map(({ assigned_to, ...row }) => req.user.role === 'engineer' && assigned_to !== req.user.id
    ? { id: row.id, title: 'Restricted task', restricted: true, is_blocking: !['completed', 'closed', 'cancelled'].includes(row.status) }
    : row));
});

// BFS reachability: returns true if startId can reach targetId via existing dependencies
async function canReach(startId, targetId) {
  const visited = new Set();
  const queue = [Number(startId)];
  const depStmt = db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?');
  while (queue.length) {
    const current = queue.shift();
    if (current === Number(targetId)) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = await depStmt.all(current);
    deps.forEach(d => queue.push(d.depends_on_id));
  }
  return false;
}

// Add a dependency
router.post('/:id/dependencies', requireManager, requireVisibleTask, async (req, res) => {
  const { depends_on_id } = req.body;
  if (!positiveId(depends_on_id)) return res.status(400).json({ error: 'depends_on_id must be a positive integer' });
  if (!await db.prepare('SELECT id FROM tasks WHERE id = ?').get(depends_on_id)) return res.status(404).json({ error: 'Dependency task not found' });
  if (Number(depends_on_id) === Number(req.params.id))
    return res.status(400).json({ error: 'A task cannot depend on itself' });
  // Full transitive cycle check: would depends_on_id eventually reach this task?
  if (await canReach(depends_on_id, req.params.id))
    return res.status(400).json({ error: 'Circular dependency detected' });
  await db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.params.id, depends_on_id);
  res.json({ ok: true });
});

// Remove a dependency
router.delete('/:id/dependencies/:depId', requireManager, requireVisibleTask, async (req, res) => {
  if (!positiveId(req.params.depId)) return res.status(400).json({ error: 'Invalid dependency ID' });
  (await db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').run(req.params.id, req.params.depId));
  res.json({ ok: true });
});

module.exports = router;
