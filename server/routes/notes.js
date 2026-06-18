const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

/* ── Scratchpad note (one per user) ──────────────────────── */
router.get('/note', requireAuth, async (req, res) => {
  const row = (await db.prepare('SELECT content, updated_at FROM personal_notes WHERE user_id = ?').get(req.user.id));
  res.json(row || { content: '', updated_at: null });
});

router.put('/note', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (content && content.length > 50000)
    return res.status(400).json({ error: 'Note cannot exceed 50,000 characters' });
  (await db.prepare(`
    INSERT INTO personal_notes (user_id, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, updated_at = datetime('now')
  `).run(req.user.id, content ?? ''));
  res.json({ ok: true });
});

/* ── Personal todos ──────────────────────────────────────── */
router.get('/todos', requireAuth, async (req, res) => {
  const rows = (await db.prepare(
    'SELECT * FROM personal_todos WHERE user_id = ? ORDER BY order_index ASC, id ASC'
  ).all(req.user.id));
  res.json(rows);
});

router.post('/todos', requireAuth, async (req, res) => {
  const { title, order_index } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (title.trim().length > 250) return res.status(400).json({ error: 'Title cannot exceed 250 characters' });
  const order = order_index === undefined ? 0 : Number(order_index);
  if (!Number.isInteger(order) || order < 0) return res.status(400).json({ error: 'order_index must be a non-negative integer' });
  const result = (await db.prepare(
    'INSERT INTO personal_todos (user_id, title, order_index) VALUES (?, ?, ?)'
  ).run(req.user.id, title.trim(), order));
  res.json({ id: result.lastInsertRowid });
});

router.put('/todos/:id', requireAuth, async (req, res) => {
  const { title, done, order_index } = req.body;
  const todo = (await db.prepare('SELECT * FROM personal_todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id));
  if (!todo) return res.status(404).json({ error: 'Not found' });
  if (title !== undefined && !title?.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
  if (title?.trim().length > 250) return res.status(400).json({ error: 'Title cannot exceed 250 characters' });
  const order = order_index === undefined ? null : Number(order_index);
  if (order !== null && (!Number.isInteger(order) || order < 0))
    return res.status(400).json({ error: 'order_index must be a non-negative integer' });
  (await db.prepare(`
    UPDATE personal_todos
    SET title = COALESCE(?, title),
        done  = COALESCE(?, done),
        order_index = COALESCE(?, order_index)
    WHERE id = ? AND user_id = ?
  `).run(title?.trim() || null, done !== undefined ? (done ? 1 : 0) : null, order, req.params.id, req.user.id));
  res.json({ ok: true });
});

router.delete('/todos/:id', requireAuth, async (req, res) => {
  (await db.prepare('DELETE FROM personal_todos WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id));
  res.json({ ok: true });
});

// Clear completed todos
router.delete('/todos', requireAuth, async (req, res) => {
  (await db.prepare('DELETE FROM personal_todos WHERE user_id = ? AND done = 1').run(req.user.id));
  res.json({ ok: true });
});

module.exports = router;
