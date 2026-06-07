const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/notifications — current user's notifications, newest first
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, title, body, link, read, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 60
  `).all(req.user.id);
  const unread = rows.filter(r => !r.read).length;
  res.json({ notifications: rows, unread });
});

// POST /api/notifications/read-all — mark all as read
router.post('/read-all', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(req.user.id);
  res.json({ ok: true });
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/notifications/:id — delete one
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM notifications WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/notifications — clear all
router.delete('/', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
