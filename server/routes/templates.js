const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

// GET all templates
router.get('/', requireManager, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT pt.*, u.name as created_by_name,
      (SELECT COUNT(*) FROM project_template_tasks WHERE template_id = pt.id) as task_count
    FROM project_templates pt
    LEFT JOIN users u ON pt.created_by = u.id
    ORDER BY pt.created_at DESC
  `).all());
  res.json(rows);
});

// GET single template with tasks
router.get('/:id', requireManager, async (req, res) => {
  const tpl = (await db.prepare('SELECT * FROM project_templates WHERE id = ?').get(req.params.id));
  if (!tpl) return res.status(404).json({ error: 'Not found' });
  const tasks = (await db.prepare(
    'SELECT * FROM project_template_tasks WHERE template_id = ? ORDER BY order_index ASC, id ASC'
  ).all(req.params.id));
  res.json({ ...tpl, tasks });
});

// POST create template
router.post('/', requireManager, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const result = (await db.prepare(
    'INSERT INTO project_templates (name, description, created_by) VALUES (?, ?, ?)'
  ).run(name.trim(), description || null, req.user.id));
  res.json({ id: result.lastInsertRowid });
});

// PUT update template
router.put('/:id', requireManager, async (req, res) => {
  const { name, description } = req.body;
  (await db.prepare(
    'UPDATE project_templates SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
  ).run(name || null, description !== undefined ? description : null, req.params.id));
  res.json({ ok: true });
});

// DELETE template
router.delete('/:id', requireManager, async (req, res) => {
  (await db.prepare('DELETE FROM project_templates WHERE id = ?').run(req.params.id));
  res.json({ ok: true });
});

// POST add task to template
router.post('/:id/tasks', requireManager, async (req, res) => {
  const { title, description, priority, order_index } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const result = (await db.prepare(
    'INSERT INTO project_template_tasks (template_id, title, description, priority, order_index) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, title.trim(), description || null, priority || 'medium', order_index ?? 0));
  res.json({ id: result.lastInsertRowid });
});

// PUT update template task
router.put('/:id/tasks/:tid', requireManager, async (req, res) => {
  const { title, description, priority, order_index } = req.body;
  (await db.prepare(
    `UPDATE project_template_tasks
     SET title = COALESCE(?, title),
         description = COALESCE(?, description),
         priority = COALESCE(?, priority),
         order_index = COALESCE(?, order_index)
     WHERE id = ? AND template_id = ?`
  ).run(title || null, description !== undefined ? description : null, priority || null, order_index ?? null, req.params.tid, req.params.id));
  res.json({ ok: true });
});

// DELETE template task
router.delete('/:id/tasks/:tid', requireManager, async (req, res) => {
  (await db.prepare('DELETE FROM project_template_tasks WHERE id = ? AND template_id = ?').run(req.params.tid, req.params.id));
  res.json({ ok: true });
});

// POST apply template — creates a project with tasks from the template
router.post('/:id/apply', requireManager, async (req, res) => {
  const tpl = (await db.prepare('SELECT * FROM project_templates WHERE id = ?').get(req.params.id));
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  const { title, description, priority, deadline, customer_id, member_ids } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Project title required' });

  const projectId = await db.transaction(async (tx) => {
    const pResult = await tx.prepare(`
      INSERT INTO projects (title, description, priority, deadline, customer_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      description || tpl.description || null,
      priority || 'medium',
      deadline || null,
      customer_id || null,
      req.user.id
    );
    const pid = pResult.lastInsertRowid;

    // Assign members — only engineers (prevents non-engineers being added as members)
    const insM = tx.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)');
    if (Array.isArray(member_ids) && member_ids.length) {
      const ph2 = member_ids.map(() => '?').join(',');
      const validEngineers = await tx.prepare(`SELECT id FROM users WHERE id IN (${ph2}) AND role = 'engineer' AND active = 1`).all(...member_ids);
      for (const e of validEngineers) await insM.run(pid, e.id);
    }

    // Create tasks from template
    const templateTasks = await tx.prepare(
      'SELECT * FROM project_template_tasks WHERE template_id = ? ORDER BY order_index ASC, id ASC'
    ).all(req.params.id);
    const insT = tx.prepare(
      `INSERT INTO tasks (project_id, title, description, priority, created_by, status) VALUES (?, ?, ?, ?, ?, 'open')`
    );
    for (const tt of templateTasks) await insT.run(pid, tt.title, tt.description || null, tt.priority, req.user.id);

    // Log activity
    await tx.prepare(
      'INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(pid, req.user.id, 'project_created', `From template: ${tpl.name}`);

    return pid;
  });
  res.json({ id: projectId });
});

module.exports = router;
