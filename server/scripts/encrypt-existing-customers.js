/**
 * One-time (idempotent) backfill: encrypt any customer PII still stored as
 * plaintext at rest. Safe to run repeatedly — already-encrypted values are
 * detected by the `enc:` prefix and skipped.
 *
 * Usage (from the server/ directory):
 *   node scripts/encrypt-existing-customers.js          # apply
 *   node scripts/encrypt-existing-customers.js --dry    # report only, no writes
 *
 * Requires CUSTOMER_FIELD_KEY to be set (loaded from server/.env, same as the
 * app). If the key is missing the script refuses to run rather than silently
 * leaving data in plaintext.
 */
const fs = require('fs');
const path = require('path');

// Load .env exactly like the server does, so the key is available.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const db = require('../db');
const { isConfigured, encrypt } = require('../fieldCipher');

const DRY = process.argv.includes('--dry');
const PII_FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'address', 'notes'];

function isEnc(v) { return typeof v === 'string' && v.startsWith('enc:'); }

if (!isConfigured()) {
  console.error('ERROR: CUSTOMER_FIELD_KEY is not configured. Aborting — refusing to run without a key.');
  process.exit(1);
}

const rows = db.prepare('SELECT * FROM customers').all();
const update = db.prepare(
  'UPDATE customers SET contact_name=?, contact_email=?, contact_phone=?, address=?, notes=? WHERE id=?'
);

let rowsChanged = 0, fieldsEncrypted = 0;

const run = db.transaction(() => {
  for (const row of rows) {
    const next = {};
    let changed = false;
    for (const f of PII_FIELDS) {
      const val = row[f];
      if (val !== null && val !== '' && !isEnc(val)) {
        next[f] = encrypt(val);   // plaintext → ciphertext
        fieldsEncrypted++;
        changed = true;
      } else {
        next[f] = val;            // already encrypted, null, or empty — leave as-is
      }
    }
    if (changed) {
      rowsChanged++;
      if (!DRY) {
        update.run(next.contact_name, next.contact_email, next.contact_phone, next.address, next.notes, row.id);
      }
    }
  }
});

run();

console.log(`${DRY ? '[DRY RUN] ' : ''}Scanned ${rows.length} customers.`);
console.log(`${DRY ? 'Would encrypt' : 'Encrypted'} ${fieldsEncrypted} plaintext field(s) across ${rowsChanged} row(s).`);
if (DRY) console.log('No changes were written (--dry).');
