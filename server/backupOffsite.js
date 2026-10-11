/**
 * Off-server copies of database backups (Settings → Backups): over SFTP, and/or
 * to a network share (an SMB/NFS folder mounted into the container).
 *
 * After each backup the file is encrypted (AES-256-GCM, key from a passphrase
 * the manager sets, scrypt with a random salt per file) and uploaded to a folder
 * on the SFTP server. The server's host key must be pinned first: "Test
 * connection" shows its SHA256 fingerprint and the manager trusts it; after
 * that only a server presenting that key receives backups. Copies older than the
 * backup retention are removed from the server, keeping the newest keep_min.
 *
 * Network share: a folder under BACKUP_SHARE_ROOT (default /mnt) that the Docker
 * host has mounted from a NAS or file server. The same encryption and retention
 * apply, and only teamhub-….sql.gz.enc files are ever written or removed there.
 *
 * Encrypted file: "THBKENC1" | salt (16) | iv (12) | ciphertext | GCM tag (16).
 * deploy/decrypt-backup.js turns one back into the .sql.gz the app restores.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const db = require('./db');
const { encrypt, decrypt } = require('./fieldCipher');

const MAGIC = Buffer.from('THBKENC1');
const SETTING = 'backup_offsite', STATUS = 'backup_offsite_status';
const SHARE = 'backup_share', SHARE_STATUS = 'backup_share_status';
const shareRoot = () => path.resolve(process.env.BACKUP_SHARE_ROOT || '/mnt');
const COPY_NAME = /^teamhub-(\d{8})-(\d{6})-[a-z-]+\.sql\.gz\.enc$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const keyFor = (passphrase, salt) => crypto.scryptSync(passphrase, salt, 32, SCRYPT);

async function encryptFile(source, target, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  const out = fs.createWriteStream(target);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(source), cipher, out, { end: false }).catch(error => { out.destroy(); throw error; });
  await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), error => (error ? reject(error) : resolve())));
}

async function decryptFile(source, target, passphrase) {
  const size = fs.statSync(source).size, header = MAGIC.length + 28;
  if (size < header + 16) fail('This is not an encrypted TeamHub backup');
  const fd = fs.openSync(source, 'r');
  const head = Buffer.alloc(header), tag = Buffer.alloc(16);
  try { fs.readSync(fd, head, 0, header, 0); fs.readSync(fd, tag, 0, 16, size - 16); } finally { fs.closeSync(fd); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) fail('This is not an encrypted TeamHub backup');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16), iv = head.subarray(MAGIC.length + 16, header);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try { await pipeline(fs.createReadStream(source, { start: header, end: size - 17 }), decipher, fs.createWriteStream(target)); }
  catch (error) { fs.rmSync(target, { force: true }); fail(/auth/i.test(error.message) ? 'Wrong passphrase, or the file is damaged' : error.message); }
}

// ── Settings ───────────────────────────────────────────────────────────────
async function readJson(key, store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  try { return JSON.parse(row?.value || 'null'); } catch { return null; }
}
async function writeJson(key, value, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(key, JSON.stringify(value));
}
async function config(store = db) {
  const stored = await readJson(SETTING, store) || {};
  return { enabled: false, port: 22, remote_dir: '/teamhub-backups', ...stored };
}
/** What the settings page may see: no secrets, only whether each is set. */
function publicView(cfg, status) {
  return { enabled: !!cfg.enabled, host: cfg.host || '', port: cfg.port, username: cfg.username || '', auth_method: cfg.auth_method || 'password',
    remote_dir: cfg.remote_dir, host_fingerprint: cfg.host_fingerprint || null, seen_fingerprint: cfg.seen_fingerprint || null,
    has_password: !!cfg.password, has_private_key: !!cfg.private_key, has_passphrase: !!cfg.encryption_passphrase, last: status || null };
}

