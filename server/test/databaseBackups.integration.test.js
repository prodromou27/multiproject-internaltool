const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Real backups need PostgreSQL and its pg_dump/psql (set PG_BIN_DIR if they are not on PATH).
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-backups-'));
// Never the real uploads folder: a restore replaces its contents.
process.env.BACKUP_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-uploads-'));
const uploads = process.env.BACKUP_UPLOADS_DIR;
const backups = require('../databaseBackups');
const tools = (() => { try { return require('child_process').spawnSync(process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, 'pg_dump') : 'pg_dump', ['--version']).status === 0; } catch { return false; } })();
const real = { skip: process.env.TEST_DATABASE_URL && tools ? false : 'needs PostgreSQL and pg_dump' };

test('schedule settings are checked and the backup list is for managers only', async () => {
  assert.equal((await api('/api/settings/backups', { token: ids.tokenEnabled })).status, 403);
  const listed = await api('/api/settings/backups', { token: ids.tokenManager });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.data.schedule, backups.DEFAULT_SCHEDULE);
  for (const bad of [{ enabled: 'yes', time: '02:30', retention_days: 14, keep_min: 3 }, { enabled: true, time: '25:00', retention_days: 14, keep_min: 3 }, { enabled: true, time: '02:30', retention_days: 0, keep_min: 3 }])
    assert.equal((await api('/api/settings/backups/schedule', { method: 'PUT', token: ids.tokenManager, body: bad })).status, 400, JSON.stringify(bad));
  const saved = await api('/api/settings/backups/schedule', { method: 'PUT', token: ids.tokenManager, body: { enabled: true, time: '03:15', retention_days: 30, keep_min: 5 } });
  assert.deepEqual(saved.data, { enabled: true, time: '03:15', retention_days: 30, keep_min: 5, include_files: true });
  assert.equal((await api('/api/settings/backups/../../etc/passwd/verify', { method: 'POST', token: ids.tokenManager })).status, 404);
  assert.equal((await api('/api/settings/backups/teamhub-20260101-000000-manual.sql.gz/restore', { method: 'POST', token: ids.tokenManager, body: { confirm: 'RESTORE', password: 'pw' } })).status, 404);
});

test('back up, check, download and restore the database', real, async () => {
  backups._setExit(() => {});
  fs.writeFileSync(path.join(uploads, 'attachment-1.bin'), 'encrypted attachment');
  fs.mkdirSync(path.join(uploads, 'exports'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'exports', 'report.xlsx'), 'expires tomorrow');
  const made = await api('/api/settings/backups', { method: 'POST', token: ids.tokenManager });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.match(made.data.file, /^teamhub-\d{8}-\d{6}-manual\.sql\.gz$/);
  assert.ok(made.data.size_bytes > 1000);
  assert.deepEqual([made.data.files.file, made.data.files.files], [made.data.file.replace('.sql.gz', '.files.tar.gz'), 1], 'uploaded files beside the dump; exports left out');
  assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='last_backup_status'").get()).value).file, made.data.file, 'System Health sees it');

  const checked = await api(`/api/settings/backups/${made.data.file}/verify`, { method: 'POST', token: ids.tokenManager });
  assert.equal(checked.status, 200, JSON.stringify(checked.data));
  assert.ok(checked.data.tables > 20 && checked.data.users >= 5);
  assert.equal(checked.data.files, 1, 'the files archive reads back');
  assert.ok((await db.prepare("SELECT value FROM settings WHERE key='last_restore_verification'").get()), 'System Health sees the check');

  // Downloading needs the manager's password.
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync('Manager#pass1', 4), ids.manager);
  assert.equal((await api(`/api/settings/backups/${made.data.file}/download`, { method: 'POST', token: ids.tokenManager, body: { password: 'wrong' } })).status, 403);
  const download = await fetch(`${suiteFixture.baseUrl}/api/settings/backups/${made.data.file}/download`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'Content-Type': 'application/json', 'X-SolutionsHub-Request': '1' }, body: JSON.stringify({ password: 'Manager#pass1' }) });
  assert.equal(download.status, 200);
  assert.match(require('zlib').gunzipSync(Buffer.from(await download.arrayBuffer())).toString('utf8', 0, 400), /PostgreSQL database dump/);
  const filesDownload = await fetch(`${suiteFixture.baseUrl}/api/settings/backups/${made.data.file}/download?part=files`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'Content-Type': 'application/json', 'X-SolutionsHub-Request': '1' }, body: JSON.stringify({ password: 'Manager#pass1' }) });
  assert.equal(filesDownload.status, 200);
  assert.match(filesDownload.headers.get('content-disposition'), /\.files\.tar\.gz/);

  // Something changes after the backup; restoring brings back the backup's data.
  await db.prepare("INSERT INTO tasks (title, status, created_by) VALUES ('Made after the backup', 'open', ?)").run(ids.manager);
  fs.writeFileSync(path.join(uploads, 'attachment-1.bin'), 'changed after the backup');
  fs.writeFileSync(path.join(uploads, 'attachment-2.bin'), 'added after the backup');
  assert.equal((await api(`/api/settings/backups/${made.data.file}/restore`, { method: 'POST', token: ids.tokenManager, body: { confirm: 'restore', password: 'Manager#pass1' } })).status, 400);
  const restored = await api(`/api/settings/backups/${made.data.file}/restore`, { method: 'POST', token: ids.tokenManager, body: { confirm: 'RESTORE', password: 'Manager#pass1' } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.restarting, true);
  assert.match(restored.data.safety_backup, /before-restore/);
  assert.equal(backups.isRestoring(), true, 'the API waits for the restart (index.js answers 503 meanwhile)');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title='Made after the backup'").get()).n, 0);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, restored.data.safety_backup)), 'a safety backup was taken first');
  // The files are back as they were: changed ones restored, new ones gone, exports untouched, no scratch left.
  assert.equal(restored.data.files_restored, true);
  assert.equal(fs.readFileSync(path.join(uploads, 'attachment-1.bin'), 'utf8'), 'encrypted attachment');
  assert.equal(fs.existsSync(path.join(uploads, 'attachment-2.bin')), false);
  assert.equal(fs.readFileSync(path.join(uploads, 'exports', 'report.xlsx'), 'utf8'), 'expires tomorrow');
  assert.deepEqual(fs.readdirSync(uploads).filter(n => n.startsWith('.')), []);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, restored.data.safety_backup.replace('.sql.gz', '.files.tar.gz'))), 'the safety backup has the files too');
  backups._endRestoreForTests();
});

