/* 2FA seeds are stored encrypted with the field key (CUSTOMER_FIELD_KEY), like the
   other secrets, so a copy of the database or a backup does not reveal them. Key
   rotation re-encrypts them with every other encrypted column. */
const { encrypt, decrypt, isConfigured, isEncrypted } = require('./fieldCipher');

const seal = seed => encrypt(seed);
const open = stored => decrypt(stored);

/** Encrypts seeds saved before they were encrypted. Returns how many were changed. */
async function encryptStoredSeeds(store) {
  if (!isConfigured()) return 0;
  const rows = await store.prepare('SELECT id, totp_secret, totp_pending_secret FROM users WHERE totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL').all();
  let changed = 0;
  for (const row of rows) {
    if (isEncrypted(row.totp_secret ?? 'enc:') && isEncrypted(row.totp_pending_secret ?? 'enc:')) continue;
    const next = value => (value && !isEncrypted(value) ? seal(value) : value);
    await store.prepare('UPDATE users SET totp_secret = ?, totp_pending_secret = ? WHERE id = ?').run(next(row.totp_secret), next(row.totp_pending_secret), row.id);
    changed += 1;
  }
  return changed;
}

module.exports = { seal, open, encryptStoredSeeds };
