/**
 * AES-256-GCM file encryption utility.
 *
 * Set ATTACHMENT_KEY in .env (or process environment) to a 64-character
 * hex string (32 bytes = 256 bits).  Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If ATTACHMENT_KEY is not set, isConfigured() returns false and uploads
 * are stored as plain files (backward-compatible).
 */
const crypto = require('crypto');

const ALGO   = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV, recommended for GCM

function getKey() {
  const hex = process.env.ATTACHMENT_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    console.warn('[cipher] ATTACHMENT_KEY must be exactly 64 hex characters (32 bytes). Encryption disabled.');
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/** Returns true when a valid key is configured. */
function isConfigured() {
  return !!getKey();
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
 * Decrypt a Buffer.
 * @param {Buffer} buffer   Encrypted ciphertext
 * @param {string} ivHex    IV as hex string
 * @param {string} tagHex   GCM auth tag as hex string
 * @returns {Buffer}
 */
function decrypt(buffer, ivHex, tagHex) {
  const key = getKey();
  if (!key) throw new Error('ATTACHMENT_KEY is not configured — cannot decrypt');
  const iv       = Buffer.from(ivHex,  'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

module.exports = { isConfigured, encrypt, decrypt };
