/**
 * Zero-downtime key rotation.
 *
 * Unit tests run everywhere. The end-to-end rotation runs only against a real
 * PostgreSQL database (TEST_DATABASE_URL), because it discovers encrypted
 * columns through information_schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
if (hasDatabase) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = hasDatabase ? false : 'needs TEST_DATABASE_URL (a real PostgreSQL database)';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64), KEY_C = 'c'.repeat(64);
const fieldCipher = require('../fieldCipher');
const fileCipher = require('../cipher');
const { getRuntimeConfigIssues } = require('../config');
const { reencryptJson } = require('../keyRotation');

function withKeys(env, fn) {
  const names = ['CUSTOMER_FIELD_KEY', 'CUSTOMER_FIELD_KEYS_PREVIOUS', 'ATTACHMENT_KEY', 'ATTACHMENT_KEYS_PREVIOUS'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; }
  try { return fn(); } finally { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
}

test('field values encrypted with a retired key stay readable, and new writes use the current key', () => {
  const old = withKeys({ CUSTOMER_FIELD_KEY: KEY_A }, () => fieldCipher.encrypt('Northwind Logistics'));
  withKeys({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: `${KEY_C}, ${KEY_A}` }, () => {
    assert.equal(fieldCipher.decrypt(old), 'Northwind Logistics');
    assert.deepEqual(fieldCipher.decryptDetailed(old), { plaintext: 'Northwind Logistics', onCurrentKey: false });
    const fresh = fieldCipher.encrypt('Contoso');
    assert.equal(fieldCipher.decryptDetailed(fresh).onCurrentKey, true);
    const moved = fieldCipher.reencrypt(old);
    assert.notEqual(moved, old);
    assert.equal(fieldCipher.reencrypt(moved), null, 'already on the current key: nothing to do');
    assert.equal(fieldCipher.reencrypt('plain text'), null);
    assert.equal(fieldCipher.keyStatus().previous_keys, 2);
  });
  withKeys({ CUSTOMER_FIELD_KEY: KEY_B }, () => {
    assert.equal(fieldCipher.decrypt(old), '[decryption error]', 'once the old key is retired, unconverted values are unreadable');
    assert.throws(() => fieldCipher.reencrypt(old), 'rotation refuses to overwrite what it cannot read');
  });
});

test('the stored format is unchanged, so an older app version can still read new values', () => {
  const value = withKeys({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: KEY_A }, () => fieldCipher.encrypt('x'));
  assert.match(value, /^enc:[0-9a-f]{24}\.[0-9a-f]{32}\.[A-Za-z0-9+/=]+$/);
});

test('files encrypted with a retired key stay downloadable', () => {
  const old = withKeys({ ATTACHMENT_KEY: KEY_A }, () => fileCipher.encrypt(Buffer.from('firewall config')));
  withKeys({ ATTACHMENT_KEY: KEY_B, ATTACHMENT_KEYS_PREVIOUS: KEY_A }, () => {
    assert.equal(fileCipher.decrypt(old.data, old.iv, old.tag).toString(), 'firewall config');
    assert.equal(fileCipher.decryptDetailed(old.data, old.iv, old.tag).onCurrentKey, false);
  });
  withKeys({ ATTACHMENT_KEY: KEY_B }, () => assert.throws(() => fileCipher.decrypt(old.data, old.iv, old.tag)));
});

test('encrypted strings inside JSON settings are re-encrypted, everything else untouched', () => {
  const token = withKeys({ CUSTOMER_FIELD_KEY: KEY_A }, () => fieldCipher.encrypt('rt-token'));
  withKeys({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: KEY_A }, () => {
    const [value, changed] = reencryptJson({ enabled: true, base_url: 'https://rt', api_token: token, nested: [{ secret: token }, 3] });
    assert.equal(changed, true);
    assert.equal(value.enabled, true);
    assert.equal(value.base_url, 'https://rt');
    assert.equal(fieldCipher.decryptDetailed(value.api_token).onCurrentKey, true);
    assert.equal(fieldCipher.decrypt(value.nested[0].secret), 'rt-token');
    assert.equal(value.nested[1], 3);
  });
});

test('startup refuses malformed previous keys and a previous key without a current one', () => {
  const issues = env => getRuntimeConfigIssues({ JWT_SECRET: 'x'.repeat(32), ATTACHMENT_KEY: KEY_A, ...env });
  assert.deepEqual(issues({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: KEY_A }).errors, []);
  assert.ok(issues({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: `${KEY_A},nothex` }).errors.some(e => /CUSTOMER_FIELD_KEYS_PREVIOUS/.test(e)));
  assert.ok(issues({ CUSTOMER_FIELD_KEYS_PREVIOUS: KEY_A }).errors.some(e => /set the new current key/.test(e)));
  assert.ok(issues({ CUSTOMER_FIELD_KEY: KEY_B, CUSTOMER_FIELD_KEYS_PREVIOUS: KEY_B }).warnings.some(e => /ignored/.test(e)));
});

test('rotation moves every encrypted value and file onto the new key while the app keeps writing', { skip }, async () => {
  process.env.CUSTOMER_FIELD_KEY = KEY_A; process.env.ATTACHMENT_KEY = KEY_A;
  delete process.env.CUSTOMER_FIELD_KEYS_PREVIOUS; delete process.env.ATTACHMENT_KEYS_PREVIOUS;
  const db = require('../db');
  const { rotateAll, rotateFields } = require('../keyRotation');
  const { uploadDir } = require('../uploadUtils');
  await db.init();
  const enc = fieldCipher.encrypt;

  // Data written under key A: customer PII, asset fields, a personal webhook, the RT token in settings JSON, and a file.
  const user = (await db.prepare("INSERT INTO users (name, email, password, role, notify_teams_webhook_url) VALUES ('Rot User', ?, 'x', 'engineer', ?)").run(`rot-${Date.now()}@test.local`, enc('https://hooks.example/abc'))).lastInsertRowid;
  const customer = (await db.prepare('INSERT INTO customers (name, contact_email, notes) VALUES (?, ?, ?)').run(enc('Rotation Customer'), enc('it@rotation.example'), enc('original notes'))).lastInsertRowid;
  const asset = (await db.prepare(`INSERT INTO customer_assets (customer_id, name, asset_type, software_version, environment, criticality, lifecycle_status, coverage_type, created_by)
    VALUES (?, ?, 'Firewall', ?, 'production', 'high', 'active', 'managed', ?)`).run(customer, enc('FW-ROT-01'), enc('7.2.8'), user)).lastInsertRowid;
  await db.prepare("INSERT INTO settings (key, value) VALUES ('ticketing_rt', ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled: true, base_url: 'https://rt.example', api_token: enc('rt-secret') }));
  const file = fileCipher.encrypt(Buffer.from('signed quote PDF'));
  const storedName = `rotation-test-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(uploadDir, storedName), file.data);
  const attachment = (await db.prepare('INSERT INTO attachments (original_name, stored_name, mime_type, size, uploaded_by, enc_iv, enc_tag) VALUES (?, ?, ?, ?, ?, ?, ?)').run('quote.pdf', storedName, 'application/pdf', file.data.length, user, file.iv, file.tag)).lastInsertRowid;

  // Switch keys: B is current, A is kept for reading.
  process.env.CUSTOMER_FIELD_KEY = KEY_B; process.env.CUSTOMER_FIELD_KEYS_PREVIOUS = KEY_A;
  process.env.ATTACHMENT_KEY = KEY_B; process.env.ATTACHMENT_KEYS_PREVIOUS = KEY_A;

  // The app keeps working before rotation finishes: old values read fine.
  const before = await db.prepare('SELECT name FROM customers WHERE id=?').get(customer);
  assert.equal(fieldCipher.decrypt(before.name), 'Rotation Customer');

  // A rotation pass where the app edits the customer's notes between the read and the write.
  const racingStore = {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (/^UPDATE "customers" SET "notes"/.test(sql)) {
        return { run: async (...args) => { await db.prepare('UPDATE customers SET notes=? WHERE id=?').run(enc('edited during rotation'), customer); return statement.run(...args); } };
      }
      return statement;
    },
  };
  const raced = await rotateFields({ store: racingStore });
  assert.ok(raced.skippedChanged >= 1, 'the concurrent edit made the compare-and-swap skip that value');
  assert.equal(fieldCipher.decrypt((await db.prepare('SELECT notes FROM customers WHERE id=?').get(customer)).notes), 'edited during rotation', 'the app\'s edit is not overwritten');

  const result = await rotateAll({});
  assert.deepEqual(result.fields.unreadable, []);
  assert.deepEqual(result.files.unreadable, []);
  assert.ok(result.files.reencrypted >= 1);

  // Retire key A entirely: everything must still read.
  delete process.env.CUSTOMER_FIELD_KEYS_PREVIOUS; delete process.env.ATTACHMENT_KEYS_PREVIOUS;
  const c = fieldCipher.decryptCustomer(await db.prepare('SELECT * FROM customers WHERE id=?').get(customer));
  assert.deepEqual([c.name, c.contact_email, c.notes], ['Rotation Customer', 'it@rotation.example', 'edited during rotation']);
  const a = await db.prepare('SELECT name, software_version FROM customer_assets WHERE id=?').get(asset);
  assert.deepEqual([fieldCipher.decrypt(a.name), fieldCipher.decrypt(a.software_version)], ['FW-ROT-01', '7.2.8']);
  assert.equal(fieldCipher.decrypt((await db.prepare('SELECT notify_teams_webhook_url FROM users WHERE id=?').get(user)).notify_teams_webhook_url), 'https://hooks.example/abc');
  assert.equal(fieldCipher.decrypt(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='ticketing_rt'").get()).value).api_token), 'rt-secret');
  const row = await db.prepare('SELECT stored_name, enc_iv, enc_tag FROM attachments WHERE id=?').get(attachment);
  assert.notEqual(row.stored_name, storedName, 'the file was rewritten under a new name');
  assert.equal(fs.existsSync(path.join(uploadDir, storedName)), false, 'the old file was removed');
  assert.equal(fileCipher.decrypt(fs.readFileSync(path.join(uploadDir, row.stored_name)), row.enc_iv, row.enc_tag).toString(), 'signed quote PDF');

  // A second pass finds nothing left on the old key.
  process.env.CUSTOMER_FIELD_KEYS_PREVIOUS = KEY_A; process.env.ATTACHMENT_KEYS_PREVIOUS = KEY_A;
  const again = await rotateAll({ dryRun: true });
  assert.equal(again.fields.reencrypted + again.files.reencrypted, 0);
  fs.rmSync(path.join(uploadDir, row.stored_name), { force: true });
  await db.pool.end();
});
