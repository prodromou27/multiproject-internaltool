/**
 * Field-level AES-256-GCM encryption for sensitive database columns.
 *
 * Encrypted values are stored as a compact prefixed string:
 *   enc:<iv_hex>.<tag_hex>.<ciphertext_base64>
 *
 * Plaintext values are stored and returned as-is outside production when
 * CUSTOMER_FIELD_KEY is not configured. Production config validation requires
 * the key so customer data is encrypted at rest.
 *
 * Set CUSTOMER_FIELD_KEY in .env to a 64-character hex string (32 bytes):
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

const ALGO    = 'aes-256-gcm';
const IV_LEN  = 12;   // 96-bit IV, recommended for GCM
const PREFIX  = 'enc:';

// Memoize the derived key buffer. Re-derives only if CUSTOMER_FIELD_KEY changes
// (e.g. in tests), so the hot path — called per field per row per request — is
// a cheap string comparison rather than a Buffer.from() + length check every time.
let _cachedHex = null;
let _cachedKey = null;

function getKey() {
  const hex = process.env.CUSTOMER_FIELD_KEY;
  if (!hex) { _cachedHex = null; _cachedKey = null; return null; }
  if (hex === _cachedHex) return _cachedKey;

  _cachedHex = hex;
  if (hex.length !== 64) {
    console.warn('[fieldCipher] CUSTOMER_FIELD_KEY must be exactly 64 hex chars. Encryption disabled.');
    _cachedKey = null;
    return null;
  }
  _cachedKey = Buffer.from(hex, 'hex');
  return _cachedKey;
}

/** Returns true when a valid key is configured. */
function isConfigured() { return !!getKey(); }

/** Returns true if value is already encrypted. */
function isEncrypted(v) { return typeof v === 'string' && v.startsWith(PREFIX); }

function keyFingerprint() {
  const key = getKey();
  if (!key) return null;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function keyStatus() {
  return {
    configured: isConfigured(),
    fingerprint: keyFingerprint(),
    algorithm: ALGO,
    key_env: 'CUSTOMER_FIELD_KEY',
  };
}

/**
 * Encrypt a plain text string.
 * @param {string|null} plaintext
 * @returns {string|null}  Encrypted string (enc:iv.tag.ct) or null if input is null/empty.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const key = getKey();
  if (!key) return plaintext; // no key → store as-is

  const iv       = crypto.randomBytes(IV_LEN);
  const cipher   = crypto.createCipheriv(ALGO, key, iv);
  const ct       = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag      = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}.${tag.toString('hex')}.${ct.toString('base64')}`;
}

/**
 * Decrypt an encrypted field value.
 * @param {string|null} value  Stored value (may be plaintext or encrypted)
 * @returns {string|null}
 */
function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value; // plaintext passthrough

  const key = getKey();
  if (!key) {
    // Key removed after encryption — cannot decrypt, return marker
    console.error('[fieldCipher] Encrypted value found but CUSTOMER_FIELD_KEY is not set');
    return '[encrypted]';
  }

  try {
    const rest   = value.slice(PREFIX.length);
    const parts  = rest.split('.');
    if (parts.length !== 3) throw new Error('bad format');
    const [ivHex, tagHex, ctB64] = parts;
    const iv      = Buffer.from(ivHex,  'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const ct      = Buffer.from(ctB64,  'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[fieldCipher] Decryption failed:', e.message);
    return '[decryption error]';
  }
}

/**
 * Encrypt all PII fields of a customer record object (in place).
 * @param {object} fields  { name, contact_name, contact_email, contact_phone, address, notes }
 * @returns {object}  New object with encrypted values
 */
function encryptCustomer(fields) {
  return {
    name:          encrypt(fields.name),
    contact_name:  encrypt(fields.contact_name),
    contact_email: encrypt(fields.contact_email),
    contact_phone: encrypt(fields.contact_phone),
    address:       encrypt(fields.address),
    notes:         encrypt(fields.notes),
  };
}

/**
 * Decrypt all PII fields of a customer row returned from the DB.
 * @param {object} row  Database row
 * @returns {object}  Row with decrypted values
 */
function decryptCustomer(row) {
  if (!row) return row;
  return {
    ...row,
    name:          decrypt(row.name),
    contact_name:  decrypt(row.contact_name),
    contact_email: decrypt(row.contact_email),
    contact_phone: decrypt(row.contact_phone),
    address:       decrypt(row.address),
    notes:         decrypt(row.notes),
  };
}

module.exports = { isConfigured, isEncrypted, keyStatus, encrypt, decrypt, encryptCustomer, decryptCustomer };
