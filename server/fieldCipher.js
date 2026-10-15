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
 *
 * Rotation: CUSTOMER_FIELD_KEYS_PREVIOUS may list retired keys (comma-separated).
 * They are only used to decrypt; new values are always encrypted with
 * CUSTOMER_FIELD_KEY. See keyring.js and docs/KEY_ROTATION.md.
 */
const crypto = require('crypto');
const { keyRing, fingerprint } = require('./keyring');

const ALGO    = 'aes-256-gcm';
const IV_LEN  = 12;   // 96-bit IV, recommended for GCM
const PREFIX  = 'enc:';

// The key ring is memoized in keyring.js and only rebuilt when the environment
// changes (e.g. in tests), so the hot path stays a cheap lookup.
const ring = () => keyRing('CUSTOMER_FIELD_KEY');
function getKey() { return ring().current; }

/** Returns true when a valid key is configured. */
function isConfigured() { return !!getKey(); }

/** Returns true if value is already encrypted. */
function isEncrypted(v) { return typeof v === 'string' && v.startsWith(PREFIX); }

function keyFingerprint() { return fingerprint(getKey()); }

function keyStatus() {
  return {
    configured: isConfigured(),
    fingerprint: keyFingerprint(),
    previous_keys: Math.max(0, ring().keys.length - (getKey() ? 1 : 0)),
    algorithm: ALGO,
    key_env: 'CUSTOMER_FIELD_KEY',
  };
}

function searchTokenHash(value) {
  const key=getKey();
  if (!key || typeof value!=='string' || !value) return null;
  return crypto.createHmac('sha256',key).update('customer-search-v1\0').update(value).digest('hex');
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

function parse(value) {
  const parts = value.slice(PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('bad format');
  const [ivHex, tagHex, ctB64] = parts;
  return { iv: Buffer.from(ivHex, 'hex'), tag: Buffer.from(tagHex, 'hex'), ct: Buffer.from(ctB64, 'base64') };
}

function decryptWith(key, { iv, tag, ct }) {
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Decrypt and report which key worked: { plaintext, onCurrentKey }.
 * Throws when no known key can decrypt the value. Plaintext values are
 * returned as-is with onCurrentKey true (nothing to re-encrypt).
 */
function decryptDetailed(value) {
  if (!isEncrypted(value)) return { plaintext: value, onCurrentKey: true };
  const { current, keys } = ring();
  if (!keys.length) throw new Error('CUSTOMER_FIELD_KEY is not set');
  const parts = parse(value);
  let lastError;
  for (const key of keys) {
    try { return { plaintext: decryptWith(key, parts), onCurrentKey: !!current && key.equals(current) }; }
    catch (error) { lastError = error; } // GCM authentication failed: not this key
  }
  throw lastError;
}

/**
 * Decrypt an encrypted field value, trying the current key and then any
 * previous keys.
 * @param {string|null} value  Stored value (may be plaintext or encrypted)
 * @returns {string|null}
 */
function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isEncrypted(value)) return value; // plaintext passthrough
  if (!ring().keys.length) {
    // Key removed after encryption — cannot decrypt, return marker
    console.error('[fieldCipher] Encrypted value found but CUSTOMER_FIELD_KEY is not set');
    return '[encrypted]';
  }
  try {
    return decryptDetailed(value).plaintext;
  } catch (e) {
    console.error('[fieldCipher] Decryption failed:', e.message);
    return '[decryption error]';
  }
}

/**
 * For key rotation: the value encrypted with the current key, or null when it
 * already is (or is plaintext / empty). Throws if no known key can read it, so a
 * rotation never overwrites a value it could not decrypt.
 */
function reencrypt(value) {
  if (!isEncrypted(value)) return null;
  if (!getKey()) throw new Error('CUSTOMER_FIELD_KEY is not set');
  const { plaintext, onCurrentKey } = decryptDetailed(value);
  return onCurrentKey ? null : encrypt(plaintext);
}

/**
 * Encrypt all PII fields of a customer record object (in place).
 * @param {object} fields  { name, contact_name, contact_email, contact_phone, address, notes }
 * @returns {object}  New object with encrypted values
 */
function encryptCustomer(fields) {
  return {
    name:            encrypt(fields.name),
    contact_name:    encrypt(fields.contact_name),
    contact_email:   encrypt(fields.contact_email),
    contact_phone:   encrypt(fields.contact_phone),
    address:         encrypt(fields.address),
    notes:           encrypt(fields.notes),
    primary_contact: encrypt(fields.primary_contact),
    location:        encrypt(fields.location),
    service_notes:   encrypt(fields.service_notes),
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
    name:            decrypt(row.name),
    contact_name:    decrypt(row.contact_name),
    contact_email:   decrypt(row.contact_email),
    contact_phone:   decrypt(row.contact_phone),
    address:         decrypt(row.address),
    notes:           decrypt(row.notes),
    primary_contact: row.primary_contact !== undefined ? decrypt(row.primary_contact) : undefined,
    location:        row.location        !== undefined ? decrypt(row.location)        : undefined,
    service_notes:   row.service_notes   !== undefined ? decrypt(row.service_notes)   : undefined,
  };
}

module.exports = { isConfigured, isEncrypted, keyStatus, searchTokenHash, encrypt, decrypt, decryptDetailed, reencrypt, encryptCustomer, decryptCustomer };
