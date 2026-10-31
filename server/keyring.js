/**
 * Key rings for zero-downtime key rotation.
 *
 * Each encrypted store has one *current* key (always used to encrypt) and an
 * optional comma-separated list of *previous* keys that are only used to
 * decrypt. Rotating is then: make the old key a previous key, set a new current
 * key, restart, run `node scripts/rotate-encryption.js` while the app keeps
 * serving, and drop the previous key once nothing still uses it
 * (docs/KEY_ROTATION.md).
 *
 * The stored format does not change: AES-256-GCM authenticates, so decrypting
 * with the wrong key fails cleanly and each known key can simply be tried in
 * turn. The current key is tried first, so values already on it cost nothing
 * extra, and an older app version can still read everything.
 */
const crypto = require('crypto');

const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const cache = new Map();

/** Parse "k1,k2" into hex keys; blank entries are ignored. */
function splitKeys(value) {
  return String(value || '').split(',').map(key => key.trim()).filter(Boolean);
}

/**
 * The key ring for one store, e.g. keyRing('CUSTOMER_FIELD_KEY').
 * Returns { current: Buffer|null, keys: Buffer[] } where keys lists the current
 * key first, then previous keys, without duplicates. Invalid keys are skipped
 * here; config.js refuses to start with them in the first place.
 */
function keyRing(envName, env = process.env) {
  const currentHex = env[envName] || '';
  const previousHex = env[`${envName}S_PREVIOUS`] || '';
  const cacheKey = `${currentHex}\0${previousHex}`;
  const cached = cache.get(envName);
  if (cached && cached.cacheKey === cacheKey) return cached.ring;
  const current = HEX_KEY.test(currentHex) ? Buffer.from(currentHex, 'hex') : null;
  const keys = [];
  const seen = new Set();
  for (const hex of [currentHex, ...splitKeys(previousHex)]) {
    if (!HEX_KEY.test(hex) || seen.has(hex.toLowerCase())) continue;
    seen.add(hex.toLowerCase());
    keys.push(Buffer.from(hex, 'hex'));
  }
  const ring = { current, keys };
  cache.set(envName, { cacheKey, ring }); // one entry per store; rebuilt only when its env changes
  return ring;
}

/** Short, non-reversible identifier for a key, safe to show in status pages. */
function fingerprint(key) {
  return key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 12) : null;
}

module.exports = { keyRing, splitKeys, fingerprint, HEX_KEY };
