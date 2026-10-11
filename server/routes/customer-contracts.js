const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const appTime = require('../appTime');
const { requireAuth, requireManager } = require('../middleware/auth');
const { hasPermission } = require('../permissions');
const { canAccessCustomer, isManagedServicesEngineer, positiveId } = require('../customerAccess');
const { encrypt, decrypt } = require('../fieldCipher');
const { logAudit } = require('../auditLog');
const { SERVICE_LEVELS, contractsFor } = require('../customerContracts');

/* Contracts of one customer (/api/customers/:id/contracts). Anyone who may open
   the customer sees its contracts; asset names only with asset access (the same
   rule as the asset list). Managers add, change, renew and delete them. */

const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const LIVE = new Set(['active', 'ending_soon', 'upcoming']);

router.use(requireAuth, async (req, res, next) => {
  try {
    if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
    req.customer = await db.prepare('SELECT id, name FROM customers WHERE id = ?').get(Number(req.params.id));
    if (!req.customer) return res.status(404).json({ error: 'Customer not found' });
    if (!await canAccessCustomer(req.user, req.customer.id)) return res.status(403).json({ error: 'Forbidden' });
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)))
      return res.status(400).json({ error: 'A JSON object is required' });
    next();
  } catch (error) { next(error); }
});

const label = (customer, contract) => `${decrypt(customer.name)} — ${contract.reference || contract.description || `contract #${contract.id}`}`;

async function isManaged(customerId) {
  return !!await db.prepare('SELECT 1 FROM managed_customer_configurations WHERE customer_id = ? AND managed_services_enabled = 1').get(customerId);
}

router.get('/', async (req, res) => {
  const customerId = req.customer.id;
  const [contracts, links, assets, managed, assetAccess] = await Promise.all([
    contractsFor([customerId]),
    db.prepare('SELECT ca.contract_id, ca.asset_id FROM customer_contract_assets ca JOIN customer_contracts c ON c.id = ca.contract_id WHERE c.customer_id = ?').all(customerId),
    db.prepare("SELECT id, name, asset_type, lifecycle_status FROM customer_assets WHERE customer_id = ? ORDER BY id").all(customerId),
    isManaged(customerId),
    hasPermission(req.user, 'assets.access').then(ok => ok || isManagedServicesEngineer(req.user, customerId)),
  ]);
  const assetView = new Map(assets.map(a => [Number(a.id), { id: Number(a.id), name: decrypt(a.name), asset_type: a.asset_type, lifecycle_status: a.lifecycle_status }]));
  const assetIdsOf = id => links.filter(l => Number(l.contract_id) === id).map(l => Number(l.asset_id));
  const covered = new Set(contracts.filter(c => LIVE.has(c.status)).flatMap(c => assetIdsOf(c.id)));
  const uncovered = assets.filter(a => a.lifecycle_status === 'active' && !covered.has(Number(a.id)));
  res.json({
    contracts: contracts.map(c => ({ ...c, asset_count: assetIdsOf(c.id).length, ...(assetAccess ? { assets: assetIdsOf(c.id).map(id => assetView.get(id)).filter(Boolean) } : {}) })),
    is_managed: managed,
    service_levels: SERVICE_LEVELS,
    can_manage: req.user.role === 'manager',
    can_see_assets: assetAccess,
    ...(assetAccess ? { assets: [...assetView.values()], uncovered_assets: uncovered.map(a => assetView.get(Number(a.id))) } : { uncovered_count: uncovered.length }),
  });
});

// Checks and normalises a contract from the request; existing values fill gaps on edit.
async function validate(body, customerId, existing = {}) {
  const pick = key => body[key] !== undefined ? body[key] : existing[key];
  const text = (key, max, name) => {
    const value = pick(key);
    if (value == null || value === '') return { value: null };
    if (typeof value !== 'string' || value.trim().length > max) return { error: `${name} must be at most ${max} characters` };
    return { value: value.trim() || null };
  };
  const reference = text('reference', 100, 'Reference'), description = text('description', 200, 'Description');
  const level = text('service_level', 30, 'Contract type'), notes = text('notes', 2000, 'Notes');
  for (const field of [reference, description, level, notes]) if (field.error) return field;
  if (!reference.value) return { error: 'Contract reference is required' };
  const start = pick('start_date'), end = pick('end_date');
  if (!realDate(start) || !realDate(end)) return { error: 'Start and end dates are required (YYYY-MM-DD)' };
  if (end < start) return { error: 'The end date cannot be before the start date' };
  let assetIds = null;
  if (body.asset_ids !== undefined) {
    if (!Array.isArray(body.asset_ids) || body.asset_ids.length > 5000 || !body.asset_ids.every(positiveId)) return { error: 'Invalid assets' };
    assetIds = [...new Set(body.asset_ids.map(Number))];
    if (assetIds.length) {
      const found = await db.prepare(`SELECT id FROM customer_assets WHERE customer_id = ? AND id IN (${assetIds.map(() => '?').join(',')})`).all(customerId, ...assetIds);
      if (found.length !== assetIds.length) return { error: 'Every asset must belong to this customer' };
    }
  }
  return { value: { reference: reference.value, description: description.value, service_level: level.value, notes: notes.value, start_date: start, end_date: end }, assetIds };
}

