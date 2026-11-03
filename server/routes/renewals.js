const router = require('express').Router();
const db = require('../db');
const appTime = require('../appTime');
const { requireAuth } = require('../middleware/auth');
const { accessibleCustomerIds } = require('../customerAccess');
const { hasPermission } = require('../permissions');
const { decrypt } = require('../fieldCipher');
const { licencesFor, daysLeft } = require('../customerLicences');
const { contractsFor } = require('../customerContracts');
const { casesFor } = require('../vendorCases');

/* Renewals & cases (/api/renewals): across the customers a person may open, what
   expires in the coming days (licences, subscriptions, certificates, contracts,
   asset support and warranty), what expired in the last 30 days without being
   renewed, and the vendor cases still open. Managers and planners see every
   customer; engineers the customers they work with. */
const PAST_DAYS = 30;

router.get('/', requireAuth, async (req, res) => {
  if (!['manager', 'planner', 'engineer'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const days = [30, 60, 90, 180].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  const today = appTime.today(), until = appTime.addDays(today, days), since = appTime.addDays(today, -PAST_DAYS);
  const allowed = await accessibleCustomerIds(req.user);
  const ids = allowed ? [...allowed] : null;
  const customers = await db.prepare(`SELECT id, name FROM customers WHERE active = 1${ids ? (ids.length ? ` AND id IN (${ids.map(() => '?').join(',')})` : ' AND 1 = 0') : ''}`).all(...(ids || []));
  const names = new Map(customers.map(c => [Number(c.id), decrypt(c.name)]));
  const scope = [...names.keys()];
  const inWindow = date => date && date >= since && date <= until;

  const [licences, contracts, cases] = await Promise.all([licencesFor(scope), contractsFor(scope), casesFor(scope, { all: false })]);
  const items = [];
  for (const l of licences) if (inWindow(l.expires_on)) items.push({ type: l.kind, id: l.id, customer_id: l.customer_id, name: l.name, detail: l.vendor, date: l.expires_on, days_left: l.days_left, not_renewing: l.not_renewing, section: 'contracts' });
  for (const c of contracts) {
    if (c.status === 'renewed' || c.status === 'upcoming' || !inWindow(c.end_date)) continue;
    if (req.user.role === 'engineer' && c.status === 'expired') continue; // engineers see contracts in force (as on Customer 360)
    items.push({ type: 'contract', id: c.id, customer_id: c.customer_id, name: c.reference || c.description || `Contract #${c.id}`, detail: c.service_level, date: c.end_date, days_left: c.days_left, not_renewing: false, section: 'contracts' });
  }
  // Device names only with asset access (engineers: on the customers they work with, which is this scope).
  const assetAccess = await hasPermission(req.user, 'assets.access') || req.user.role === 'engineer';
  if (assetAccess) {
    const assets = scope.length ? await db.prepare(`SELECT id, customer_id, name, support_end_date, warranty_expiry_date FROM customer_assets
      WHERE lifecycle_status NOT IN ('retired','decommissioned') AND customer_id IN (${scope.map(() => '?').join(',')})`).all(...scope) : [];
    for (const a of assets) for (const [type, raw] of [['support', a.support_end_date], ['warranty', a.warranty_expiry_date]]) {
      const date = raw ? String(raw).slice(0, 10) : null;
      if (inWindow(date)) items.push({ type, id: Number(a.id), customer_id: Number(a.customer_id), name: decrypt(a.name), detail: null, date, days_left: daysLeft(date, today), not_renewing: false, section: 'assets' });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  res.json({
    days, today,
    expiring: items.map(item => ({ ...item, customer_name: names.get(item.customer_id) || null })),
    vendor_cases: cases.map(c => ({ ...c, asset_name: assetAccess ? c.asset_name : null, customer_name: names.get(c.customer_id) || null })),
  });
});

module.exports = router;
