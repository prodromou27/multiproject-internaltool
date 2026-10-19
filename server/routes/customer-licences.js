const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canAccessCustomer, engineerOnCustomer, positiveId } = require('../customerAccess');
const { hasPermission } = require('../permissions');
const { encrypt, decrypt } = require('../fieldCipher');
const { logAudit } = require('../auditLog');
const { sentVersion, conflict } = require('../editVersion');
const { KINDS, licencesFor } = require('../customerLicences');

/* Licences, subscriptions and certificates of one customer (/api/customers/:id/licences).
   Anyone who may open the customer sees them; managers and the engineers who work
   with the customer add, change and renew them; managers delete them. */

const realDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const canEdit = user => ['manager', 'engineer'].includes(user.role);

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

const label = (customer, licence) => `${decrypt(customer.name)} — ${licence.name}`;

router.get('/', async (req, res) => {
  // Asset names only with asset access (the same rule as the asset list).
  const assetAccess = await hasPermission(req.user, 'assets.access') || await engineerOnCustomer(req.user, req.customer.id);
  const assets = assetAccess ? await db.prepare('SELECT id, name FROM customer_assets WHERE customer_id = ? ORDER BY id').all(req.customer.id) : [];
  res.json({
    licences: await licencesFor([req.customer.id]),
    kinds: KINDS,
    assets: assets.map(a => ({ id: Number(a.id), name: decrypt(a.name) })),
    can_edit: canEdit(req.user),
    can_delete: req.user.role === 'manager',
  });
});

// Checks and normalises a licence from the request; existing values fill gaps on edit.
async function validate(body, customerId, existing = {}) {
  const pick = key => body[key] !== undefined ? body[key] : existing[key];
  const text = (key, max, name, required = false) => {
    const value = pick(key);
    if (value == null || value === '') return required ? { error: `${name} is required` } : { value: null };
    if (typeof value !== 'string' || value.trim().length > max) return { error: `${name} must be at most ${max} characters` };
    if (required && !value.trim()) return { error: `${name} is required` };
    return { value: value.trim() || null };
  };
  const name = text('name', 200, 'Name', true), vendor = text('vendor', 100, 'Vendor'), reference = text('reference', 200, 'Reference'), notes = text('notes', 2000, 'Notes');
  for (const field of [name, vendor, reference, notes]) if (field.error) return field;
  const kind = pick('kind');
  if (!Object.hasOwn(KINDS, kind)) return { error: 'Type must be licence, subscription or certificate' };
  const expires = pick('expires_on');
  if (!realDate(expires)) return { error: 'The expiry date is required (YYYY-MM-DD)' };
  let quantity = pick('quantity');
  if (quantity === '' || quantity == null) quantity = null;
  else if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 1000000) return { error: 'Quantity must be a whole number from 1' };
  else quantity = Number(quantity);
  let assetId = pick('asset_id');
  if (assetId === '' || assetId == null) assetId = null;
  else {
    if (!positiveId(assetId)) return { error: 'Invalid asset' };
    assetId = Number(assetId);
    if (!await db.prepare('SELECT 1 FROM customer_assets WHERE id = ? AND customer_id = ?').get(assetId, customerId)) return { error: 'The asset must belong to this customer' };
  }
  const notRenewing = pick('not_renewing');
  return { value: { kind, name: name.value, vendor: vendor.value, reference: reference.value, notes: notes.value, quantity, asset_id: assetId, expires_on: expires, not_renewing: notRenewing === true || notRenewing === 1 ? 1 : 0 } };
}

async function licenceOf(req) {
  if (!positiveId(req.params.licenceId)) return null;
  return db.prepare('SELECT * FROM customer_licences WHERE id = ? AND customer_id = ?').get(Number(req.params.licenceId), req.customer.id);
}
const plainOf = row => ({ ...row, name: decrypt(row.name), reference: decrypt(row.reference), notes: decrypt(row.notes), not_renewing: Number(row.not_renewing) });

router.post('/', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only managers and engineers add licences' });
  const checked = await validate(req.body, req.customer.id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value, now = new Date().toISOString();
  const id = (await db.prepare(`INSERT INTO customer_licences (customer_id, asset_id, kind, name, vendor, reference, quantity, expires_on, not_renewing, notes, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.customer.id, v.asset_id, v.kind, encrypt(v.name), v.vendor, encrypt(v.reference), v.quantity, v.expires_on, v.not_renewing,
    encrypt(v.notes), req.user.id, req.user.id, now, now)).lastInsertRowid;
  await logAudit(db, req, 'customer_licence', id, label(req.customer, v), 'created', `${KINDS[v.kind]}, expires ${v.expires_on}`);
  res.status(201).json({ id: Number(id) });
});

router.put('/:licenceId', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only managers and engineers change licences' });
  const existing = await licenceOf(req);
  if (!existing) return res.status(404).json({ error: 'Licence not found' });
  const version = sentVersion(req.body);
  if (version.error) return res.status(400).json({ error: version.error });
  if (version.value && version.value !== Number(existing.edit_version)) return conflict(res, 'This licence', (await licencesFor([req.customer.id])).find(l => l.id === Number(existing.id)));
  const checked = await validate(req.body, req.customer.id, plainOf(existing));
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value;
  // A later expiry date on a save is a renewal.
  const renewed = v.expires_on > existing.expires_on;
  await db.prepare(`UPDATE customer_licences SET asset_id = ?, kind = ?, name = ?, vendor = ?, reference = ?, quantity = ?, expires_on = ?, not_renewing = ?, notes = ?,
      renewed_at = ?, updated_by = ?, updated_at = ?, edit_version = edit_version + 1 WHERE id = ?`)
    .run(v.asset_id, v.kind, encrypt(v.name), v.vendor, encrypt(v.reference), v.quantity, v.expires_on, renewed ? 0 : v.not_renewing, encrypt(v.notes),
      renewed ? new Date().toISOString() : existing.renewed_at, req.user.id, new Date().toISOString(), existing.id);
  await logAudit(db, req, 'customer_licence', existing.id, label(req.customer, v), renewed ? 'renewed' : 'updated',
    renewed ? `expiry ${existing.expires_on} → ${v.expires_on}` : `expires ${v.expires_on}${v.not_renewing ? ', not renewing' : ''}`);
  res.json({ ok: true, renewed });
});

router.delete('/:licenceId', async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Only managers delete licences' });
  const existing = await licenceOf(req);
  if (!existing) return res.status(404).json({ error: 'Licence not found' });
  await db.prepare('DELETE FROM customer_licences WHERE id = ?').run(existing.id);
  await logAudit(db, req, 'customer_licence', existing.id, label(req.customer, plainOf(existing)), 'deleted', `expiry ${existing.expires_on}`);
  res.json({ ok: true });
});

module.exports = router;
