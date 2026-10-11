const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Server, utils: { sftp: { STATUS_CODE, flagsToString } } } = require('ssh2');
const offsite = require('../backupOffsite');

// A settings table in memory: enough for backupOffsite's reads and writes.
function memoryStore() {
  const rows = new Map();
  return { rows, prepare: sql => ({
    get: async key => (rows.has(key) ? { value: rows.get(key) } : undefined),
    run: async (key, value) => { if (/INSERT INTO settings/.test(sql)) rows.set(key, value); return { changes: 1 }; },
  }) };
}

// A small SFTP server backed by a temporary folder, with a fixed host key and a password.
function sftpServer(root, hostKey, port = 0) {
  const handles = new Map(); let next = 0;
  const local = p => path.join(root, p.replace(/^\/+/, ''));
  const statOf = p => { const s = fs.statSync(p); return { mode: s.mode, uid: 0, gid: 0, size: s.size, atime: s.atimeMs / 1000 | 0, mtime: s.mtimeMs / 1000 | 0 }; };
  const server = new Server({ hostKeys: [hostKey] }, client => {
    client.on('error', () => {}); // e.g. our client refusing an impostor's key
    client.on('authentication', ctx => (ctx.method === 'password' && ctx.username === 'backup' && ctx.password === 'secret' ? ctx.accept() : ctx.reject()));
    client.on('ready', () => client.on('session', accept => accept().on('sftp', acceptSftp => {
      const sftp = acceptSftp();
      const ok = id => sftp.status(id, STATUS_CODE.OK), failure = id => sftp.status(id, STATUS_CODE.FAILURE), none = id => sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
      const handle = value => { const h = Buffer.alloc(4); h.writeUInt32BE(next++); handles.set(h.readUInt32BE(), value); return h; };
      sftp.on('OPEN', (id, p, flags) => { try { const fd = fs.openSync(local(p), flagsToString(flags)); sftp.handle(id, handle({ fd })); } catch { failure(id); } });
      sftp.on('WRITE', (id, h, offset, data) => { fs.writeSync(handles.get(h.readUInt32BE()).fd, data, 0, data.length, offset); ok(id); });
      sftp.on('CLOSE', (id, h) => { const v = handles.get(h.readUInt32BE()); if (v?.fd != null) fs.closeSync(v.fd); handles.delete(h.readUInt32BE()); ok(id); });
      sftp.on('FSTAT', (id, h) => sftp.attrs(id, (() => { const s = fs.fstatSync(handles.get(h.readUInt32BE()).fd); return { mode: s.mode, size: s.size, uid: 0, gid: 0, atime: 0, mtime: 0 }; })()));
      for (const ev of ['STAT', 'LSTAT']) sftp.on(ev, (id, p) => (fs.existsSync(local(p)) ? sftp.attrs(id, statOf(local(p))) : none(id)));
      sftp.on('MKDIR', (id, p) => { try { fs.mkdirSync(local(p)); ok(id); } catch { failure(id); } });
      sftp.on('REMOVE', (id, p) => { try { fs.unlinkSync(local(p)); ok(id); } catch { none(id); } });
      sftp.on('RENAME', (id, a, b) => { try { fs.renameSync(local(a), local(b)); ok(id); } catch { failure(id); } });
      sftp.on('OPENDIR', (id, p) => sftp.handle(id, handle({ dir: fs.readdirSync(local(p)), sent: false, base: local(p) })));
      sftp.on('READDIR', (id, h) => {
        const v = handles.get(h.readUInt32BE());
        if (v.sent) return sftp.status(id, STATUS_CODE.EOF);
        v.sent = true;
        sftp.name(id, v.dir.map(filename => ({ filename, longname: filename, attrs: statOf(path.join(v.base, filename)) })));
      });
      sftp.on('REALPATH', (id, p) => sftp.name(id, [{ filename: path.posix.resolve('/', p), longname: p, attrs: {} }]));
    })));
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const rsaKey = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const fingerprintOfServer = key => offsite.fingerprintOf(require('ssh2').utils.parseKey(key).getPublicSSH());

test('encrypted copies round-trip, and a wrong passphrase is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-enc-'));
  const plain = path.join(dir, 'a.sql.gz'), enc = path.join(dir, 'a.sql.gz.enc'), back = path.join(dir, 'b.sql.gz');
  fs.writeFileSync(plain, crypto.randomBytes(300000));
  await offsite.encryptFile(plain, enc, 'correct horse battery');
  assert.ok(fs.readFileSync(enc).subarray(0, 8).equals(offsite.MAGIC));
  await offsite.decryptFile(enc, back, 'correct horse battery');
  assert.ok(fs.readFileSync(back).equals(fs.readFileSync(plain)));
  await assert.rejects(offsite.decryptFile(enc, back, 'wrong passphrase!!'), /Wrong passphrase/);

  // The standalone script (deploy/decrypt-backup.js) reads the same format.
  const scriptOut = path.join(dir, 'script.sql.gz');
  execFileSync(process.execPath, [path.join(__dirname, '../../deploy/decrypt-backup.js'), enc, scriptOut], { env: { ...process.env, BACKUP_PASSPHRASE: 'correct horse battery' }, stdio: 'pipe' });
  assert.ok(fs.readFileSync(scriptOut).equals(fs.readFileSync(plain)));
});