test('a broken backup is refused, and an upload must be a pg_dump backup', real, async () => {
  const bad = path.join(process.env.BACKUP_DIR, 'teamhub-20260101-000000-uploaded.sql.gz');
  fs.writeFileSync(bad, require('zlib').gzipSync('-- PostgreSQL database dump\nCREATE TABLE ((( not valid sql;\n'));
  await assert.rejects(backups.verify('teamhub-20260101-000000-uploaded.sql.gz'), /psql failed/);
  // Restoring it fails part-way, in one transaction, so nothing changes.
  const before = Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n);
  await assert.rejects(backups.restore('teamhub-20260101-000000-uploaded.sql.gz'), /left as it was/);
  assert.equal(backups.isRestoring(), false);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n), before);
  const plain = path.join(os.tmpdir(), `not-a-backup-${process.pid}.gz`);
  fs.writeFileSync(plain, require('zlib').gzipSync('hello'));
  await assert.rejects(backups.importUpload(plain), /not made by pg_dump/);
  // A dump with a psql command in it (\! runs a shell command) is refused at upload, check and restore.
  const evil = path.join(os.tmpdir(), `evil-backup-${process.pid}.gz`);
  fs.writeFileSync(evil, require('zlib').gzipSync('--\n-- PostgreSQL database dump\n--\nSET client_min_messages = warning;\n\\! echo pwned > /tmp/pwned\n'));
  await assert.rejects(backups.importUpload(evil), /psql command/);
  const planted = path.join(process.env.BACKUP_DIR, 'teamhub-20260102-000000-uploaded.sql.gz');
  fs.copyFileSync(evil, planted);
  await assert.rejects(backups.verify('teamhub-20260102-000000-uploaded.sql.gz'), /psql command/);
  await assert.rejects(backups.restore('teamhub-20260102-000000-uploaded.sql.gz'), /psql command/);
  // COPY … PROGRAM split over lines, and a DO block, are refused before psql sees them.
  for (const sql of ["COPY (SELECT 1) TO\nPROGRAM 'touch /tmp/pwned';\n", "DO $$ BEGIN PERFORM 1; END $$;\n"]) {
    fs.writeFileSync(evil, require('zlib').gzipSync(`--\n-- PostgreSQL database dump\n--\n${sql}`));
    await assert.rejects(backups.importUpload(evil), /not made by pg_dump/);
  }
  fs.rmSync(evil, { force: true });
  fs.rmSync(plain, { force: true });
});

