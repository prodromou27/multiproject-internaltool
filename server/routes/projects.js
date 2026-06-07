const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { notify } = require('../notifications');

/* ── RAG computation ───────────────────────────────────────── */
function computeRag(row) {
  if (row.rag_override) return row.rag_override;
  if (['closed', 'completed', 'cancelled'].includes(row.status)) return 'green';

  let rag = 'green';

  // Deadline proximity
  if (row.deadline) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dl    = new Date(row.deadline);
    const daysUntil = Math.ceil((dl - today) / 86400000);
    if (daysUntil < 0)       rag = 'red';
    else if (daysUntil <= 14) rag = 'amber';
  }

  // Overdue task ratio
  const total  = row.task_count        || 0;
  const overdue = row.overdue_task_count || 0;
  if (total > 0) {
    const ratio = overdue / total;
    if (ratio > 0.25)                   rag = 'red';
    else if (ratio > 0.10 && rag === 'green') rag = 'amber';
  }

  return rag;
}

/* ── helpers ──────────────────────────────────────────────── */
function logActivity(project_id, user_id, action, detail) {
  try {
    db.prepare(`INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)`)
      .run(project_id, user_id, action, detail || null);
  } catch (_) { /* non-fatal */ }
}

function notifyPendingScores(projectId, projectTitle) {
  try {
    // Count engineers on this project who still lack a scorecard
    const pending = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM project_assignments pa
      JOIN users u ON u.id = pa.user_id AND u.role = 'engineer' AND u.active = 1
      WHERE pa.project_id = ?
        AND pa.user_id NOT IN (
          SELECT engineer_id FROM project_scorecards WHERE project_id = ?
        )
    `).get(projectId, projectId);

    if (!pending || pending.cnt === 0) return; // nothing to do

    const managers = db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
    const ins = db.prepare(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'scorecard_pending', ?, ?)"
    );
    const title = `KPI scores pending: "${projectTitle}"`;
    const body  = `${pending.cnt} engineer${pending.cnt > 1 ? 's' : ''} on "${projectTitle}" still need${pending.cnt === 1 ? 's' : ''} a quality scorecard. Please submit scores in the Scorecards section.`;
    db.transaction(() => {
      managers.forEach(m => ins.run(m.id, title, body));
    })();
  } catch (_) { /* non-fatal */ }
}

// List projects — engineers/planners see only assigned ones; managers and PMs see all
router.get('/', requireAuth, (req, res) => {
  const taskCols = `
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'cancelled') as task_count,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status IN ('completed','closed')) as done_count,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id
       AND status NOT IN ('completed','closed','cancelled')
       AND deadline IS NOT NULL AND deadline < date('now')) as overdue_task_count,
    (EXISTS (SELECT 1 FROM user_project_pins WHERE project_id = p.id AND user_id = ?)) as is_pinned
  `;
  let rows;
  if (req.user.role === 'manager' || req.user.role === 'pm') {
    rows = db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id);
  } else {
    rows = db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE pa.user_id = ? ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id, req.user.id);
  }
  // Attach computed RAG + live completion %
  // Use manually stored completion_pct when set; otherwise derive from task counts
  res.json(rows.map(r => ({
    ...r,
    rag_status:     computeRag(r),
    completion_pct: r.completion_pct != null
      ? r.completion_pct
      : (r.task_count > 0 ? Math.round((r.done_count / r.task_count) * 100) : 0),
  })));
});

/* ── Pin / unpin a project ─────────────────────────────────── */
router.post('/:id/pin', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('INSERT OR IGNORE INTO user_project_pins (user_id, project_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ ok: true });
});
router.delete('/:id/pin', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM user_project_pins WHERE user_id = ? AND project_id = ?').run(req.user.id, id);
  res.json({ ok: true });
});

router.get('/:id', requireAuth, (req, res) => {
  const p = db.prepare(`
    SELECT p.*, u.name as created_by_name, cu.name as customer_name, cu.contact_name as customer_contact, cu.contact_email as customer_email
    FROM projects p
    JOIN users u ON p.created_by = u.id
    LEFT JOIN customers cu ON p.customer_id = cu.id
    WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const members = db.prepare('SELECT u.id, u.name, u.email, u.role FROM project_assignments pa JOIN users u ON pa.user_id = u.id WHERE pa.project_id = ?').all(p.id);
  const updates = db.prepare('SELECT s.*, u.name as user_name FROM project_status_updates s JOIN users u ON s.user_id = u.id WHERE s.project_id = ? ORDER BY s.created_at DESC').all(p.id);
  res.json({ ...p, members, updates });
});

/* ── Activity feed ─────────────────────────────────────────── */
router.get('/:id/activity', requireAuth, (req, res) => {
  const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare(`
    SELECT pa.*, u.name as user_name, u.role as user_role
    FROM project_activity pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.project_id = ?
    ORDER BY pa.created_at DESC
    LIMIT 100
  `).all(req.params.id);
  res.json(rows);
});