test('settings: copies stay off until the server key is trusted; secrets are never shown', async () => {
  const store = memoryStore();
  await assert.rejects(offsite.saveConfig({ enabled: true, host: 'nas.local', username: 'backup', sftp_password: 'secret', encryption_passphrase: 'long enough passphrase' }, store), /trust the server key/);
  await assert.rejects(offsite.saveConfig({ remote_dir: 'relative/dir' }, store), /absolute path/);
  await assert.rejects(offsite.saveConfig({ encryption_passphrase: 'short' }, store), /at least 12/);
  const saved = await offsite.saveConfig({ host: 'nas.local', username: 'backup', sftp_password: 'secret', encryption_passphrase: 'long enough passphrase' }, store);
  const view = offsite.publicView(saved, null);
  assert.deepEqual([view.has_password, view.has_passphrase, view.enabled], [true, true, false]);
  assert.ok(!JSON.stringify(view).includes('secret'));
});

test('backups are uploaded encrypted to a pinned server, old copies are removed, and a changed key is refused', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-sftp-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-backups-'));
  const hostKey = rsaKey(), server = await sftpServer(root, hostKey);
  const port = server.address().port;
  try {
    const store = memoryStore();
    await offsite.saveConfig({ host: '127.0.0.1', port, username: 'backup', sftp_password: 'secret', remote_dir: '/copies/teamhub', encryption_passphrase: 'long enough passphrase' }, store);
    const tested = await offsite.testConnection(store);
    assert.equal(tested.fingerprint, fingerprintOfServer(hostKey));
    assert.equal(tested.trusted, false);
    await assert.rejects(offsite.trust('SHA256:somethingelse', store), /Test the connection first/);
    await offsite.trust(tested.fingerprint, store);
    await offsite.saveConfig({ enabled: true }, store);

    // An old copy on the server, past a 14-day retention; keep_min 1 keeps only the newest.
    fs.mkdirSync(path.join(root, 'copies/teamhub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'copies/teamhub/teamhub-20200101-023000-scheduled.sql.gz.enc'), 'old');
    const file = 'teamhub-20261011-023000-scheduled.sql.gz';
    fs.writeFileSync(path.join(backupDir, file), crypto.randomBytes(50000));
    const result = await offsite.copyBackup(file, { backupDir, retentionDays: 14, keepMin: 1, store });
    assert.deepEqual([result.ok, result.remote, result.removed], [true, `/copies/teamhub/${file}.enc`, 1]);
    assert.deepEqual(fs.readdirSync(path.join(root, 'copies/teamhub')), [`${file}.enc`]);
    const decrypted = path.join(backupDir, 'check.sql.gz');
    await offsite.decryptFile(path.join(root, 'copies/teamhub', `${file}.enc`), decrypted, 'long enough passphrase');
    assert.ok(fs.readFileSync(decrypted).equals(fs.readFileSync(path.join(backupDir, file))));
    assert.equal((await offsite.status(store)).ok, true);
    assert.deepEqual(fs.readdirSync(backupDir).filter(n => n.includes('partial')), [], 'no temporary files left');

    // A server presenting another key gets nothing.
    await new Promise(resolve => server.close(resolve));
    const impostor = await sftpServer(root, rsaKey(), port);
    try {
      await assert.rejects(offsite.copyBackup(file, { backupDir, retentionDays: 14, keepMin: 1, store }), /key changed/);
      assert.equal((await offsite.status(store)).ok, false);
    } finally { impostor.close(); }
  } finally { if (server.listening) server.close(); }
});

test('network share: only a folder inside the share root, writable, and with the passphrase set', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-root-'));
  process.env.BACKUP_SHARE_ROOT = root; process.env.BACKUP_SHARE_REQUIRE_MOUNT = '0'; // temp folders are on the same disk
  try {
    const store = memoryStore();
    const share = path.join(root, 'nas');
    await assert.rejects(offsite.saveShare({ path: 'relative/folder' }, store), /absolute path/);
    await assert.rejects(offsite.saveShare({ path: os.tmpdir() }, store), /must be inside/);
    await assert.rejects(offsite.saveShare({ path: root }, store), /must be inside/, 'not the root itself');
    await assert.rejects(offsite.saveShare({ path: path.join(root, 'nas', '..', '..', 'escape') }, store), /must be inside/);
    await assert.rejects(offsite.saveShare({ path: share }, store), /does not exist/);
    fs.mkdirSync(share);
    assert.equal((await offsite.saveShare({ path: share }, store)).enabled, false);
    await assert.rejects(offsite.saveShare({ enabled: true }, store), /encryption passphrase/);
    await offsite.saveConfig({ encryption_passphrase: 'long enough passphrase' }, store);
    assert.equal((await offsite.saveShare({ enabled: true }, store)).enabled, true);
    const tested = await offsite.testShare(store);
    assert.deepEqual([tested.path, tested.copies], [share, 0]);
  } finally { delete process.env.BACKUP_SHARE_ROOT; delete process.env.BACKUP_SHARE_REQUIRE_MOUNT; }
});

