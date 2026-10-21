/**
 * A customer's contacts: any number, one of them primary. Name, role, email, phone and
 * notes are encrypted like the customer's own fields. The primary contact is mirrored
 * into the customer's contact_name / contact_email / contact_phone, which reports,
 * search, visits and response texts already use, so they follow it without change.
 */
const { encrypt, decrypt, decryptCustomer } = require('./fieldCipher');
const { replaceCustomerSearchDocument } = require('./customerSearchIndex');

const FIELDS = Object.freeze({ name: 200, role: 120, email: 320, phone: 60, notes: 2000 });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const decryptContact = row => ({
  id: Number(row.id), customer_id: Number(row.customer_id), is_primary: !!row.is_primary,
  name: decrypt(row.name) || '', role: decrypt(row.role) || '', email: decrypt(row.email) || '', phone: decrypt(row.phone) || '', notes: decrypt(row.notes) || '',
  created_at: row.created_at, updated_at: row.updated_at,
});

async function list(store, customerId) {
  const rows = await store.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, id').all(customerId);
  return rows.map(decryptContact);
}

/** A contact from a request: { value } (trimmed text; is_primary when sent) or { error }. */
function check(body, { creating = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A JSON object is required' };
  const value = {};
  for (const [field, max] of Object.entries(FIELDS)) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== 'string') return { error: `${field} must be text` };
    const text = (body[field] || '').trim();
    if (text.length > max) return { error: `${field} cannot exceed ${max} characters` };
    value[field] = text;
  }
  if (value.email && !EMAIL.test(value.email)) return { error: 'Enter a valid email address' };
  if (body.is_primary !== undefined) {
    if (typeof body.is_primary !== 'boolean') return { error: 'is_primary must be true or false' };
    value.is_primary = body.is_primary;
  }
  if (creating && !value.name && !value.email) return { error: 'Give the contact a name or an email address' };
  return { value };
}

/** Copies the primary contact into the customer's own contact fields, and refreshes search. */
async function mirrorPrimary(store, customerId) {
  const primary = await store.prepare('SELECT name, email, phone FROM customer_contacts WHERE customer_id = ? AND is_primary = 1').get(customerId);
  // A customer form opened before this change then gets "changed meanwhile" instead of writing back the old contact.
  await store.prepare('UPDATE customers SET contact_name = ?, contact_email = ?, contact_phone = ?, edit_version = edit_version + 1 WHERE id = ?')
    .run(primary?.name || null, primary?.email || null, primary?.phone || null, customerId);
  const customer = decryptCustomer(await store.prepare('SELECT * FROM customers WHERE id = ?').get(customerId));
  if (customer) await replaceCustomerSearchDocument(store, customer);
}

/** The customer's own contact fields (as just saved from the customer form or an import) → its primary contact. */
async function primaryFromCustomer(store, customerId) {
  const customer = await store.prepare('SELECT contact_name, contact_email, contact_phone FROM customers WHERE id = ?').get(customerId);
  if (!customer) return;
  const primary = await store.prepare('SELECT id FROM customer_contacts WHERE customer_id = ? AND is_primary = 1').get(customerId);
  const empty = !customer.contact_name && !customer.contact_email && !customer.contact_phone;
  if (primary) await store.prepare('UPDATE customer_contacts SET name = ?, email = ?, phone = ?, updated_at = app_now() WHERE id = ?').run(customer.contact_name, customer.contact_email, customer.contact_phone, primary.id);
  else if (!empty) await store.prepare('INSERT INTO customer_contacts (customer_id, name, email, phone, is_primary) VALUES (?, ?, ?, ?, 1)').run(customerId, customer.contact_name, customer.contact_email, customer.contact_phone);
}

async function create(store, customerId, value) {
  const hasPrimary = !!await store.prepare('SELECT 1 FROM customer_contacts WHERE customer_id = ? AND is_primary = 1').get(customerId);
  const primary = value.is_primary === true || !hasPrimary;   // the first contact is the primary one
  if (primary && hasPrimary) await store.prepare('UPDATE customer_contacts SET is_primary = 0 WHERE customer_id = ?').run(customerId);
  const made = await store.prepare('INSERT INTO customer_contacts (customer_id, name, role, email, phone, notes, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(customerId, encrypt(value.name), encrypt(value.role), encrypt(value.email), encrypt(value.phone), encrypt(value.notes), primary ? 1 : 0);
  if (primary) await mirrorPrimary(store, customerId);
  return made.lastInsertRowid;
}

async function update(store, customerId, contactId, value) {
  const current = await store.prepare('SELECT * FROM customer_contacts WHERE id = ? AND customer_id = ?').get(contactId, customerId);
  if (!current) return false;
  const next = { ...decryptContact(current), ...value };
  if (!next.name && !next.email) throw Object.assign(new Error('Give the contact a name or an email address'), { status: 400 });
  if (value.is_primary === true && !current.is_primary) await store.prepare('UPDATE customer_contacts SET is_primary = 0 WHERE customer_id = ?').run(customerId);
  // The primary stays primary until another is chosen (a customer with contacts always has one).
  const primary = value.is_primary === true || !!current.is_primary;
  await store.prepare('UPDATE customer_contacts SET name = ?, role = ?, email = ?, phone = ?, notes = ?, is_primary = ?, updated_at = app_now() WHERE id = ?')
    .run(encrypt(next.name), encrypt(next.role), encrypt(next.email), encrypt(next.phone), encrypt(next.notes), primary ? 1 : 0, contactId);
  if (primary) await mirrorPrimary(store, customerId);
  return true;
}

async function remove(store, customerId, contactId) {
  const current = await store.prepare('SELECT id, is_primary FROM customer_contacts WHERE id = ? AND customer_id = ?').get(contactId, customerId);
  if (!current) return false;
  await store.prepare('DELETE FROM customer_contacts WHERE id = ?').run(contactId);
  if (current.is_primary) {
    // The oldest remaining contact becomes the primary one.
    const next = await store.prepare('SELECT id FROM customer_contacts WHERE customer_id = ? ORDER BY id LIMIT 1').get(customerId);
    if (next) await store.prepare('UPDATE customer_contacts SET is_primary = 1 WHERE id = ?').run(next.id);
    await mirrorPrimary(store, customerId);
  }
  return true;
}

module.exports = { list, check, create, update, remove, primaryFromCustomer, mirrorPrimary, decryptContact, FIELDS };