router.post('/', requireManager, (req, res) => {
  const { title, description, priority, deadline, customer_id, member_ids } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare('INSERT INTO projects (title, description, priority, deadline, customer_id, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(title, description, priority || 'medium', deadline || null, customer_id || null, req.user.id);
  const pid = result.lastInsertRowid;
  logActivity(pid, req.user.id, 'project_created', title);
  if (Array.isArray(member_ids) && member_ids.length > 0) {
    // Batch-fetch all engineers in one query (avoids N individual SELECT queries)
    const placeholders = member_ids.map(() => '?').join(',');
    const engineerMap = {};
    db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND role = 'engineer'`)
      .all(...member_ids)
      .forEach(e => { engineerMap[e.id] = e; });

    const ins = db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
    member_ids.forEach(uid => {
      ins.run(pid, uid);
      const engineer = engineerMap[uid];
      if (engineer) {
        logActivity(pid, req.user.id, 'member_added', engineer.name);
        notify('project.assigned', {
          engineer_id:    uid,
          engineer_name:  engineer.name,
          engineer_email: engineer.email,
          project_id:     pid,
          project_title:  title,
          deadline:       deadline || null,
          priority:       priority || 'medium',
        });
      }
    });
  }
  res.json({ id: pid });
});

router.put('/:id', requireManager, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const { title, description, priority, deadline, customer_id, status, pending_from_customer, completion_pct, rag_override } = req.body;

  // Manage pending_from_customer: set when requires_reason status, clear when leaving it, preserve otherwise
  let newPfc;
  if (status === 'waiting_customer' || status === 'waiting_vendor') {
    newPfc = pending_from_customer !== undefined ? pending_from_customer : p.pending_from_customer;
  } else if (status && status !== p.status) {
    newPfc = null;
  } else {
    newPfc = p.pending_from_customer;
  }

  // rag_override: null/undefined = keep existing; '' = clear override; 'red'/'amber'/'green' = set
  const newRagOverride = rag_override !== undefined
    ? (rag_override === '' ? null : rag_override)
    : p.rag_override;

  db.prepare(`UPDATE projects SET title=COALESCE(?,title), description=COALESCE(?,description),
    priority=COALESCE(?,priority), deadline=?, customer_id=?,
    status=COALESCE(?,status), pending_from_customer=?,
    completion_pct=COALESCE(?,completion_pct), rag_override=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(title, description, priority, deadline ?? p.deadline, customer_id !== undefined ? customer_id : p.customer_id, status, newPfc,
         completion_pct !== undefined ? completion_pct : null, newRagOverride, p.id);
  if (status && status !== p.status) {
    logActivity(p.id, req.user.id, 'status_changed', `${p.status} → ${status}`);
    if (status === 'closed' || status === 'completed') {
      notifyPendingScores(p.id, title || p.title);
    }
  }
  res.json({ ok: true });
});

// Engineer/planner requests closure — must be assigned to the project; PM is read-only
router.post('/:id/request-closure', requireAuth, (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'Forbidden — PMs have read-only access to projects' });
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  // Verify the requesting user is assigned to this project (managers are always allowed)
  if (req.user.role !== 'manager') {
    const assigned = db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Forbidden — you are not assigned to this project' });
  }
  if (['closed', 'cancelled', 'pending_approval'].includes(p.status)) return res.status(400).json({ error: 'Cannot request closure in current status' });
  db.prepare(`UPDATE projects SET status='pending_approval', closure_requested_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(p.id);
  db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(p.id, req.user.id, 'Closure requested by ' + req.user.name);
  logActivity(p.id, req.user.id, 'closure_requested', null);
  res.json({ ok: true });
});

// Manager approves closure
router.post('/:id/approve-closure', requireManager, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending_approval') return res.status(400).json({ error: 'Project is not pending approval' });
  db.prepare(`UPDATE projects SET status='closed', closed_by=?, closed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(req.user.id, p.id);
  db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(p.id, req.user.id, 'Project closed and approved by ' + req.user.name);
  logActivity(p.id, req.user.id, 'project_closed', null);
  notifyPendingScores(p.id, p.title);
  res.json({ ok: true });
});

router.post('/:id/status-update', requireAuth, (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'Forbidden — PMs have read-only access to projects' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message cannot exceed 2000 characters' });
  // Non-managers must be assigned to the project
  if (req.user.role !== 'manager') {
    const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const assigned = db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Forbidden — you are not assigned to this project' });
  }
  db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(req.params.id, req.user.id, message);
  logActivity(req.params.id, req.user.id, 'status_update', message.slice(0, 80));
  res.json({ ok: true });
});

router.post('/:id/members', requireManager, (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids) || user_ids.length === 0)
    return res.status(400).json({ error: 'user_ids array required' });
  const pid = req.params.id;
  const project = db.prepare('SELECT title, deadline, priority FROM projects WHERE id = ?').get(pid);

  // Batch-fetch engineers in one query
  const placeholders = user_ids.map(() => '?').join(',');
  const engineerMap = {};
  db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND role = 'engineer'`)
    .all(...user_ids)
    .forEach(e => { engineerMap[e.id] = e; });

  const ins = db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
  user_ids.forEach(uid => {
    const result = ins.run(pid, uid);
    if (result.changes > 0) {
      const engineer = engineerMap[uid];
      if (engineer && project) {
        logActivity(pid, req.user.id, 'member_added', engineer.name);
        notify('project.assigned', {
          engineer_id:    uid,
          engineer_name:  engineer.name,
          engineer_email: engineer.email,
          project_id:     parseInt(pid),
          project_title:  project.title,
          deadline:       project.deadline || null,
          priority:       project.priority,
        });
      }
    }
  });
  res.json({ ok: true });
});

router.delete('/:id/members/:uid', requireManager, (req, res) => {
  const engineer = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.uid);
  db.prepare('DELETE FROM project_assignments WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.uid);
  if (engineer) logActivity(req.params.id, req.user.id, 'member_removed', engineer.name);
  res.json({ ok: true });
});

module.exports = router;