test('network share: backups are copied encrypted, old copies removed, other files left alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-root-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-backups-'));
  process.env.BACKUP_SHARE_ROOT = root; process.env.BACKUP_SHARE_REQUIRE_MOUNT = '0'; // temp folders are on the same disk
  try {
    const store = memoryStore(), share = path.join(root, 'nas');
    fs.mkdirSync(share);
    await offsite.saveConfig({ encryption_passphrase: 'long enough passphrase' }, store);
    await offsite.saveShare({ path: share, enabled: true }, store);
    fs.writeFileSync(path.join(share, 'teamhub-20200101-023000-scheduled.sql.gz.enc'), 'old');
    fs.writeFileSync(path.join(share, 'someone-elses-file.txt'), 'keep me');
    const file = 'teamhub-20261011-023000-scheduled.sql.gz';
    fs.writeFileSync(path.join(backupDir, file), crypto.randomBytes(40000));
    const result = await offsite.copyToShare(file, { backupDir, retentionDays: 14, keepMin: 1, store });
    assert.deepEqual([result.ok, result.removed], [true, 1]);
    assert.deepEqual(fs.readdirSync(share).sort(), ['someone-elses-file.txt', `${file}.enc`]);
    const back = path.join(backupDir, 'back.sql.gz');
    await offsite.decryptFile(path.join(share, `${file}.enc`), back, 'long enough passphrase');
    assert.ok(fs.readFileSync(back).equals(fs.readFileSync(path.join(backupDir, file))));
    assert.equal((await offsite.shareStatus(store)).ok, true);

    // A share that has gone away (unmounted) fails, is recorded, and leaves nothing half-written.
    fs.rmSync(share, { recursive: true });
    await assert.rejects(offsite.copyToShare(file, { backupDir, retentionDays: 14, keepMin: 1, store }), /does not exist/);
    assert.equal((await offsite.shareStatus(store)).ok, false);
  } finally { delete process.env.BACKUP_SHARE_ROOT; delete process.env.BACKUP_SHARE_REQUIRE_MOUNT; }
});

test('retention keeps the newest copies and removes only expired TeamHub copies', () => {
  const names = ['teamhub-20260101-000000-scheduled.sql.gz.enc', 'teamhub-20260201-000000-scheduled.sql.gz.enc', 'teamhub-20261010-000000-manual.sql.gz.enc', 'notes.txt'];
  assert.deepEqual(offsite.expiredCopies(names, 14, 1, Date.parse('2026-10-11T00:00:00Z')), ['teamhub-20260201-000000-scheduled.sql.gz.enc', 'teamhub-20260101-000000-scheduled.sql.gz.enc']);
  assert.deepEqual(offsite.expiredCopies(names, 14, 3, Date.parse('2026-10-11T00:00:00Z')), [], 'always keeps keepMin');
});

test('network share: on Linux a folder on the container disk (share not mounted) is refused', { skip: process.platform !== 'linux' && 'Linux only' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-root-'));
  process.env.BACKUP_SHARE_ROOT = root;
  try {
    fs.mkdirSync(path.join(root, 'nas'));
    const sameDisk = fs.statSync(path.join(root, 'nas')).dev === fs.statSync('/').dev;
    if (sameDisk) await assert.rejects(offsite.saveShare({ path: path.join(root, 'nas') }, memoryStore()), /not a mounted share/);
  } finally { delete process.env.BACKUP_SHARE_ROOT; }
});
