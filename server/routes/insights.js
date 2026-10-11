const router = require('express').Router();
const { requirePermission } = require('../middleware/auth');
const { insights, PERIODS } = require('../insights');

/* Dashboard → Insights: the whole operation, for people with reporting access (managers by default). */
router.get('/', requirePermission('reports.access'), async (req, res) => {
  const days = req.query.days === undefined ? 90 : Number(req.query.days);
  if (!PERIODS.includes(days)) return res.status(400).json({ error: `Period must be one of ${PERIODS.join(', ')} days` });
  res.json(await insights({ days }));
});

module.exports = router;
