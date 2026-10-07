const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Real backups need PostgreSQL and its pg_dump/psql (set PG_BIN_DIR if they are not on PATH).
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'teamhub-backups-'));
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
  assert.deepEqual(saved.data, { enabled: true, time: '03:15', retention_days: 30, keep_min: 5 });
  assert.equal((await api('/api/settings/backups/../../etc/passwd/verify', { method: 'POST', token: ids.tokenManager })).status, 404);
  assert.equal((await api('/api/settings/backups/teamhub-20260101-000000-manual.sql.gz/restore', { method: 'POST', token: ids.tokenManager, body: { confirm: 'RESTORE', password: 'pw' } })).status, 404);
});

test('back up, check, download and restore the database', real, async () => {
  backups._setExit(() => {});
  const made = await api('/api/settings/backups', { method: 'POST', token: ids.tokenManager });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.match(made.data.file, /^teamhub-\d{8}-\d{6}-manual\.sql\.gz$/);
  assert.ok(made.data.size_bytes > 1000);
  assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='last_backup_status'").get()).value).file, made.data.file, 'System Health sees it');

  const checked = await api(`/api/settings/backups/${made.data.file}/verify`, { method: 'POST', token: ids.tokenManager });
  assert.equal(checked.status, 200, JSON.stringify(checked.data));
  assert.ok(checked.data.tables > 20 && checked.data.users >= 5);
  assert.ok((await db.prepare("SELECT value FROM settings WHERE key='last_restore_verification'").get()), 'System Health sees the check');

  // Downloading needs the manager's password.
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync('Manager#pass1', 4), ids.manager);
  assert.equal((await api(`/api/settings/backups/${made.data.file}/download`, { method: 'POST', token: ids.tokenManager, body: { password: 'wrong' } })).status, 403);
  const download = await fetch(`${suiteFixture.baseUrl}/api/settings/backups/${made.data.file}/download`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'Content-Type': 'application/json', 'X-SolutionsHub-Request': '1' }, body: JSON.stringify({ password: 'Manager#pass1' }) });
  assert.equal(download.status, 200);
  assert.match(require('zlib').gunzipSync(Buffer.from(await download.arrayBuffer())).toString('utf8', 0, 400), /PostgreSQL database dump/);

  // Something changes after the backup; restoring brings back the backup's data.
  await db.prepare("INSERT INTO tasks (title, status, created_by) VALUES ('Made after the backup', 'open', ?)").run(ids.manager);
  assert.equal((await api(`/api/settings/backups/${made.data.file}/restore`, { method: 'POST', token: ids.tokenManager, body: { confirm: 'restore', password: 'Manager#pass1' } })).status, 400);
  const restored = await api(`/api/settings/backups/${made.data.file}/restore`, { method: 'POST', token: ids.tokenManager, body: { confirm: 'RESTORE', password: 'Manager#pass1' } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.restarting, true);
  assert.match(restored.data.safety_backup, /before-restore/);
  assert.equal(backups.isRestoring(), true, 'the API waits for the restart (index.js answers 503 meanwhile)');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title='Made after the backup'").get()).n, 0);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, restored.data.safety_backup)), 'a safety backup was taken first');
  backups._endRestoreForTests();
});

test('a broken backup is refused, and an upload must be a pg_dump backup', real, async () => {
  const bad = path.join(process.env.BACKUP_DIR, 'teamhub-20260101-000000-uploaded.sql.gz');
  fs.writeFileSync(bad, require('zlib').gzipSync('-- PostgreSQL database dump\nTHIS IS NOT SQL;\n'));
  await assert.rejects(backups.verify('teamhub-20260101-000000-uploaded.sql.gz'), /psql failed/);
  // Restoring it fails part-way, in one transaction, so nothing changes.
  const before = Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n);
  await assert.rejects(backups.restore('teamhub-20260101-000000-uploaded.sql.gz'), /left as it was/);
  assert.equal(backups.isRestoring(), false);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n), before);
  const plain = path.join(os.tmpdir(), `not-a-backup-${process.pid}.gz`);
  fs.writeFileSync(plain, require('zlib').gzipSync('hello'));
  await assert.rejects(backups.importUpload(plain), /not a PostgreSQL backup/);
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
