/**
 * AES-256-GCM file encryption utility.
 *
 * Set ATTACHMENT_KEY in .env (or process environment) to a 64-character
 * hex string (32 bytes = 256 bits).  Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If ATTACHMENT_KEY is not set, isConfigured() returns false and uploads
 * are stored as plain files (backward-compatible).
 *
 * Rotation: ATTACHMENT_KEYS_PREVIOUS may list retired keys (comma-separated).
 * They are only used to decrypt; new files are always encrypted with
 * ATTACHMENT_KEY. See keyring.js and docs/KEY_ROTATION.md.
 */
const crypto = require('crypto');
const { keyRing, fingerprint } = require('./keyring');

const ALGO   = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV, recommended for GCM

const ring = () => keyRing('ATTACHMENT_KEY');
function getKey() { return ring().current; }

/** Returns true when a valid key is configured. */
function isConfigured() {
  return !!getKey();
}

function keyStatus() {
  return { configured: isConfigured(), fingerprint: fingerprint(getKey()), previous_keys: Math.max(0, ring().keys.length - (getKey() ? 1 : 0)), key_env: 'ATTACHMENT_KEY' };
}

/**
 * Encrypt a Buffer.
 * @returns {{ data: Buffer, iv: string, tag: string }}
 */
function encrypt(buffer) {
  const key = getKey();
  if (!key) throw new Error('ATTACHMENT_KEY is not configured');
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag    = cipher.getAuthTag(); // 16-byte GCM auth tag
  return {
    data: encrypted,
    iv:   iv.toString('hex'),
    tag:  tag.toString('hex'),
  };
}

/**
 * Decrypt and report which key worked: { plaintext, onCurrentKey }.
 * Tries the current key first, then previous keys; throws if none can.
 */
function decryptDetailed(buffer, ivHex, tagHex) {
  const { current, keys } = ring();
  if (!keys.length) throw new Error('ATTACHMENT_KEY is not configured — cannot decrypt');
  const iv  = Buffer.from(ivHex,  'hex');
  const tag = Buffer.from(tagHex, 'hex');
  let lastError;
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return { plaintext: Buffer.concat([decipher.update(buffer), decipher.final()]), onCurrentKey: !!current && key.equals(current) };
    } catch (error) { lastError = error; } // GCM authentication failed: not this key
  }
  throw lastError;
}

/**
 * Decrypt a Buffer.
 * @param {Buffer} buffer   Encrypted ciphertext
 * @param {string} ivHex    IV as hex string
 * @param {string} tagHex   GCM auth tag as hex string
 * @returns {Buffer}
 */
function decrypt(buffer, ivHex, tagHex) {
  return decryptDetailed(buffer, ivHex, tagHex).plaintext;
}

module.exports = { isConfigured, keyStatus, encrypt, decrypt, decryptDetailed };
