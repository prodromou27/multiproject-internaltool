/**
 * Helpers shared across the settings/ sub-routers (split out of the former
 * single routes/settings.js — see routes/settings.js for how these mount).
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { isEncrypted } = require('../../fieldCipher');
const { logAudit } = require('../../auditLog');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

async function logSettingsChange(req, action, detail = null) {
  await logAudit(db, req, 'settings', action, 'Settings', action, detail);
}

function bytes(n) {
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function directoryBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directoryBytes(p);
      else total += fs.statSync(p).size;
    } catch {}
  }
  return total;
}

async function customerEncryptionReport() {
  // Must match fieldCipher.js's encryptCustomer/decryptCustomer field list exactly.
  const fields = ['name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes', 'primary_contact', 'location', 'service_notes'];
  const rows = await db.prepare(`SELECT id, ${fields.join(', ')} FROM customers`).all();
  let plaintext_fields = 0;
  let encrypted_fields = 0;
  let affected_rows = 0;

  for (const row of rows) {
    let rowHasPlaintext = false;
    for (const f of fields) {
      const value = row[f];
      if (value === null || value === undefined || value === '') continue;
      if (isEncrypted(value)) encrypted_fields++;
      else {
        plaintext_fields++;
        rowHasPlaintext = true;
      }
    }
    if (rowHasPlaintext) affected_rows++;
  }

  return {
    rows: rows.length,
    encrypted_fields,
    plaintext_fields,
    affected_rows,
  };
}

module.exports = { isPlainObject, bool, logSettingsChange, bytes, directoryBytes, customerEncryptionReport };