const text = (value, label, max, { required = false } = {}) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') { if (required) fail(`${label} is required`); return ''; }
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be text of at most ${max} characters`);
  return value.trim();
};

/** Saves settings. Secrets are kept unless new ones are given; a new host or port forgets the trusted key. */
async function saveConfig(body, store = db) {
  if (!body || typeof body !== 'object') fail('Settings are required');
  const current = await config(store), next = { ...current };
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') fail('enabled must be true or false'); next.enabled = body.enabled; }
  const host = text(body.host, 'Host', 255);
  if (host !== undefined) { if (host && !/^[a-zA-Z0-9.\-:[\]]+$/.test(host)) fail('Host must be a host name or IP address'); next.host = host; }
  if (body.port !== undefined) { const port = Number(body.port); if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail('Port must be 1 to 65535'); next.port = port; }
  const username = text(body.username, 'User', 100); if (username !== undefined) next.username = username;
  if (body.auth_method !== undefined) { if (!['password', 'key'].includes(body.auth_method)) fail('Sign in with a password or a key'); next.auth_method = body.auth_method; }
  const dir = text(body.remote_dir, 'Folder', 500);
  if (dir !== undefined) { if (!dir.startsWith('/') || dir.includes('..')) fail('Folder must be an absolute path such as /backups/teamhub'); next.remote_dir = dir.replace(/\/+$/, '') || '/'; }
  // sftp_password: the request's own `password` is the manager's, confirming the change.
  const password = text(body.sftp_password, 'SFTP password', 500); if (password) next.password = encrypt(password);
  const key = text(body.private_key, 'Private key', 20000);
  if (key) { if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) fail('The private key must be in PEM/OpenSSH format'); next.private_key = encrypt(key); }
  const keyPassphrase = text(body.key_passphrase, 'Key passphrase', 500); if (keyPassphrase !== undefined) next.key_passphrase = keyPassphrase ? encrypt(keyPassphrase) : null;
  const passphrase = text(body.encryption_passphrase, 'Encryption passphrase', 500);
  if (passphrase) { if (passphrase.length < 12) fail('Use an encryption passphrase of at least 12 characters'); next.encryption_passphrase = encrypt(passphrase); }
  if (next.host !== current.host || Number(next.port) !== Number(current.port)) { next.host_fingerprint = null; next.seen_fingerprint = null; }
  if (next.enabled) {
    if (!next.host || !next.username) fail('Enter the host and user before turning copies on');
    if (next.auth_method === 'key' ? !next.private_key : !next.password) fail(next.auth_method === 'key' ? 'Add the private key' : 'Add the password');
    if (!next.encryption_passphrase) fail('Set the encryption passphrase before turning copies on');
    if (!next.host_fingerprint) fail('Test the connection and trust the server key before turning copies on');
  }
  await writeJson(SETTING, next, store);
  return next;
}

/** Copies to remove: past the retention by the time in their name, always keeping the newest keepMin. */
function expiredCopies(names, retentionDays, keepMin, now = Date.now()) {
  const cutoff = now - retentionDays * 86400000;
  return names.filter(n => COPY_NAME.test(n)).sort().reverse().slice(keepMin).filter(name => {
    const [, d, t] = name.match(COPY_NAME);
    return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`) < cutoff;
  });
}

// ── SFTP ───────────────────────────────────────────────────────────────────
const fingerprintOf = key => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** Opens an SFTP session. With `pinned`, refuses a server whose key differs. Resolves { client, sftp, fingerprint }. */
function connect(cfg, { pinned = cfg.host_fingerprint, timeoutMs = 15000 } = {}) {
  const { Client } = require('ssh2');
  return new Promise((resolve, reject) => {
    const client = new Client();
    let seen = null;
    client.on('ready', () => client.sftp((error, sftp) => (error ? (client.end(), reject(error)) : resolve({ client, sftp, fingerprint: seen }))));
    client.on('error', error => reject(Object.assign(new Error(seen && pinned && seen !== pinned
      ? `The server's key changed (${seen}). If that is expected, test the connection and trust the new key.`
      : `Could not connect: ${error.message}`), { status: 400 })));
    client.connect({
      host: cfg.host, port: Number(cfg.port) || 22, username: cfg.username, readyTimeout: timeoutMs,
      ...(cfg.auth_method === 'key' ? { privateKey: decrypt(cfg.private_key), passphrase: cfg.key_passphrase ? decrypt(cfg.key_passphrase) : undefined } : { password: decrypt(cfg.password) }),
      hostVerifier: key => { seen = fingerprintOf(key); return !pinned || seen === pinned; },
    });
  });
}
const call = (sftp, method, ...args) => new Promise((resolve, reject) => sftp[method](...args, (error, value) => (error ? reject(error) : resolve(value))));