async function setAssets(tx, contractId, assetIds) {
  await tx.prepare('DELETE FROM customer_contract_assets WHERE contract_id = ?').run(contractId);
  for (const assetId of assetIds) await tx.exec(`INSERT INTO customer_contract_assets (contract_id, asset_id) VALUES (${Number(contractId)}, ${Number(assetId)})`);
}

async function contractOf(req) {
  if (!positiveId(req.params.contractId)) return null;
  return db.prepare('SELECT * FROM customer_contracts WHERE id = ? AND customer_id = ?').get(Number(req.params.contractId), req.customer.id);
}

router.post('/', requireManager, async (req, res) => {
  const checked = await validate(req.body, req.customer.id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value, now = new Date().toISOString();
  const id = await db.transaction(async tx => {
    const created = (await tx.prepare(`INSERT INTO customer_contracts (customer_id, reference, description, service_level, start_date, end_date, notes, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.customer.id, encrypt(v.reference), encrypt(v.description), v.service_level, v.start_date, v.end_date, encrypt(v.notes), req.user.id, req.user.id, now, now)).lastInsertRowid;
    await setAssets(tx, created, checked.assetIds || []);
    return created;
  });
  await logAudit(db, req, 'customer_contract', id, label(req.customer, { id, ...v }), 'created', `${v.start_date} to ${v.end_date}, ${(checked.assetIds || []).length} assets`);
  res.status(201).json({ id: Number(id) });
});

router.put('/:contractId', requireManager, async (req, res) => {
  const existing = await contractOf(req);
  if (!existing) return res.status(404).json({ error: 'Contract not found' });
  const plain = { ...existing, reference: decrypt(existing.reference), description: decrypt(existing.description), notes: decrypt(existing.notes) };
  const checked = await validate(req.body, req.customer.id, plain);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value;
  await db.transaction(async tx => {
    await tx.prepare(`UPDATE customer_contracts SET reference = ?, description = ?, service_level = ?, start_date = ?, end_date = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(encrypt(v.reference), encrypt(v.description), v.service_level, v.start_date, v.end_date, encrypt(v.notes), req.user.id, new Date().toISOString(), existing.id);
    if (checked.assetIds) await setAssets(tx, existing.id, checked.assetIds);
  });
  await logAudit(db, req, 'customer_contract', existing.id, label(req.customer, { id: existing.id, ...v }), 'updated', `${v.start_date} to ${v.end_date}`);
  res.json({ ok: true });
});

// Renewal: the next period of the same contract, with the same assets unless others are given.
router.post('/:contractId/renew', requireManager, async (req, res) => {
  const existing = await contractOf(req);
  if (!existing) return res.status(404).json({ error: 'Contract not found' });
  if (await db.prepare('SELECT 1 FROM customer_contracts WHERE renewed_from_id = ?').get(existing.id)) return res.status(409).json({ error: 'This contract has already been renewed' });
  const previousAssets = (await db.prepare('SELECT asset_id FROM customer_contract_assets WHERE contract_id = ?').all(existing.id)).map(r => Number(r.asset_id));
  const base = { reference: decrypt(existing.reference), description: decrypt(existing.description), service_level: existing.service_level, notes: decrypt(existing.notes) };
  const checked = await validate({ asset_ids: previousAssets, ...req.body }, req.customer.id, { ...base, start_date: undefined, end_date: undefined });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value;
  if (v.start_date < existing.start_date) return res.status(400).json({ error: 'A renewal cannot start before the contract it renews' });
  const now = new Date().toISOString();
  const id = await db.transaction(async tx => {
    const created = (await tx.prepare(`INSERT INTO customer_contracts (customer_id, reference, description, service_level, start_date, end_date, notes, renewed_from_id, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.customer.id, encrypt(v.reference), encrypt(v.description), v.service_level, v.start_date, v.end_date, encrypt(v.notes), existing.id, req.user.id, req.user.id, now, now)).lastInsertRowid;
    await setAssets(tx, created, checked.assetIds);
    return created;
  });
  await logAudit(db, req, 'customer_contract', id, label(req.customer, { id, ...v }), 'renewed', `Renewed contract #${existing.id}: ${v.start_date} to ${v.end_date}`);
  res.status(201).json({ id: Number(id) });
});

router.delete('/:contractId', requireManager, async (req, res) => {
  const existing = await contractOf(req);
  if (!existing) return res.status(404).json({ error: 'Contract not found' });
  await db.prepare('DELETE FROM customer_contracts WHERE id = ?').run(existing.id);
  await logAudit(db, req, 'customer_contract', existing.id, label(req.customer, { id: existing.id, reference: decrypt(existing.reference) }), 'deleted', `${existing.start_date} to ${existing.end_date}`);
  res.json({ ok: true });
});

module.exports = router;
