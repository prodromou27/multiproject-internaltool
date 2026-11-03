// Backup checks keep TLS verification; restoring files is all or nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nodeSsl } = require('../databaseBackups');

test('backup checks keep the TLS verification the database address asks for', () => {
  assert.equal(nodeSsl({}), undefined);
  assert.equal(nodeSsl({ PGSSLMODE: 'disable' }), undefined);
  assert.deepEqual(nodeSsl({ PGSSLMODE: 'require' }), { rejectUnauthorized: false });
  const ca = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pgca-')), 'root.crt');
  fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const full = nodeSsl({ PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca });
  assert.equal(full.rejectUnauthorized, true);
  assert.match(full.ca, /BEGIN CERTIFICATE/);
  assert.equal(full.checkServerIdentity, undefined, 'verify-full checks the host name (node default)');
  const chain = nodeSsl({ PGSSLMODE: 'verify-ca', PGSSLROOTCERT: ca });
  assert.equal(chain.rejectUnauthorized, true);
  assert.equal(typeof chain.checkServerIdentity, 'function', 'verify-ca checks the chain only');
});

test('restoring the uploaded files is all or nothing: a failed move puts the old files back', () => {
  const { swapUploads } = require('../databaseBackups');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
  process.env.BACKUP_UPLOADS_DIR = root;
  try {
    fs.writeFileSync(path.join(root, 'old-1.bin'), 'old one');
    fs.writeFileSync(path.join(root, 'old-2.bin'), 'old two');
    fs.mkdirSync(path.join(root, 'exports')); // kept as it is
    const staging = path.join(root, '.restoring-1');
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'new-1.bin'), 'new one');
    fs.writeFileSync(path.join(staging, 'new-2.bin'), 'new two');
    let moves = 0;
    const flaky = (from, to) => { if (++moves === 4) throw new Error('disk full'); fs.renameSync(from, to); };
    assert.throws(() => swapUploads(staging, { rename: flaky }), /disk full/);
    assert.deepEqual(fs.readdirSync(root).filter(n => !n.startsWith('.')).sort(), ['exports', 'old-1.bin', 'old-2.bin']);
    assert.equal(fs.readFileSync(path.join(root, 'old-1.bin'), 'utf8'), 'old one');

    swapUploads(staging);
    assert.deepEqual(fs.readdirSync(root).sort(), ['exports', 'new-1.bin', 'new-2.bin'], 'old files and the staging folder are gone');
  } finally { delete process.env.BACKUP_UPLOADS_DIR; }
});
