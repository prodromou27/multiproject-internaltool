/**
 * Customer import (Customers → Import): rows from an Excel or CSV file become
 * customers. A row may mark the customer as managed (managed services on, which
 * also turns on activity tracking, as Service Configuration does) and name the
 * team that serves it (linked, and the responsible team when managed). Customers
 * that already exist are skipped, or updated when asked. A row may also carry a
 * contract (reference, contract type, start and end dates): added to the customer,
 * or updated when the customer already has a contract with that reference.
 */
const db = require('./db');
const { encryptCustomer, decryptCustomer, encrypt, decrypt } = require('./fieldCipher');
const { replaceCustomerSearchDocument } = require('./customerSearchIndex');

const TEXT_FIELDS = ['project_name', 'customer_code', 'contact_name', 'contact_email', 'contact_phone', 'primary_contact', 'location', 'address', 'notes'];
const COLUMNS = ['name*', 'project_name', 'customer_code', 'contact_name', 'contact_email', 'contact_phone', 'primary_contact', 'location', 'address', 'notes', 'managed', 'team',
  'contract_reference', 'contract_type', 'contract_start', 'contract_end'];
const YES = new Set(['yes', 'y', 'true', '1', 'x', 'managed']);
const NO = new Set(['', 'no', 'n', 'false', '0', '-']);
const MAX_LENGTH = { name: 300, project_name: 120, customer_code: 100, contact_email: 320, notes: 5000 };

