const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const appTime = require('../appTime');
const { requireAuth } = require('../middleware/auth');
const { canAccessCustomer, engineerOnCustomer, positiveId } = require('../customerAccess');
const { hasPermission } = require('../permissions');
const { encrypt, decrypt } = require('../fieldCipher');
const { logAudit } = require('../auditLog');
const { sentVersion, conflict } = require('../editVersion');
const { STATUSES, OPEN, SEVERITIES, casesFor, caseById, updatesOf } = require('../vendorCases');

/* Vendor support cases of one customer (/api/customers/:id/vendor-cases). Anyone
   who may open the customer sees them; managers and the engineers who work with
   the customer open cases and record updates; managers delete them. */

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

const label = (customer, item) => `${decrypt(customer.name)} — ${item.vendor} case ${item.case_number}`;

router.get('/', async (req, res) => {
  const assetAccess = await hasPermission(req.user, 'assets.access') || await engineerOnCustomer(req.user, req.customer.id);
  const [cases, assets, people] = await Promise.all([
    casesFor([req.customer.id]),
    assetAccess ? db.prepare('SELECT id, name FROM customer_assets WHERE customer_id = ? ORDER BY id').all(req.customer.id) : [],
    db.prepare("SELECT id, name FROM users WHERE active = 1 AND role IN ('manager','engineer') ORDER BY name").all(),
  ]);
  res.json({
    cases: cases.map(c => (assetAccess ? c : { ...c, asset_name: null })),
    statuses: STATUSES, severities: SEVERITIES,
    assets: assets.map(a => ({ id: Number(a.id), name: decrypt(a.name) })),
    owners: people.map(p => ({ id: Number(p.id), name: p.name })),
    can_edit: canEdit(req.user), can_delete: req.user.role === 'manager',
  });
});

async function caseOf(req) {
  if (!positiveId(req.params.caseId)) return null;
  return db.prepare('SELECT * FROM vendor_cases WHERE id = ? AND customer_id = ?').get(Number(req.params.caseId), req.customer.id);
}

router.get('/:caseId', async (req, res) => {
  const row = await caseOf(req);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  res.json({ case: await caseById(row.id), updates: await updatesOf(row.id) });
});

