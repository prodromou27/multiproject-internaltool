// Customer data-quality queue (enhancement E06): managers see what to fix, and may
// dismiss an item with a reason (audited, and undoable).
const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { RULES, dataQualityItems } = require('../dataQuality');
const { positiveId } = require('../customerAccess');

router.use(requireManager);

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ rules: RULES, items: await dataQualityItems() });
});

function target(req, res) {
  const customerId = positiveId(req.body?.customer_id) ? Number(req.body.customer_id) : null;
  const rule = req.body?.rule;
  if (!customerId || !Object.hasOwn(RULES, rule)) { res.status(400).json({ error: 'customer_id and a known rule are required' }); return null; }
  return { customerId, rule };
}

router.post('/dismiss', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 300) return res.status(400).json({ error: 'Say why this is not a problem (up to 300 characters)' });
  const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(t.customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  await db.prepare(`INSERT INTO customer_quality_dismissals (customer_id, rule, reason, dismissed_by, dismissed_at) VALUES (?, ?, ?, ?, app_now())
    ON CONFLICT (customer_id, rule) DO UPDATE SET reason = EXCLUDED.reason, dismissed_by = EXCLUDED.dismissed_by, dismissed_at = EXCLUDED.dismissed_at`).run(t.customerId, t.rule, reason, req.user.id);
  await logAudit(db, req, 'customer', t.customerId, null, 'data_quality_dismissed', `${t.rule}: ${reason}`);
  res.json({ ok: true });
});

router.post('/restore', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const removed = await db.prepare('DELETE FROM customer_quality_dismissals WHERE customer_id = ? AND rule = ?').run(t.customerId, t.rule);
  if (!removed.changes) return res.status(404).json({ error: 'That item is not dismissed' });
  await logAudit(db, req, 'customer', t.customerId, null, 'data_quality_restored', t.rule);
  res.json({ ok: true });
});

module.exports = router;
