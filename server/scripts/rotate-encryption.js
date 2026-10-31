/**
 * Zero-downtime key rotation: re-encrypt everything still on a previous key,
 * while the app keeps running. See docs/KEY_ROTATION.md for the full procedure.
 *
 * Usage from server/ (same environment as the app, including the *_PREVIOUS keys):
 *   node scripts/rotate-encryption.js --check   # report only, writes nothing
 *   node scripts/rotate-encryption.js           # re-encrypt, then report
 *
 * Exit code 0 means nothing is left on a previous key and nothing was
 * unreadable, so the previous keys can be removed. Safe to re-run.
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
const fieldCipher = require('../fieldCipher');
const fileCipher = require('../cipher');
const { rotateAll } = require('../keyRotation');

const CHECK = process.argv.includes('--check');

function report(label, s) {
  const pending = CHECK ? s.reencrypted : 0;
  console.log(`${label}: scanned ${s.scanned}, already on current key ${s.onCurrentKey}, ${CHECK ? 'on a previous key' : 're-encrypted'} ${s.reencrypted}`
    + `${s.skippedChanged ? `, changed by the app meanwhile ${s.skippedChanged}` : ''}${s.missing ? `, file missing on disk ${s.missing}` : ''}`);
  for (const item of s.unreadable) console.log(`  UNREADABLE with every known key: ${item}`);
  return pending + s.unreadable.length + (s.skippedChanged || 0);
}

async function main() {
  const fieldKey = fieldCipher.keyStatus(), fileKey = fileCipher.keyStatus();
  if (!fieldKey.configured) throw new Error('CUSTOMER_FIELD_KEY is not configured');
  console.log(`Field key ${fieldKey.fingerprint} (+${fieldKey.previous_keys} previous); file key ${fileKey.fingerprint || 'not configured'} (+${fileKey.previous_keys || 0} previous)`);
  console.log(CHECK ? 'Checking (no changes will be written)...' : 'Re-encrypting onto the current keys...');
  // No db.init(): the running app owns migrations and seeding; this only reads and updates rows.
  const result = await rotateAll({ dryRun: CHECK, log: line => process.env.ROTATE_VERBOSE && console.log(`  ${line}`) });
  let outstanding = report('Database values', result.fields) + report('Encrypted files', result.files);
  if (!CHECK && (result.fields.skippedChanged || result.files.skippedChanged)) {
    console.log('Some items changed while running; run again to confirm they are on the current key.');
  }
  if (outstanding === 0) console.log('Done: everything is on the current keys. The previous keys can now be removed.');
  else console.log(CHECK ? 'Not finished: run without --check to re-encrypt.' : 'Not finished yet: run again (or investigate unreadable items) before removing previous keys.');
  return outstanding === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(error => { console.error(error.message); process.exit(2); });
