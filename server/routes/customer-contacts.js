/**
 * A customer's contacts (/api/customers/:id/contacts; customerContacts.js). Anyone who may
 * open the customer reads them; managers and planners (who edit customers) change them.
 */
const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { canAccessCustomer } = require('../customerAccess');
const { logAudit } = require('../auditLog');
const contacts = require('../customerContacts');

const positive = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const editors = new Set(['manager', 'planner']);

router.use(requireAuth, async (req, res, next) => {
  if (!positive(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(Number(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (!await canAccessCustomer(req.user, customer.id)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'GET' && !editors.has(req.user.role)) return res.status(403).json({ error: 'Managers and planners change contacts' });
  req.customerId = customer.id;
  next();
});

router.get('/', async (req, res) => res.json(await contacts.list(db, req.customerId)));

router.post('/', async (req, res) => {
  const checked = contacts.check(req.body, { creating: true });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const id = await db.transaction(async tx => {
    const made = await contacts.create(tx, req.customerId, checked.value);
    await logAudit(tx, req, 'customer', req.customerId, null, 'contact_added', `contact_id=${made}`);
    return made;
  });
  res.status(201).json({ id, contacts: await contacts.list(db, req.customerId) });
});

router.put('/:contactId', async (req, res) => {
  if (!positive(req.params.contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
  const checked = contacts.check(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  try {
    const found = await db.transaction(async tx => {
      const changed = await contacts.update(tx, req.customerId, Number(req.params.contactId), checked.value);
      if (changed) await logAudit(tx, req, 'customer', req.customerId, null, 'contact_changed', `contact_id=${req.params.contactId}`);
      return changed;
    });
    if (!found) return res.status(404).json({ error: 'Contact not found' });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    throw error;
  }
  res.json({ contacts: await contacts.list(db, req.customerId) });
});

router.delete('/:contactId', async (req, res) => {
  if (!positive(req.params.contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
  const found = await db.transaction(async tx => {
    const removed = await contacts.remove(tx, req.customerId, Number(req.params.contactId));
    if (removed) await logAudit(tx, req, 'customer', req.customerId, null, 'contact_removed', `contact_id=${req.params.contactId}`);
    return removed;
  });
  if (!found) return res.status(404).json({ error: 'Contact not found' });
  res.json({ contacts: await contacts.list(db, req.customerId) });
});

module.exports = router;
