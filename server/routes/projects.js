const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { notify } = require('../notifications');
const { decrypt } = require('../fieldCipher');

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
async function logActivity(project_id, user_id, action, detail) {
  try {
    (await db.prepare(`INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)`)
      .run(project_id, user_id, action, detail || null));
  } catch (_) { /* non-fatal */ }
}

async function notifyPendingScores(projectId, projectTitle) {
  try {
    // Count engineers on this project who still lack a scorecard
    const pending = (await db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM project_assignments pa
      JOIN users u ON u.id = pa.user_id AND u.role = 'engineer' AND u.active = 1
      WHERE pa.project_id = ?
        AND pa.user_id NOT IN (
          SELECT engineer_id FROM project_scorecards WHERE project_id = ?
        )
    `).get(projectId, projectId));

    if (!pending || pending.cnt === 0) return; // nothing to do

    const managers = (await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all());
    const title = `KPI scores pending: "${projectTitle}"`;
    const body  = `${pending.cnt} engineer${pending.cnt > 1 ? 's' : ''} on "${projectTitle}" still need${pending.cnt === 1 ? 's' : ''} a quality scorecard. Please submit scores in the Scorecards section.`;
    await db.transaction(async (tx) => {
      const ins = tx.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'scorecard_pending', ?, ?)");
      for (const m of managers) await ins.run(m.id, title, body);
    });
  } catch (_) { /* non-fatal */ }
}

function normalizeIdList(values, label) {
  if (!Array.isArray(values)) return { error: `${label} must be an array` };
  if (values.length > 100) return { error: `${label} cannot contain more than 100 entries` };
  const ids = [...new Set(values.map(v => Number(v)).filter(Number.isInteger).filter(v => v > 0))];
  if (ids.length !== values.length) return { error: `${label} must contain only positive integer IDs` };
  return { ids };
}

async function loadEngineerMap(ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const engineerMap = {};
  (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND role = 'engineer' AND active = 1`)
    .all(...ids))
    .forEach(e => { engineerMap[e.id] = e; });
  return engineerMap;
}

const VALID_PROJECT_PRIORITIES = new Set(['low', 'medium', 'high']);
const VALID_PROJECT_STATUSES = new Set([
  'not_started', 'in_progress', 'waiting_customer', 'waiting_vendor', 'on_hold',
  'delayed', 'completed_engineer', 'completed', 'pending_approval', 'closed', 'reopened', 'cancelled',
]);
const VALID_RAG = new Set(['red', 'amber', 'green']);

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function normalizeOptionalId(value, label) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return { error: `${label} must be a positive integer` };
  return { value: n };
}

// List projects — engineers/planners see only assigned ones; managers and PMs see all
router.get('/', requireAuth, async (req, res) => {
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
    rows = (await db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id));
  } else {
    rows = (await db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE pa.user_id = ? ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id, req.user.id));
  }
  // Attach computed RAG + live completion %
  // Use manually stored completion_pct when set; otherwise derive from task counts
  res.json(rows.map(r => ({
    ...r,
    customer_name: decrypt(r.customer_name),
    rag_status:     computeRag(r),
    completion_pct: r.completion_pct != null
      ? r.completion_pct
      : (r.task_count > 0 ? Math.round((r.done_count / r.task_count) * 100) : 0),
  })));
});

/* ── Pin / unpin a project ─────────────────────────────────── */
router.post('/:id/pin', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  (await db.prepare('INSERT OR IGNORE INTO user_project_pins (user_id, project_id) VALUES (?, ?)').run(req.user.id, id));
  res.json({ ok: true });
});
router.delete('/:id/pin', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  (await db.prepare('DELETE FROM user_project_pins WHERE user_id = ? AND project_id = ?').run(req.user.id, id));
  res.json({ ok: true });
});