async function ensureDir(sftp, dir) {
  let at = '';
  for (const part of dir.split('/').filter(Boolean)) {
    at += `/${part}`;
    try { await call(sftp, 'stat', at); } catch { await call(sftp, 'mkdir', at); }
  }
}

/** Connects without trusting yet, checks the folder can be written, and remembers the key it saw. */
async function testConnection(store = db) {
  const cfg = await config(store);
  if (!cfg.host || !cfg.username) fail('Enter the host and user first');
  const { client, sftp, fingerprint } = await connect(cfg, { pinned: null });
  try {
    await ensureDir(sftp, cfg.remote_dir);
    const probe = `${cfg.remote_dir}/.teamhub-write-test-${Date.now()}`;
    await new Promise((resolve, reject) => { const w = sftp.createWriteStream(probe); w.on('error', reject); w.on('close', resolve); w.end('ok'); });
    await call(sftp, 'unlink', probe);
  } catch (error) { fail(`Connected, but could not write to ${cfg.remote_dir}: ${error.message}`); }
  finally { client.end(); }
  await writeJson(SETTING, { ...cfg, seen_fingerprint: fingerprint }, store);
  return { fingerprint, trusted: fingerprint === cfg.host_fingerprint };
}

async function trust(fingerprint, store = db) {
  const cfg = await config(store);
  if (!cfg.seen_fingerprint || fingerprint !== cfg.seen_fingerprint) fail('Test the connection first, then trust the key it shows');
  await writeJson(SETTING, { ...cfg, host_fingerprint: fingerprint }, store);
}

/** Encrypts one backup and uploads it; then removes copies past the retention. */
async function copyBackup(file, { backupDir, retentionDays, keepMin, store = db } = {}) {
  const cfg = await config(store);
  if (!cfg.enabled) return { skipped: 'Off-server copies are off' };
  if (!cfg.host_fingerprint) fail('Trust the server key first');
  const source = path.join(backupDir, file);
  if (!fs.existsSync(source)) fail('Backup not found', 404);
  const temp = path.join(backupDir, `.${file}.enc.partial`), remote = `${cfg.remote_dir}/${file}.enc`;
  const started = new Date().toISOString();
  try {
    await encryptFile(source, temp, decrypt(cfg.encryption_passphrase));
    const { client, sftp } = await connect(cfg);
    try {
      await ensureDir(sftp, cfg.remote_dir);
      await call(sftp, 'fastPut', temp, `${remote}.partial`);
      try { await call(sftp, 'unlink', remote); } catch { /* first copy */ }
      await call(sftp, 'rename', `${remote}.partial`, remote);
      const size = (await call(sftp, 'stat', remote)).size;
      const names = (await call(sftp, 'readdir', cfg.remote_dir)).map(e => e.filename);
      const old = expiredCopies(names, retentionDays, keepMin);
      for (const name of old) await call(sftp, 'unlink', `${cfg.remote_dir}/${name}`);
      const removed = old.length;
      const status = { ok: true, file, remote, size_bytes: size, removed, started_at: started, completed_at: new Date().toISOString() };
      await writeJson(STATUS, status, store);
      return status;
    } finally { client.end(); }
  } catch (error) {
    await writeJson(STATUS, { ok: false, file, error: error.message, started_at: started, completed_at: new Date().toISOString() }, store);
    throw error;
  } finally { fs.rmSync(temp, { force: true }); }
}

// ── Network share ────────────────────────────────────────────────────────────
async function shareConfig(store = db) {
  return { enabled: false, path: path.join(shareRoot(), 'backup-share'), ...(await readJson(SHARE, store) || {}) };
}

