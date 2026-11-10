const router = require('express').Router();
const db     = require('../db');
const { requireManager } = require('../middleware/auth');

/* ── GET /api/audit ─────────────────────────────────────── */
// Manager-only. Returns paginated audit log with optional filters.
router.get('/', requireManager, async (req, res) => {
  const MAX_LIMIT = 500;
  const {
    entity_type,
    user_id,
    action,
    date_from,
    date_to,
  } = req.query;
  const limit  = Math.min(Math.max(1, Number(req.query.limit)  || 100), MAX_LIMIT);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where  = [];
  const params = [];

  if (entity_type) { where.push('entity_type = ?'); params.push(entity_type); }
  if (user_id)     { where.push('user_id = ?');     params.push(Number(user_id)); }
  if (action)      { where.push('action = ?');       params.push(action); }
  if (date_from)   { where.push("created_at >= ?");  params.push(date_from + ' 00:00:00'); }
  if (date_to)     { where.push("created_at <= ?");  params.push(date_to   + ' 23:59:59'); }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = (await db.prepare(`
    SELECT * FROM audit_log
    ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset)));

  const { cnt: total } = (await db.prepare(
    `SELECT COUNT(*) AS cnt FROM audit_log ${whereSQL}`
  ).get(...params));

  res.json({ rows, total });
});

/* ── GET /api/audit/users ─────────────────────────────────
   Distinct list of users who appear in the audit log (for
   the filter dropdown in the UI).
*/
router.get('/users', requireManager, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT DISTINCT user_id, user_name, user_role
    FROM audit_log
    WHERE user_id IS NOT NULL
    ORDER BY user_name
  `).all());
  res.json(rows);
});

module.exports = router;
