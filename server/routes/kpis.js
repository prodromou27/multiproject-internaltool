const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

// Engineers can view KPIs for projects they're assigned to; managers see all
router.get('/:project_id', requireAuth, (req, res) => {
  if (req.user.role === 'engineer') {
    const assigned = db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.project_id, req.user.id);
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare('SELECT k.*, u.name as updated_by_name FROM kpis k LEFT JOIN users u ON k.updated_by = u.id WHERE k.project_id = ? ORDER BY k.id').all(req.params.project_id);
  res.json(rows);
});

router.post('/:project_id', requireManager, (req, res) => {
  const { name, target_value, current_value, unit } = req.body;
  if (!name || target_value == null) return res.status(400).json({ error: 'Name and target required' });
  const result = db.prepare('INSERT INTO kpis (project_id, name, target_value, current_value, unit, updated_by) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.project_id, name, target_value, current_value || 0, unit || null, req.user.id);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:project_id/:id', requireManager, (req, res) => {
  const { name, target_value, current_value, unit } = req.body;
  db.prepare(`UPDATE kpis SET name=COALESCE(?,name), target_value=COALESCE(?,target_value),
    current_value=COALESCE(?,current_value), unit=COALESCE(?,unit),
    updated_by=?, updated_at=datetime('now') WHERE id=? AND project_id=?`)
    .run(name, target_value, current_value, unit, req.user.id, req.params.id, req.params.project_id);
  res.json({ ok: true });
});

router.delete('/:project_id/:id', requireManager, (req, res) => {
  db.prepare('DELETE FROM kpis WHERE id = ? AND project_id = ?').run(req.params.id, req.params.project_id);
  res.json({ ok: true });
});

module.exports = router;