router.get('/:id', requireAuth, async (req, res) => {
  const p = (await db.prepare(`
    SELECT p.*, u.name as created_by_name, cu.name as customer_name, cu.contact_name as customer_contact, cu.contact_email as customer_email
    FROM projects p
    JOIN users u ON p.created_by = u.id
    LEFT JOIN customers cu ON p.customer_id = cu.id
    WHERE p.id = ?`).get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const members = (await db.prepare('SELECT u.id, u.name, u.email, u.role FROM project_assignments pa JOIN users u ON pa.user_id = u.id WHERE pa.project_id = ?').all(p.id));
  const updates = (await db.prepare('SELECT s.*, u.name as user_name FROM project_status_updates s JOIN users u ON s.user_id = u.id WHERE s.project_id = ? ORDER BY s.created_at DESC').all(p.id));
  res.json({
    ...p,
    customer_name:    decrypt(p.customer_name),
    customer_contact: decrypt(p.customer_contact),
    customer_email:   decrypt(p.customer_email),
    members,
    updates,
  });
});

/* ── Activity feed ─────────────────────────────────────────── */
router.get('/:id/activity', requireAuth, async (req, res) => {
  const p = (await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = (await db.prepare(`
    SELECT pa.*, u.name as user_name, u.role as user_role
    FROM project_activity pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.project_id = ?
    ORDER BY pa.created_at DESC
    LIMIT 100
  `).all(req.params.id));
  res.json(rows);
});

router.post('/', requireManager, async (req, res) => {
  const { title, description, priority, deadline, customer_id, member_ids } = req.body;
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title required' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (description !== undefined && description !== null && typeof description !== 'string') return res.status(400).json({ error: 'Description must be text' });
  if (description && description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PROJECT_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (deadline && !isIsoDate(deadline)) return res.status(400).json({ error: 'deadline must be YYYY-MM-DD' });
  const normalizedCustomer = normalizeOptionalId(customer_id, 'customer_id');
  if (normalizedCustomer.error) return res.status(400).json({ error: normalizedCustomer.error });
  if (normalizedCustomer.value) {
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(normalizedCustomer.value);
    if (!customer) return res.status(400).json({ error: 'customer_id does not exist' });
  }
  let engineerMap = {};
  let normalizedMemberIds = [];
  if (Array.isArray(member_ids) && member_ids.length > 0) {
    const normalized = normalizeIdList(member_ids, 'member_ids');
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    normalizedMemberIds = normalized.ids;
    engineerMap = await loadEngineerMap(normalizedMemberIds);
    if (Object.keys(engineerMap).length !== normalizedMemberIds.length)
      return res.status(400).json({ error: 'member_ids may only include active engineers' });
  }
  const result = (await db.prepare('INSERT INTO projects (title, description, priority, deadline, customer_id, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(title.trim(), description || null, priority || 'medium', deadline || null, normalizedCustomer.value || null, req.user.id));
  const pid = result.lastInsertRowid;
  logActivity(pid, req.user.id, 'project_created', title);
  if (normalizedMemberIds.length > 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
    for (const uid of normalizedMemberIds) {
      await ins.run(pid, uid);
      const engineer = engineerMap[uid];
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
  }
  res.json({ id: pid });
});

router.put('/:id', requireManager, async (req, res) => {
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });

  const { title, description, priority, deadline, customer_id, status, pending_from_customer, completion_pct, rag_override } = req.body;
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return res.status(400).json({ error: 'Title cannot be empty' });
  if (typeof title === 'string' && title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (description !== undefined && description !== null && typeof description !== 'string') return res.status(400).json({ error: 'Description must be text' });
  if (description && description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PROJECT_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (status && !VALID_PROJECT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status value' });
  if (deadline && !isIsoDate(deadline)) return res.status(400).json({ error: 'deadline must be YYYY-MM-DD' });
  const normalizedCustomer = normalizeOptionalId(customer_id, 'customer_id');
  if (normalizedCustomer.error) return res.status(400).json({ error: normalizedCustomer.error });
  if (normalizedCustomer.value) {
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(normalizedCustomer.value);
    if (!customer) return res.status(400).json({ error: 'customer_id does not exist' });
  }
  if (completion_pct !== undefined) {
    const pct = Number(completion_pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'completion_pct must be an integer between 0 and 100' });
  }
  if (rag_override !== undefined && rag_override !== '' && rag_override !== null && !VALID_RAG.has(rag_override))
    return res.status(400).json({ error: 'Invalid rag_override value' });

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

  (await db.prepare(`UPDATE projects SET title=COALESCE(?,title), description=COALESCE(?,description),
    priority=COALESCE(?,priority), deadline=?, customer_id=?,
    status=COALESCE(?,status), pending_from_customer=?,
    completion_pct=COALESCE(?,completion_pct), rag_override=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(title?.trim() || null, description, priority, deadline ?? p.deadline, normalizedCustomer.value !== undefined ? normalizedCustomer.value : p.customer_id, status, newPfc,
         completion_pct !== undefined ? completion_pct : null, newRagOverride, p.id));
  if (status && status !== p.status) {
    logActivity(p.id, req.user.id, 'status_changed', `${p.status} → ${status}`);
    if (status === 'closed' || status === 'completed') {
      notifyPendingScores(p.id, title || p.title);
    }
  }
  res.json({ ok: true });
});

// Engineer/planner requests closure — must be assigned to the project; PM is read-only
router.post('/:id/request-closure', requireAuth, async (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'Forbidden — PMs have read-only access to projects' });
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  // Verify the requesting user is assigned to this project (managers are always allowed)
  if (req.user.role !== 'manager') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden — you are not assigned to this project' });
  }
  if (['closed', 'cancelled', 'pending_approval'].includes(p.status)) return res.status(400).json({ error: 'Cannot request closure in current status' });
  (await db.prepare(`UPDATE projects SET status='pending_approval', closure_requested_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(p.id));
  (await db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(p.id, req.user.id, 'Closure requested by ' + req.user.name));
  logActivity(p.id, req.user.id, 'closure_requested', null);
  res.json({ ok: true });
});

// Manager approves closure
router.post('/:id/approve-closure', requireManager, async (req, res) => {
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending_approval') return res.status(400).json({ error: 'Project is not pending approval' });
  (await db.prepare(`UPDATE projects SET status='closed', closed_by=?, closed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(req.user.id, p.id));
  (await db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(p.id, req.user.id, 'Project closed and approved by ' + req.user.name));
  logActivity(p.id, req.user.id, 'project_closed', null);
  notifyPendingScores(p.id, p.title);
  res.json({ ok: true });
});

router.post('/:id/status-update', requireAuth, async (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'Forbidden — PMs have read-only access to projects' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message cannot exceed 2000 characters' });
  // Non-managers must be assigned to the project
  if (req.user.role !== 'manager') {
    const p = (await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id));
    if (!p) return res.status(404).json({ error: 'Not found' });
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden — you are not assigned to this project' });
  }
  (await db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(req.params.id, req.user.id, message));
  logActivity(req.params.id, req.user.id, 'status_update', message.slice(0, 80));
  res.json({ ok: true });
});

router.post('/:id/members', requireManager, async (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids) || user_ids.length === 0)
    return res.status(400).json({ error: 'user_ids array required' });
  const pid = req.params.id;
  const project = (await db.prepare('SELECT title, deadline, priority FROM projects WHERE id = ?').get(pid));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const normalized = normalizeIdList(user_ids, 'user_ids');
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const engineerMap = await loadEngineerMap(normalized.ids);
  if (Object.keys(engineerMap).length !== normalized.ids.length)
    return res.status(400).json({ error: 'user_ids may only include active engineers' });

  const ins = db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
  for (const uid of normalized.ids) {
    const result = await ins.run(pid, uid);
    if (result.changes > 0) {
      const engineer = engineerMap[uid];
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
  res.json({ ok: true });
});

router.delete('/:id/members/:uid', requireManager, async (req, res) => {
  const engineer = (await db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.uid));
  (await db.prepare('DELETE FROM project_assignments WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.uid));
  if (engineer) logActivity(req.params.id, req.user.id, 'member_removed', engineer.name);
  res.json({ ok: true });
});

module.exports = router;