// Checks and normalises a case from the request; existing values fill gaps on edit.
async function validate(body, customerId, existing = {}) {
  const pick = key => body[key] !== undefined ? body[key] : existing[key];
  const text = (key, max, name, required = false) => {
    const value = pick(key);
    if (value == null || (typeof value === 'string' && !value.trim())) return required ? { error: `${name} is required` } : { value: null };
    if (typeof value !== 'string' || value.trim().length > max) return { error: `${name} must be at most ${max} characters` };
    return { value: value.trim() };
  };
  const vendor = text('vendor', 60, 'Vendor', true), caseNumber = text('case_number', 60, 'Case number', true), subject = text('subject', 300, 'Subject', true);
  for (const field of [vendor, caseNumber, subject]) if (field.error) return field;
  const severity = pick('severity') ?? 'medium', status = pick('status') ?? 'open';
  if (!Object.hasOwn(SEVERITIES, severity)) return { error: 'Severity must be critical, high, medium or low' };
  if (!Object.hasOwn(STATUSES, status)) return { error: 'Unknown status' };
  const opened = pick('opened_on') ?? appTime.today();
  if (!realDate(opened)) return { error: 'The opened date must be YYYY-MM-DD' };
  let followUp = pick('next_follow_up');
  if (followUp === '' || followUp == null) followUp = null;
  else if (!realDate(followUp)) return { error: 'The follow-up date must be YYYY-MM-DD' };
  let rt = pick('rt_ticket');
  if (rt === '' || rt == null) rt = null;
  else { rt = String(rt).trim().replace(/^#/, ''); if (!/^\d{1,12}$/.test(rt)) return { error: 'The RT ticket is its number, such as 12345' }; }
  let ownerId = pick('owner_id');
  if (ownerId === '' || ownerId == null) ownerId = null;
  else {
    if (!positiveId(ownerId)) return { error: 'Invalid owner' };
    ownerId = Number(ownerId);
    if (!await db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('manager','engineer')").get(ownerId)) return { error: 'The owner must be an active manager or engineer' };
  }
  let assetId = pick('asset_id');
  if (assetId === '' || assetId == null) assetId = null;
  else {
    if (!positiveId(assetId)) return { error: 'Invalid asset' };
    assetId = Number(assetId);
    if (!await db.prepare('SELECT 1 FROM customer_assets WHERE id = ? AND customer_id = ?').get(assetId, customerId)) return { error: 'The asset must belong to this customer' };
  }
  return { value: { vendor: vendor.value, case_number: caseNumber.value, subject: subject.value, severity, status, opened_on: opened, next_follow_up: followUp, rt_ticket: rt, owner_id: ownerId, asset_id: assetId } };
}

async function duplicate(v, exceptId = 0) {
  const rows = await db.prepare('SELECT id, vendor FROM vendor_cases WHERE case_number = ? AND id <> ?').all(v.case_number, exceptId);
  return rows.some(row => String(row.vendor).toLowerCase() === v.vendor.toLowerCase());
}
const closedOn = (status, existing) => (OPEN.includes(status) ? null : existing?.closed_on || appTime.today());

router.post('/', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only managers and engineers open vendor cases' });
  const checked = await validate({ owner_id: req.user.id, ...req.body }, req.customer.id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value, now = new Date().toISOString();
  if (await duplicate(v)) return res.status(409).json({ error: `${v.vendor} case ${v.case_number} is already recorded` });
  const id = await db.transaction(async tx => {
    const created = (await tx.prepare(`INSERT INTO vendor_cases (customer_id, asset_id, vendor, case_number, subject, severity, status, owner_id, rt_ticket, next_follow_up, opened_on, closed_on, last_update_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.customer.id, v.asset_id, v.vendor, v.case_number, encrypt(v.subject), v.severity, v.status, v.owner_id, v.rt_ticket,
      v.next_follow_up, v.opened_on, closedOn(v.status), now, req.user.id, now, now)).lastInsertRowid;
    const note = typeof req.body.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 4000) : null;
    await tx.prepare('INSERT INTO vendor_case_updates (case_id, user_id, note, status_to, created_at) VALUES (?, ?, ?, ?, ?)').run(created, req.user.id, encrypt(note || 'Case recorded'), v.status, now);
    return created;
  });
  await logAudit(db, req, 'vendor_case', id, label(req.customer, v), 'created', `${SEVERITIES[v.severity]}, ${STATUSES[v.status]}`);
  res.status(201).json({ id: Number(id) });
});

router.put('/:caseId', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only managers and engineers change vendor cases' });
  const existing = await caseOf(req);
  if (!existing) return res.status(404).json({ error: 'Case not found' });
  const version = sentVersion(req.body);
  if (version.error) return res.status(400).json({ error: version.error });
  if (version.value && version.value !== Number(existing.edit_version)) return conflict(res, 'This case', await caseById(existing.id));
  const checked = await validate(req.body, req.customer.id, { ...existing, subject: decrypt(existing.subject) });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const v = checked.value, now = new Date().toISOString();
  if (await duplicate(v, existing.id)) return res.status(409).json({ error: `${v.vendor} case ${v.case_number} is already recorded` });
  await db.transaction(async tx => {
    await tx.prepare(`UPDATE vendor_cases SET asset_id = ?, vendor = ?, case_number = ?, subject = ?, severity = ?, status = ?, owner_id = ?, rt_ticket = ?, next_follow_up = ?, opened_on = ?,
        closed_on = ?, updated_at = ?, edit_version = edit_version + 1${v.status !== existing.status ? ', last_update_at = ?' : ''} WHERE id = ?`)
      .run(v.asset_id, v.vendor, v.case_number, encrypt(v.subject), v.severity, v.status, v.owner_id, v.rt_ticket, v.next_follow_up, v.opened_on,
        closedOn(v.status, existing), now, ...(v.status !== existing.status ? [now] : []), existing.id);
    if (v.status !== existing.status) await tx.prepare('INSERT INTO vendor_case_updates (case_id, user_id, status_from, status_to, created_at) VALUES (?, ?, ?, ?, ?)').run(existing.id, req.user.id, existing.status, v.status, now);
  });
  await logAudit(db, req, 'vendor_case', existing.id, label(req.customer, v), 'updated', v.status !== existing.status ? `${STATUSES[existing.status]} → ${STATUSES[v.status]}` : 'details');
  res.json({ ok: true });
});

// An update: what happened (a note), and optionally a new status and next follow-up.
router.post('/:caseId/updates', async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: 'Only managers and engineers update vendor cases' });
  const existing = await caseOf(req);
  if (!existing) return res.status(404).json({ error: 'Case not found' });
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if (!note || note.length > 4000) return res.status(400).json({ error: 'Write what happened (at most 4000 characters)' });
  const status = req.body.status ?? existing.status;
  if (!Object.hasOwn(STATUSES, status)) return res.status(400).json({ error: 'Unknown status' });
  let followUp = req.body.next_follow_up === undefined ? existing.next_follow_up : req.body.next_follow_up;
  if (followUp === '' || followUp == null) followUp = null;
  else if (!realDate(followUp)) return res.status(400).json({ error: 'The follow-up date must be YYYY-MM-DD' });
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    await tx.prepare('UPDATE vendor_cases SET status = ?, next_follow_up = ?, closed_on = ?, last_update_at = ?, updated_at = ?, edit_version = edit_version + 1 WHERE id = ?')
      .run(status, OPEN.includes(status) ? followUp : null, closedOn(status, existing), now, now, existing.id);
    await tx.prepare('INSERT INTO vendor_case_updates (case_id, user_id, note, status_from, status_to, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(existing.id, req.user.id, encrypt(note), status !== existing.status ? existing.status : null, status !== existing.status ? status : null, now);
  });
  await logAudit(db, req, 'vendor_case', existing.id, label(req.customer, existing), 'update_added', status !== existing.status ? `${STATUSES[existing.status]} → ${STATUSES[status]}` : 'note');
  res.status(201).json({ case: await caseById(existing.id), updates: await updatesOf(existing.id) });
});

router.delete('/:caseId', async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Only managers delete vendor cases' });
  const existing = await caseOf(req);
  if (!existing) return res.status(404).json({ error: 'Case not found' });
  await db.prepare('DELETE FROM vendor_cases WHERE id = ?').run(existing.id);
  await logAudit(db, req, 'vendor_case', existing.id, label(req.customer, existing), 'deleted', STATUSES[existing.status]);
  res.json({ ok: true });
});

module.exports = router;