/** CSV text → rows of { header: value }. Handles quotes, "" escapes, CRLF, a BOM, and ; or tab separators (Excel in many locales). */
function parseCsv(text) {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map(sep => [sep, firstLine.split(sep).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const records = [];
  let field = '', record = [], quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += ch;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  const [headers = [], ...rows] = records.filter(r => r.some(cell => cell.trim() !== ''));
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']).filter(([h]) => h.trim())));
}

/** A date as YYYY-MM-DD, from YYYY-MM-DD or DD/MM/YYYY (also with . or -); null when it is not a real date. */
function parseDay(text) {
  const value = String(text || '').trim();
  let y, m, d, match;
  if ((match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = match;
  else if ((match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match;
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** The contract on a row, checked: null when the row has none. */
function contractOf(row, types) {
  const given = ['contract_reference', 'contract_type', 'contract_start', 'contract_end'].some(key => row[key]);
  if (!given) return { value: null };
  if (!row.contract_reference) return { error: 'contract_reference is needed when contract columns are filled in' };
  if (row.contract_reference.length > 100) return { error: 'contract_reference is longer than 100 characters' };
  const type = row.contract_type ? types.find(t => t.toLowerCase() === row.contract_type.toLowerCase()) : null;
  if (row.contract_type && !type) return { error: `contract_type "${row.contract_type}" is not one of the contract types (${types.join(', ') || 'none set up'})` };
  const start = parseDay(row.contract_start), end = parseDay(row.contract_end);
  if (!start || !end) return { error: 'contract_start and contract_end must be dates (YYYY-MM-DD or DD/MM/YYYY)' };
  if (end < start) return { error: 'contract_end is before contract_start' };
  return { value: { reference: row.contract_reference, service_level: type, start_date: start, end_date: end } };
}

async function saveContract(tx, customerId, contract, userId) {
  const existing = (await tx.prepare('SELECT id, reference FROM customer_contracts WHERE customer_id = ?').all(customerId))
    .find(c => (decrypt(c.reference) || '').toLowerCase() === contract.reference.toLowerCase());
  const now = new Date().toISOString();
  if (existing) {
    await tx.prepare('UPDATE customer_contracts SET service_level = COALESCE(?, service_level), start_date = ?, end_date = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(contract.service_level, contract.start_date, contract.end_date, userId, now, existing.id);
  } else {
    await tx.prepare('INSERT INTO customer_contracts (customer_id, reference, service_level, start_date, end_date, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(customerId, encrypt(contract.reference), contract.service_level, contract.start_date, contract.end_date, userId, userId, now, now);
  }
}

const normalizeKey = key => key.replace(/\*/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeRow = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), String(v ?? '').trim()]));

function yesNo(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return null;
}

async function enableManaged(tx, customerId, teamId, userId) {
  const current = await tx.prepare('SELECT version FROM managed_customer_configurations WHERE customer_id = ?').get(customerId);
  if (current) {
    await tx.prepare(`UPDATE managed_customer_configurations SET managed_services_enabled = 1, responsible_team_id = COALESCE(?, responsible_team_id),
      version = version + 1, updated_by = ?, updated_at = app_now() WHERE customer_id = ?`).run(teamId, userId, customerId);
  } else {
    await tx.exec(`INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled, responsible_team_id, version, updated_by)
      VALUES (${Number(customerId)}, 1, ${teamId ? Number(teamId) : 'NULL'}, 1, ${Number(userId)})`);
  }
  // A managed customer is always tracked, so its engineers can log work against it.
  await tx.prepare('UPDATE customers SET service_activity_enabled = 1 WHERE id = ?').run(customerId);
}

async function linkTeam(tx, customerId, teamId) {
  if (!teamId) return;
  if (!await tx.prepare('SELECT 1 FROM customer_teams WHERE customer_id = ? AND team_id = ?').get(customerId, teamId))
    await tx.exec(`INSERT INTO customer_teams (customer_id, team_id) VALUES (${Number(customerId)}, ${Number(teamId)})`);
}

/**
 * What importing the rows would do, without changing anything (review I07): per row
 * 'create', 'update' (with the fields that would change), 'unchanged' or 'error'
 * (with the reason, and the row as given so a correction file can be made).
 * `token` binds a commit to this preview: it changes when the file or any matched
 * customer changes.
 */
async function planCustomerImport(rawRows, { user, store = db, fileHash = '' } = {}) {
  const teams = new Map((await store.prepare('SELECT id, name FROM teams').all()).map(t => [t.name.trim().toLowerCase(), Number(t.id)]));
  const existing = new Map((await store.prepare('SELECT * FROM customers').all()).map(decryptCustomer)
    .filter(c => c.name).map(c => [c.name.trim().toLowerCase(), c]));
  const types = await require('./customerContracts').contractTypes(store);
  const links = new Set((await store.prepare('SELECT customer_id, team_id FROM customer_teams').all()).map(l => `${l.customer_id}:${l.team_id}`));
  const managedNow = new Set((await store.prepare('SELECT customer_id FROM managed_customer_configurations WHERE managed_services_enabled = 1').all()).map(m => Number(m.customer_id)));
  const contractsOf = new Map();
  for (const c of await store.prepare('SELECT customer_id, reference, service_level, start_date, end_date FROM customer_contracts').all()) {
    const list = contractsOf.get(Number(c.customer_id)) || [];
    list.push({ ...c, reference: decrypt(c.reference) || '' });
    contractsOf.set(Number(c.customer_id), list);
  }
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = normalizeRow(rawRows[i]), rowNum = i + 2;
    const fail = (error, kind = 'invalid') => rows.push({ row: rowNum, name: row.name || '', action: 'error', kind, error, values: row });
    if (!row.name) { fail('Missing required field: name'); continue; }
    const key = row.name.toLowerCase();
    if (seen.has(key)) { fail(`"${row.name}" appears more than once in the file`, 'duplicate'); continue; }
    seen.add(key);
    const tooLong = Object.entries(MAX_LENGTH).find(([field, max]) => (row[field] || '').length > max);
    if (tooLong) { fail(`${tooLong[0]} is longer than ${tooLong[1]} characters`); continue; }
    if (row.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact_email)) { fail(`"${row.contact_email}" is not an email address`); continue; }
    const managed = yesNo(row.managed);
    if (managed === null) { fail(`managed must be yes or no, not "${row.managed}"`); continue; }
    if (managed && user.role !== 'manager') { fail('Only managers can mark customers as managed'); continue; }
    let teamId = null;
    if (row.team) {
      teamId = teams.get(row.team.toLowerCase());
      if (!teamId) { fail(`Team "${row.team}" not found`); continue; }
    }
    const contract = contractOf(row, types);
    if (contract.error) { fail(contract.error); continue; }
    const current = existing.get(key);
    const plan = { row: rowNum, name: row.name, values: row, managed, teamId, contract: contract.value };
    if (!current) { rows.push({ ...plan, action: 'create' }); continue; }
    // Only the columns filled in on the row change.
    const changes = TEXT_FIELDS.filter(f => row[f] && row[f] !== (current[f] || '')).map(f => ({ field: f, from: current[f] || '', to: row[f] }));
    if (teamId && !links.has(`${current.id}:${teamId}`)) changes.push({ field: 'team', from: '', to: row.team });
    if (managed && !managedNow.has(Number(current.id))) changes.push({ field: 'managed', from: 'no', to: 'yes' });
    if (contract.value) {
      const had = (contractsOf.get(Number(current.id)) || []).find(c => c.reference.toLowerCase() === contract.value.reference.toLowerCase());
      const describe = c => `${c.reference}: ${c.start_date} to ${c.end_date}${c.service_level ? ` (${c.service_level})` : ''}`;
      if (!had || had.start_date !== contract.value.start_date || had.end_date !== contract.value.end_date || (contract.value.service_level && had.service_level !== contract.value.service_level))
        changes.push({ field: 'contract', from: had ? describe(had) : '', to: describe({ ...contract.value, service_level: contract.value.service_level || had?.service_level }) });
    }
    rows.push({ ...plan, action: changes.length ? 'update' : 'unchanged', existing_id: Number(current.id), edit_version: Number(current.edit_version), current, changes });
  }
  const count = action => rows.filter(r => r.action === action).length;
  const counts = { create: count('create'), update: count('update'), unchanged: count('unchanged'), errors: count('error'), duplicates: rows.filter(r => r.kind === 'duplicate').length, total: rows.length };
  const matched = rows.filter(r => r.existing_id).map(r => `${r.existing_id}:${r.edit_version}`).join(',');
  const token = require('node:crypto').createHash('sha256').update(`${fileHash}|${user.id}|${matched}`).digest('hex');
  return { rows, counts, token };
}

/** The preview as sent to the browser (no internal records). */
const previewOf = plan => ({ token: plan.token, counts: plan.counts,
  rows: plan.rows.map(({ row, name, action, kind, error, changes, existing_id, values }) => ({ row, name, action, kind, error, changes, existing_id, values: action === 'error' ? values : undefined })) });

/**
 * Imports rows. Returns { imported, updated, unchanged, managed, skipped, errors }. Per row,
 * not all-or-nothing: bad rows are reported and the rest go in. Existing customers
 * are only changed when updateExisting is set; a row that would change nothing is
 * left alone, so importing the same file again changes nothing.
 */
async function importCustomers(rawRows, { user, updateExisting = false, store = db, plan = null } = {}) {
  plan ||= await planCustomerImport(rawRows, { user, store });
  const result = { imported: 0, updated: 0, unchanged: 0, managed: 0, contracts: 0, skipped: 0, errors: [] };
  const skip = (row, error) => { result.errors.push({ row, error }); result.skipped++; };

  for (const item of plan.rows) {
    const { row: rowNum, values: row, managed, teamId, contract, current } = item;
    if (item.action === 'error') { skip(rowNum, item.error); continue; }
    if (current && !updateExisting) { skip(rowNum, `Customer "${row.name}" already exists — skipped`); continue; }
    if (item.action === 'unchanged') { result.unchanged++; continue; }
    try {
      await store.transaction(async tx => {
        if (current) {
          const merged = { ...current, ...Object.fromEntries(TEXT_FIELDS.filter(f => row[f]).map(f => [f, row[f]])) };
          const enc = encryptCustomer(merged);
          // Changed since it was read (someone saved it meanwhile): left alone and reported.
          const changed = await tx.prepare(`UPDATE customers SET project_name = ?, customer_code = ?, contact_name = ?, contact_email = ?, contact_phone = ?, primary_contact = ?, location = ?, address = ?, notes = ?, edit_version = edit_version + 1 WHERE id = ? AND edit_version = ?`)
            .run(enc.project_name, merged.customer_code || null, enc.contact_name, enc.contact_email, enc.contact_phone, enc.primary_contact, enc.location, enc.address, enc.notes, current.id, current.edit_version);
          if (!changed.changes) throw new Error(`Customer "${row.name}" was changed by someone else during the import — not updated`);
          await replaceCustomerSearchDocument(tx, { id: current.id, name: current.name, project_name: merged.project_name, contact_name: merged.contact_name, contact_email: merged.contact_email, address: merged.address, location: merged.location, customer_code: merged.customer_code });
          await linkTeam(tx, current.id, teamId);
          if (managed) await enableManaged(tx, current.id, teamId, user.id);
          if (contract) await saveContract(tx, current.id, contract, user.id);
        } else {
          const values = Object.fromEntries(TEXT_FIELDS.map(f => [f, row[f] || null]));
          const enc = encryptCustomer({ name: row.name, ...values });
          const created = await tx.prepare(`INSERT INTO customers (name, project_name, customer_code, contact_name, contact_email, contact_phone, primary_contact, location, address, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(enc.name, enc.project_name, values.customer_code, enc.contact_name, enc.contact_email, enc.contact_phone, enc.primary_contact, enc.location, enc.address, enc.notes, user.id);
          const id = created.lastInsertRowid;
          await replaceCustomerSearchDocument(tx, { id, name: row.name, ...values });
          await linkTeam(tx, id, teamId);
          if (managed) await enableManaged(tx, id, teamId, user.id);
          if (contract) await saveContract(tx, id, contract, user.id);
        }
      });
      if (current) result.updated++; else result.imported++;
      if (managed) result.managed++;
      if (contract) result.contracts++;
    } catch (error) {
      skip(rowNum, error.message);
    }
  }
  // Contracts and managed services may have changed: asset coverage follows them.
  if (result.managed || result.contracts) await require('./assetCoverage').syncCoverage({ store, userId: user.id });
  return result;
}

module.exports = { COLUMNS, parseCsv, parseDay, yesNo, planCustomerImport, previewOf, importCustomers };
