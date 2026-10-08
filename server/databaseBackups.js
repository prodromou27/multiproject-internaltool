/**
 * Database backups made by the app itself: on a schedule, on request, and
 * before every restore. A backup is a gzipped plain SQL dump (pg_dump --clean
 * --if-exists --no-owner), the same format as deploy/backup.sh, so either can
 * restore the other's files. Each file has a small .json beside it (who, when,
 * kind, check result); being files, they survive restoring the database.
 *
 *  - verify: restores a backup into a temporary database, checks it, drops it.
 *  - restore: takes a safety backup first, puts the API into maintenance, then
 *    restores in a single transaction (a failure leaves the database as it
 *    was), and restarts the app so it starts cleanly on the restored data.
 *
 * Needs pg_dump and psql (postgresql16-client in the Docker image); PG_BIN_DIR
 * can point at them elsewhere.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const db = require('./db');
const appTime = require('./appTime');
const { scanFile } = require('./backupScan');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, 'backups'));
const NAME = /^teamhub-(\d{8})-(\d{6})-(scheduled|manual|before-restore|uploaded)\.sql\.gz$/;
const DEFAULT_SCHEDULE = Object.freeze({ enabled: true, time: '02:30', retention_days: 14, keep_min: 3 });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

let busy = null;            // 'backup' | 'verify' | 'restore' while one is running
let restoring = false;      // the API answers 503 meanwhile
let exitAfterRestore = () => setTimeout(() => process.exit(0), 1500).unref?.();

function connection(databaseOverride) {
  const url = new URL(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '');
  if (!/^postgres(ql)?:$/.test(url.protocol)) fail('DATABASE_URL is not a PostgreSQL address', 500);
  return {
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseOverride || decodeURIComponent(url.pathname.slice(1)),
    ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
  };
}
const tool = name => (process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, name) : name);

/** Runs a PostgreSQL tool; `input` is piped to stdin, stdout goes through the `output` streams in order. */
function run(name, args, { env, input, output } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    // Only what the tool needs: not the app's keys and secrets.
    const base = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'PGSSLROOTCERT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    try { child = spawn(tool(name), args, { env: { ...base, ...env }, stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'], windowsHide: true }); }
    catch (error) { reject(error); return; }
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => reject(error.code === 'ENOENT' ? Object.assign(new Error(`${name} is not installed on the server running TeamHub`), { status: 500 }) : error));
    const done = Promise.all([
      input ? pipeline(input, child.stdin).catch(error => { if (error.code !== 'EPIPE') throw error; }) : null,
      output ? pipeline(child.stdout, ...[].concat(output)) : null,
    ]);
    child.on('close', code => done.then(() => {
      if (code === 0) resolve(stderr);
      else reject(Object.assign(new Error(`${name} failed: ${stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`}`), { status: 500 }));
    }, reject));
  });
}

const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const metaPath = file => path.join(BACKUP_DIR, `${file}.json`);
function readMeta(file) { try { return JSON.parse(fs.readFileSync(metaPath(file), 'utf8')); } catch { return {}; } }
function writeMeta(file, meta) { fs.writeFileSync(metaPath(file), JSON.stringify(meta, null, 2)); }
function checkName(file) {
  if (typeof file !== 'string' || !NAME.test(file) || file !== path.basename(file)) fail('Backup not found', 404);
  if (!fs.existsSync(path.join(BACKUP_DIR, file))) fail('Backup not found', 404);
  return path.join(BACKUP_DIR, file);
}
async function exclusive(kind, work) {
  if (busy) fail(`A ${busy} is already running. Try again when it has finished.`, 409);
  busy = kind;
  try { return await work(); } finally { busy = null; }
}

async function recordSetting(key, value, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value').run(key, JSON.stringify(value));
}

/** The backups on disk, newest first. */
function list() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(file => NAME.test(file)).map(file => {
    const [, day, time, kind] = file.match(NAME);
    const meta = readMeta(file);
    return { file, kind, size_bytes: fs.statSync(path.join(BACKUP_DIR, file)).size,
      created_at: meta.created_at || `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`,
      created_by: meta.created_by || null, verified_at: meta.verified_at || null, verify_result: meta.verify_result || null, verify_error: meta.verify_error || null };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.file.localeCompare(a.file));
}

async function backupNow({ kind = 'manual', userName = null } = {}, store = db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `teamhub-${stamp()}-${kind}.sql.gz`, target = path.join(BACKUP_DIR, file), partial = `${target}.partial`;
  try {
    await run('pg_dump', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--encoding=UTF8'], { env: connection(), output: [zlib.createGzip({ level: 6 }), fs.createWriteStream(partial)] });
    // The archive must read back whole before it counts as a backup.
    await pipeline(fs.createReadStream(partial), zlib.createGunzip(), new (require('stream').Writable)({ write(chunk, enc, next) { next(); } }));
    fs.renameSync(partial, target);
  } catch (error) { fs.rmSync(partial, { force: true }); throw error; }
  const size = fs.statSync(target).size, createdAt = new Date().toISOString();
  writeMeta(file, { created_at: createdAt, kind, created_by: userName });
  await recordSetting('last_backup_status', { completed_at: createdAt, file, size_bytes: size, kind }, store);
  await prune(store);
  return list().find(row => row.file === file);
}

/** Removes backups older than the retention, always keeping the newest `keep_min` (and every uploaded one). */
async function prune(store = db) {
  const { retention_days: days, keep_min: keep } = await schedule(store);
  const cutoff = Date.now() - days * 86400000;
  list().filter(row => row.kind !== 'uploaded').slice(keep).filter(row => Date.parse(row.created_at) < cutoff).forEach(row => {
    fs.rmSync(path.join(BACKUP_DIR, row.file), { force: true }); fs.rmSync(metaPath(row.file), { force: true });
  });
}

/** Restores a backup into a temporary database, checks it holds TeamHub data, then drops it. */
async function verify(file, store = db) {
  const source = checkName(file);
  // Only SQL as pg_dump writes it reaches psql.
  try { await scanFile(source); } catch (error) { writeMeta(file, { ...readMeta(file), verified_at: new Date().toISOString(), verify_result: null, verify_error: error.message }); throw error; }
  const temp = `teamhub_verify_${Date.now()}`;
  const admin = connection('postgres');
  const { Client } = require('pg');
  const client = new Client({ host: admin.PGHOST, port: Number(admin.PGPORT), user: admin.PGUSER, password: admin.PGPASSWORD, database: 'postgres', ssl: admin.PGSSLMODE && admin.PGSSLMODE !== 'disable' ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const meta = readMeta(file);
  try {
    await client.query(`CREATE DATABASE "${temp}"`);
    await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], { env: connection(temp), input: fs.createReadStream(source).pipe(zlib.createGunzip()) });
    const check = new Client({ host: admin.PGHOST, port: Number(admin.PGPORT), user: admin.PGUSER, password: admin.PGPASSWORD, database: temp, ssl: client.connectionParameters.ssl });
    await check.connect();
    let result;
    try {
      const [tables, users, migrations] = await Promise.all([
        check.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"),
        check.query('SELECT COUNT(*)::int AS n FROM users'),
        check.query('SELECT COUNT(*)::int AS n FROM schema_migrations').catch(() => ({ rows: [{ n: 0 }] })),
      ]);
      result = { tables: tables.rows[0].n, users: users.rows[0].n, migrations: migrations.rows[0].n };
    } finally { await check.end(); }
    if (!result.tables || !result.users) fail('The backup restored, but it has no TeamHub users in it');
    const at = new Date().toISOString();
    writeMeta(file, { ...meta, verified_at: at, verify_result: result, verify_error: null });
    await recordSetting('last_restore_verification', { completed_at: at, file, ...result }, store);
    return { file, verified_at: at, ...result };
  } catch (error) {
    writeMeta(file, { ...meta, verified_at: new Date().toISOString(), verify_result: null, verify_error: String(error.message).slice(0, 500) });
    throw error;
  } finally {
    await client.query(`DROP DATABASE IF EXISTS "${temp}" WITH (FORCE)`).catch(() => {});
    await client.end();
  }
}

/**
 * Replaces the database with a backup. A safety backup is taken first; the
 * restore runs in one transaction, so if it fails nothing changes. On success
 * the app restarts (Docker brings it back up) and records the restore.
 */
async function restore(file, { userName = null } = {}, store = db) {
  const source = checkName(file);
  await scanFile(source);
  const safety = await backupNow({ kind: 'before-restore', userName }, store);
  restoring = true;
  try {
    const env = { ...connection(), PGOPTIONS: '-c lock_timeout=60000' };
    // Close everyone else's connections (including this app's idle ones), then restore.
    const prefix = require('stream').Readable.from(["SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';\n"]);
    const body = fs.createReadStream(source).pipe(zlib.createGunzip());
    async function* both() { for await (const chunk of prefix) yield chunk; for await (const chunk of body) yield chunk; }
    await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], { env, input: require('stream').Readable.from(both()) });
    const at = new Date().toISOString();
    await recordSetting('last_restore', { completed_at: at, file, safety_backup: safety.file, by: userName }, store).catch(() => {});
    await recordSetting('last_backup_status', { completed_at: safety.created_at, file: safety.file, size_bytes: safety.size_bytes, kind: safety.kind }, store).catch(() => {});
    exitAfterRestore();
    return { restored: file, safety_backup: safety.file, restarting: true };
  } catch (error) {
    restoring = false;
    throw Object.assign(new Error(`The restore did not complete, and the database was left as it was. ${error.message}`), { status: 500 });
  }
}

/** Saves an uploaded backup (gzipped SQL from TeamHub or deploy/backup.sh) after checking it. */
async function importUpload(tempPath, { userName = null } = {}) {
  // The whole file is checked: it must be plain SQL as pg_dump writes it.
  await scanFile(tempPath);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `teamhub-${stamp()}-uploaded.sql.gz`;
  fs.copyFileSync(tempPath, path.join(BACKUP_DIR, file));
  writeMeta(file, { created_at: new Date().toISOString(), kind: 'uploaded', created_by: userName });
  return list().find(row => row.file === file);
}

function remove(file) {
  const target = checkName(file);
  fs.rmSync(target, { force: true }); fs.rmSync(metaPath(file), { force: true });
}

async function schedule(store = db) {
  const row = await store.prepare("SELECT value FROM settings WHERE key='backup_schedule'").get();
  let stored = {}; try { stored = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  return { ...DEFAULT_SCHEDULE, ...stored };
}
function validateSchedule(body) {
  if (!body || typeof body !== 'object') fail('Backup schedule is required');
  if (typeof body.enabled !== 'boolean') fail('enabled must be true or false');
  if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) fail('Time must be HH:MM');
  const days = Number(body.retention_days), keep = Number(body.keep_min);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) fail('Keep backups for 1 to 3650 days');
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 100) fail('Always keep 1 to 100 backups');
  return { enabled: body.enabled, time: body.time, retention_days: days, keep_min: keep };
}

/** Called every minute: takes today's scheduled backup once its time has passed. */
async function runDue(now = new Date(), store = db) {
  if (busy || restoring) return null;
  const plan = await schedule(store);
  if (!plan.enabled) return null;
  const { hour, minute } = appTime.localParts(now);
  const [h, m] = plan.time.split(':').map(Number);
  if (hour * 60 + minute < h * 60 + m) return null;
  const today = appTime.today(now);
  // Today's means made after today's scheduled time (in the organisation's zone).
  if (list().some(row => row.kind === 'scheduled' && appTime.today(new Date(row.created_at)) === today)) return null;
  return require('./backgroundJobs').enqueue('database_backup', { kind: 'scheduled' }, { dedupeKey: `database-backup:${today}`, maxAttempts: 2 });
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => runDue().catch(error => console.error('[backup] scheduler:', error.message)), 60 * 1000);
  timer.unref?.();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
  BACKUP_DIR, DEFAULT_SCHEDULE, list, backupNow, verify, restore, importUpload, remove, prune, schedule, validateSchedule, runDue, start, stop,
  status: () => ({ busy, restoring }), isRestoring: () => restoring,
  exclusive, _setExit: fn => { exitAfterRestore = fn; }, _endRestoreForTests: () => { restoring = false; },
};