/** The share folder, checked: absolute, inside BACKUP_SHARE_ROOT, existing, a folder, and writable. */
function checkShareFolder(folder) {
  if (typeof folder !== 'string' || !folder.trim() || !path.isAbsolute(folder.trim())) fail('Folder must be an absolute path such as /mnt/backup-share');
  const resolved = path.resolve(folder.trim()), root = shareRoot();
  if (resolved === root || !resolved.startsWith(root + path.sep)) fail(`The folder must be inside ${root} (where the share is mounted into the container)`);
  let stat;
  try { stat = fs.statSync(resolved); } catch { fail(`${resolved} does not exist. Mount the share there first (see deploy/README.md).`); }
  if (!stat.isDirectory()) fail(`${resolved} is not a folder`);
  // A share that is not mounted leaves an empty folder on the container's own disk:
  // copies there would not leave the server. On Linux, require a separate filesystem.
  if (process.platform === 'linux' && process.env.BACKUP_SHARE_REQUIRE_MOUNT !== '0' && stat.dev === fs.statSync('/').dev)
    fail(`${resolved} is not a mounted share (it is on the container's own disk). Mount the share there first (see deploy/README.md).`);
  const probe = path.join(resolved, `.teamhub-write-test-${process.pid}-${Date.now()}`);
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true }); } catch (error) { fail(`TeamHub cannot write to ${resolved}: ${error.code || error.message}`); }
  return resolved;
}

async function testShare(store = db) {
  const folder = checkShareFolder((await shareConfig(store)).path);
  let free = null;
  try { const s = fs.statfsSync(folder); free = Number(s.bavail) * Number(s.bsize); } catch { /* not every system reports it */ }
  const copies = fs.readdirSync(folder).filter(n => COPY_NAME.test(n)).length;
  return { path: folder, free_bytes: free, copies };
}

async function saveShare(body, store = db) {
  if (!body || typeof body !== 'object') fail('Settings are required');
  const next = { ...(await shareConfig(store)) };
  if (body.path !== undefined) {
    const raw = typeof body.path === 'string' ? body.path.trim() : '';
    if (!raw || !path.isAbsolute(raw)) fail('Folder must be an absolute path such as /mnt/backup-share');
    next.path = path.resolve(raw);
  }
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') fail('enabled must be true or false'); next.enabled = body.enabled; }
  if (body.path !== undefined || next.enabled) checkShareFolder(next.path);
  if (next.enabled && !(await config(store)).encryption_passphrase) fail('Set the encryption passphrase before turning copies on');
  await writeJson(SHARE, next, store);
  return next;
}

/** Encrypts one backup into the share folder (written under a temporary name, then renamed), then removes old copies. */
async function copyToShare(file, { backupDir, retentionDays, keepMin, store = db } = {}) {
  const cfg = await shareConfig(store);
  if (!cfg.enabled) return { skipped: 'Copies to the network share are off' };
  const passphrase = (await config(store)).encryption_passphrase;
  if (!passphrase) fail('Set the encryption passphrase first');
  const source = path.join(backupDir, file);
  if (!fs.existsSync(source)) fail('Backup not found', 404);
  const started = new Date().toISOString();
  let partial = null;
  try {
    const folder = checkShareFolder(cfg.path), target = path.join(folder, `${file}.enc`);
    partial = `${target}.partial`;
    await encryptFile(source, partial, decrypt(passphrase));
    fs.renameSync(partial, target); partial = null;
    const old = expiredCopies(fs.readdirSync(folder), retentionDays, keepMin);
    for (const name of old) fs.rmSync(path.join(folder, name), { force: true });
    const status = { ok: true, file, target, size_bytes: fs.statSync(target).size, removed: old.length, started_at: started, completed_at: new Date().toISOString() };
    await writeJson(SHARE_STATUS, status, store);
    return status;
  } catch (error) {
    if (partial) fs.rmSync(partial, { force: true });
    await writeJson(SHARE_STATUS, { ok: false, file, error: error.message, started_at: started, completed_at: new Date().toISOString() }, store);
    throw error;
  }
}

module.exports = {
  shareConfig, saveShare, testShare, copyToShare, shareStatus: store => readJson(SHARE_STATUS, store), shareRoot, expiredCopies, MAGIC, encryptFile, decryptFile, config, publicView, saveConfig, testConnection, trust, copyBackup, fingerprintOf, status: store => readJson(STATUS, store) };
