const router = require('express').Router();
const { requirePermission } = require('../middleware/auth');
const { insights, PERIODS } = require('../insights');

/* Dashboard → Insights: the whole operation, for people with reporting access (managers by default). */
router.get('/', requirePermission('reports.access'), async (req, res) => {
  const days = req.query.days === undefined ? 90 : Number(req.query.days);
  if (!PERIODS.includes(days)) return res.status(400).json({ error: `Period must be one of ${PERIODS.join(', ')} days` });
  const id = key => (req.query[key] === undefined || req.query[key] === '' ? null : /^[1-9]\d*$/.test(String(req.query[key])) ? Number(req.query[key]) : NaN);
  const customerId = id('customer_id'), teamId = id('team_id'), engineerId = id('engineer_id');
  if ([customerId, teamId, engineerId].some(Number.isNaN)) return res.status(400).json({ error: 'Invalid filter' });
  res.json(await insights({ days, customerId, teamId, engineerId }));
});

/* Reports → Tasks: the tasks dashboard (taskInsights.js), with the same period and filters. */
router.get('/tasks', requirePermission('reports.access'), async (req, res) => {
  const days = req.query.days === undefined ? 90 : Number(req.query.days);
  if (!PERIODS.includes(days)) return res.status(400).json({ error: `Period must be one of ${PERIODS.join(', ')} days` });
  const id = key => (req.query[key] === undefined || req.query[key] === '' ? null : /^[1-9]\d*$/.test(String(req.query[key])) ? Number(req.query[key]) : NaN);
  const customerId = id('customer_id'), teamId = id('team_id'), engineerId = id('engineer_id');
  if ([customerId, teamId, engineerId].some(Number.isNaN)) return res.status(400).json({ error: 'Invalid filter' });
  res.json(await require('../taskInsights').taskInsights({ days, customerId, teamId, engineerId }));
});

module.exports = router;