test('the schedule takes one backup a day once its time has passed', async () => {
  const day = new Date('2027-05-04T10:00:00Z');
  await db.prepare("INSERT INTO settings (key, value) VALUES ('backup_schedule', ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled: true, time: '23:59', retention_days: 14, keep_min: 3 }));
  assert.equal(await backups.runDue(day), null, 'not yet');
  await db.prepare("UPDATE settings SET value=? WHERE key='backup_schedule'").run(JSON.stringify({ enabled: true, time: '00:00', retention_days: 14, keep_min: 3 }));
  const job = await backups.runDue(day);
  assert.ok(job?.id);
  assert.equal((await backups.runDue(day)).id, job.id, 'the same job, not a second one');
  await db.prepare("UPDATE settings SET value=? WHERE key='backup_schedule'").run(JSON.stringify({ enabled: false, time: '00:00', retention_days: 14, keep_min: 3 }));
  assert.equal(await backups.runDue(new Date('2027-05-05T10:00:00Z')), null, 'off');
});

test('off-server copy settings: managers only, secrets need the password and are never sent back', async () => {
  const base = '/api/settings/backups/offsite';
  assert.equal((await api(base, { token: ids.tokenEnabled })).status, 403);
  const view = await api(base, { token: ids.tokenManager });
  assert.deepEqual([view.status, view.data.enabled, view.data.has_password], [200, false, false]);

  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync('Manager#pass1', 4), ids.manager);
  const body = { host: 'nas.example.local', username: 'teamhub', sftp_password: 'sftp-secret', encryption_passphrase: 'a long backup passphrase' };
  assert.equal((await api(base, { method: 'PUT', token: ids.tokenManager, body })).status, 403, 'changing secrets needs the manager password');
  const saved = await api(base, { method: 'PUT', token: ids.tokenManager, body: { ...body, password: 'Manager#pass1' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual([saved.data.has_password, saved.data.has_passphrase, saved.data.host], [true, true, 'nas.example.local']);
  assert.ok(!JSON.stringify(saved.data).includes('sftp-secret') && !JSON.stringify(saved.data).includes('a long backup passphrase'));
  // Non-secret changes need no password; turning on needs a trusted key.
  assert.equal((await api(base, { method: 'PUT', token: ids.tokenManager, body: { remote_dir: '/backups/teamhub' } })).status, 200);
  const on = await api(base, { method: 'PUT', token: ids.tokenManager, body: { enabled: true } });
  assert.deepEqual([on.status, /trust the server key/.test(on.data.error)], [400, true]);
  assert.equal((await api(`${base}/trust`, { method: 'POST', token: ids.tokenManager, body: { fingerprint: 'SHA256:x' } })).status, 400);
  const audit = await db.prepare("SELECT detail FROM audit_log WHERE action='backup_offsite_updated' ORDER BY id").all();
  assert.ok(audit.some(a => /changed=sftp_password,encryption_passphrase/.test(a.detail)));
});

test('network share settings: managers only, and only a mounted folder inside the share root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-root-'));
  process.env.BACKUP_SHARE_ROOT = root; process.env.BACKUP_SHARE_REQUIRE_MOUNT = '0'; // temp folders are on the same disk
  try {
    const base = '/api/settings/backups/share';
    assert.equal((await api(base, { token: ids.tokenEnabled })).status, 403);
    const view = await api(base, { token: ids.tokenManager });
    assert.deepEqual([view.status, view.data.enabled, view.data.root], [200, false, root]);
    assert.equal((await api(base, { method: 'PUT', token: ids.tokenManager, body: { path: os.tmpdir() } })).status, 400);
    fs.mkdirSync(path.join(root, 'nas'));
    const saved = await api(base, { method: 'PUT', token: ids.tokenManager, body: { path: path.join(root, 'nas') } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const tested = await api(`${base}/test`, { method: 'POST', token: ids.tokenManager, body: {} });
    assert.deepEqual([tested.status, tested.data.path], [200, path.join(root, 'nas')]);
    const audit = await db.prepare("SELECT detail FROM audit_log WHERE action='backup_share_updated'").all();
    assert.equal(audit.length, 1);
  } finally { delete process.env.BACKUP_SHARE_ROOT; delete process.env.BACKUP_SHARE_REQUIRE_MOUNT; }
});
