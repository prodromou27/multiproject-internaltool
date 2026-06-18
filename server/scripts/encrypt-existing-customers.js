/**
 * Idempotent backfill: encrypt any customer fields still stored as plaintext.
 *
 * Usage from server/:
 *   node scripts/encrypt-existing-customers.js
 *   node scripts/encrypt-existing-customers.js --dry
 *
 * Requires CUSTOMER_FIELD_KEY. Back up the key before running this in PROD.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const db = require('../db');
const { isConfigured, isEncrypted, encrypt, keyStatus } = require('../fieldCipher');

const DRY = process.argv.includes('--dry');
const CUSTOMER_FIELDS = ['name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes'];

async function main() {
  if (!isConfigured()) {
    console.error('ERROR: CUSTOMER_FIELD_KEY is not configured. Refusing to run.');
    process.exit(1);
  }

  const rows = await db.prepare('SELECT id, name, contact_name, contact_email, contact_phone, address, notes FROM customers').all();

  let rowsChanged = 0;
  let fieldsEncrypted = 0;

  await db.transaction(async (tx) => {
    const txUpdate = tx.prepare('UPDATE customers SET name=?, contact_name=?, contact_email=?, contact_phone=?, address=?, notes=? WHERE id=?');
    for (const row of rows) {
      const next = { ...row };
      let changed = false;

      for (const f of CUSTOMER_FIELDS) {
        const value = row[f];
        if (value !== null && value !== undefined && value !== '' && !isEncrypted(value)) {
          next[f] = encrypt(value);
          fieldsEncrypted++;
          changed = true;
        }
      }

      if (changed) {
        rowsChanged++;
        if (!DRY) {
          await txUpdate.run(next.name, next.contact_name, next.contact_email, next.contact_phone, next.address, next.notes, row.id);
        }
      }
    }
  });

  const key = keyStatus();
  console.log(`${DRY ? '[DRY RUN] ' : ''}Customer encryption key fingerprint: ${key.fingerprint}`);
  console.log(`${DRY ? '[DRY RUN] ' : ''}Scanned ${rows.length} customers.`);
  console.log(`${DRY ? 'Would encrypt' : 'Encrypted'} ${fieldsEncrypted} plaintext field(s) across ${rowsChanged} row(s).`);
  if (DRY) console.log('No changes were written (--dry).');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
