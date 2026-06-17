const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit }    = require('../auditLog');

/* ── Access helpers ──────────────────────────────────────── */
async function canView(req, projectId) {
  if (req.user.role === 'manager' || req.user.role === 'pm') return true;
  const asgn = (await db.prepare(
    'SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?'
  ).get(projectId, req.user.id));
  return !!asgn;
}

function canManage(req) {
  return ['manager', 'planner'].includes(req.user.role);
}

// For mutations on an existing milestone: planners must be assigned to the project
async function canManageMilestone(req, milestone) {
  if (req.user.role === 'manager') return true;
  if (req.user.role !== 'planner') return false;
  return !!(await db.prepare(
    'SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?'
  ).get(milestone.project_id, req.user.id));
}

/* ── GET /api/milestones?project_id=X ───────────────────── */
router.get('/', requireAuth, async (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });
  if (!await canView(req, project_id)) return res.status(403).json({ error: 'Forbidden' });

  const rows = (await db.prepare(`
    SELECT m.*,
      uc.name AS created_by_name,
      ux.name AS completed_by_name
    FROM project_milestones m
    LEFT JOIN users uc ON m.created_by = uc.id
    LEFT JOIN users ux ON m.completed_by = ux.id
    WHERE m.project_id = ?
    ORDER BY m.due_date ASC NULLS LAST, m.created_at ASC
  `).all(project_id));

  res.json(rows);
});

/* ── POST /api/milestones ────────────────────────────────── */
router.post('/', requireAuth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const { project_id, title, description, due_date } = req.body;
  if (!project_id || !title?.trim())
    return res.status(400).json({ error: 'project_id and title required' });

  // Planners must be assigned to the project to create milestones in it
  if (req.user.role === 'planner') {
    const assigned = (await db.prepare(
      'SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?'
    ).get(Number(project_id), req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden — not assigned to this project' });
  }

  const r = (await db.prepare(`
    INSERT INTO project_milestones (project_id, title, description, due_date, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(Number(project_id), title.trim(), description || null, due_date || null, req.user.id));

  logAudit(db, req, 'milestone', r.lastInsertRowid, title.trim(), 'created', null);
  res.json({ id: r.lastInsertRowid });
});

/* ── PUT /api/milestones/:id ─────────────────────────────── */
router.put('/:id', requireAuth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const m = (await db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!await canManageMilestone(req, m)) return res.status(403).json({ error: 'Forbidden — not assigned to this project' });

  const { title, description, due_date } = req.body;
  (await db.prepare(`
    UPDATE project_milestones
    SET title       = COALESCE(?, title),
        description = ?,
        due_date    = ?,
        updated_at  = datetime('now')
    WHERE id = ?
  `).run(
    title?.trim() || null,
    description !== undefined ? description : m.description,
    due_date     !== undefined ? due_date    : m.due_date,
    m.id,
  ));

  logAudit(db, req, 'milestone', m.id, title?.trim() || m.title, 'updated', null);
  res.json({ ok: true });
});

/* ── POST /api/milestones/:id/complete ───────────────────── */
router.post('/:id/complete', requireAuth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const m = (await db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!await canManageMilestone(req, m)) return res.status(403).json({ error: 'Forbidden — not assigned to this project' });
  if (m.completed_at) return res.json({ ok: true }); // idempotent

  (await db.prepare(`
    UPDATE project_milestones
    SET completed_at = datetime('now'), completed_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, m.id));

  logAudit(db, req, 'milestone', m.id, m.title, 'completed', null);
  res.json({ ok: true });
});

/* ── POST /api/milestones/:id/reopen ─────────────────────── */
router.post('/:id/reopen', requireAuth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const m = (await db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!await canManageMilestone(req, m)) return res.status(403).json({ error: 'Forbidden — not assigned to this project' });

  (await db.prepare(`
    UPDATE project_milestones
    SET completed_at = NULL, completed_by = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(m.id));

  logAudit(db, req, 'milestone', m.id, m.title, 'reopened', null);
  res.json({ ok: true });
});

/* ── DELETE /api/milestones/:id ──────────────────────────── */
router.delete('/:id', requireAuth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const m = (await db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(req.params.id));
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!await canManageMilestone(req, m)) return res.status(403).json({ error: 'Forbidden — not assigned to this project' });

  (await db.prepare('DELETE FROM project_milestones WHERE id = ?').run(m.id));
  logAudit(db, req, 'milestone', m.id, m.title, 'deleted', null);
  res.json({ ok: true });
});

module.exports = router;
