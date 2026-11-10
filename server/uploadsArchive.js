/**
 * The uploaded files (attachments, generated customer reports…) as a standard
 * .tar.gz, so a backup holds them as well as the database. Files are stored as
 * they are on disk (attachments are already encrypted there). Being plain tar,
 * an archive can also be unpacked by hand: tar -xzf teamhub-….files.tar.gz.
 *
 * Reading refuses anything unsafe: absolute paths, "..", links and devices,
 * so extracting can only create plain files and folders inside the target.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const BLOCK = 512;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;

function header(name, size, { mode = 0o644, mtime = 0, type = '0' } = {}) {
  const b = Buffer.alloc(BLOCK);
  b.write(name.slice(0, 100), 0, 'utf8');
  b.write(octal(mode, 8), 100); b.write(octal(0, 8), 108); b.write(octal(0, 8), 116);
  b.write(octal(size, 12), 124); b.write(octal(Math.floor(mtime), 12), 136);
  b.fill(' ', 148, 156); b.write(type, 156);
  b.write('ustar\0', 257); b.write('00', 263);
  let sum = 0; for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return b;
}
const padding = size => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** A PAX header carrying a path longer than the 100 bytes ustar allows. */
function paxPath(name) {
  const body = ` path=${name}\n`;
  let len = body.length + 1; while (`${len}${body}`.length !== len) len = `${len}${body}`.length;
  const record = Buffer.from(`${len}${body}`);
  return Buffer.concat([header('PaxHeader', record.length, { type: 'x' }), record, padding(record.length)]);
}

async function* walk(root, rel = '', exclude) {
  for (const entry of await fs.promises.readdir(path.join(root, rel), { withFileTypes: true })) {
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (exclude(name, entry)) continue;
    if (entry.isDirectory()) { yield { name, dir: true }; yield* walk(root, name, exclude); }
    else if (entry.isFile()) yield { name, dir: false };
  }
}

/**
 * Writes `sourceDir` into a .tar.gz at `target`. `exclude(name, dirent)` skips
 * paths (relative, with /). Returns { files, bytes }.
 */
async function createArchive(sourceDir, target, { exclude = () => false } = {}) {
  let files = 0, bytes = 0;
  async function* blocks() {
    if (fs.existsSync(sourceDir)) {
      for await (const item of walk(sourceDir, '', exclude)) {
        const full = path.join(sourceDir, item.name), stat = await fs.promises.stat(full).catch(() => null);
        if (!stat) continue; // removed meanwhile
        const name = item.dir ? `${item.name}/` : item.name;
        if (Buffer.byteLength(name) > 100) yield paxPath(name);
        if (item.dir) { yield header(name, 0, { mode: 0o755, mtime: stat.mtimeMs / 1000, type: '5' }); continue; }
        yield header(name, stat.size, { mode: 0o600, mtime: stat.mtimeMs / 1000 });
        let written = 0;
        // Exactly stat.size bytes, even if the file grows while it is read.
        for await (const chunk of fs.createReadStream(full)) {
          const room = stat.size - written;
          if (room <= 0) break;
          const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
          written += part.length; yield part;
        }
        if (written < stat.size) yield Buffer.alloc(stat.size - written); // shrank while reading: keep the header honest
        yield padding(stat.size);
        files++; bytes += stat.size;
      }
    }
    yield Buffer.alloc(BLOCK * 2);
  }
  await pipeline(Readable.from(blocks()), zlib.createGzip({ level: 6 }), fs.createWriteStream(target));
  return { files, bytes };
}

function safeName(raw) {
  const name = raw.replace(/\/+$/, '');
  if (!name || name.includes('\0') || name.includes('\\') || path.posix.isAbsolute(name) || /^[a-zA-Z]:/.test(name)
    || name.split('/').some(part => part === '..' || part === '' || part === '.')) fail(`Unsafe path in the files archive: ${raw.slice(0, 120)}`);
  return name;
}

/**
 * Reads an archive. With `targetDir`, extracts it there (plain files and folders
 * only); without, only checks it. Returns { files, bytes }.
 */
async function readArchive(archive, { targetDir = null } = {}) {
  let pending = Buffer.alloc(0), state = 'header', current = null, remaining = 0, pad = 0, nextPath = null, pax = null, ended = false;
  let files = 0, bytes = 0;
  const parseOctal = (b, start, len) => parseInt(b.toString('latin1', start, start + len).replace(/\0.*$/, '').trim() || '0', 8);
  async function onHeader(h) {
    if (h.every(byte => byte === 0)) { ended = true; return; }
    let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseOctal(h, 148, 8)) fail('The files archive is damaged (bad header checksum)');
    const type = String.fromCharCode(h[156] || 48), size = parseOctal(h, 124, 12);
    const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    const raw = nextPath || (prefix ? `${prefix}/` : '') + h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    nextPath = null;
    remaining = size; pad = (BLOCK - (size % BLOCK)) % BLOCK;
    if (type === 'x') { pax = []; current = { pax: true }; return; }
    if (type === 'g') { current = { skip: true }; return; }
    if (type === '5') { const name = safeName(raw); if (targetDir) await fs.promises.mkdir(path.join(targetDir, name), { recursive: true }); current = { skip: true }; return; }
    if (type !== '0' && type !== '\0' && type !== '7') fail(`The files archive holds something other than files and folders (type ${type}): ${raw.slice(0, 120)}`);
    const name = safeName(raw);
    files++; bytes += size;
    if (targetDir) {
      const full = path.join(targetDir, name);
      if (!path.resolve(full).startsWith(path.resolve(targetDir) + path.sep)) fail('Unsafe path in the files archive');
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      current = { stream: fs.createWriteStream(full, { mode: 0o600 }) };
      if (!size) { await new Promise((res, rej) => current.stream.end(e => (e ? rej(e) : res()))); current = { skip: true }; }
    } else current = { skip: true };
  }
  async function consume(chunk) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (!ended) {
      if (state === 'header') {
        if (pending.length < BLOCK) return;
        const h = pending.subarray(0, BLOCK); pending = pending.subarray(BLOCK);
        await onHeader(h);
        if (!ended) state = remaining ? 'data' : 'header';
      } else if (state === 'data') {
        if (!pending.length) return;
        const take = Math.min(remaining, pending.length), part = pending.subarray(0, take);
        pending = pending.subarray(take); remaining -= take;
        if (current.pax) pax.push(part);
        else if (current.stream && !current.stream.write(part)) await new Promise(res => current.stream.once('drain', res));
        if (!remaining) {
          if (current.pax) { const m = Buffer.concat(pax).toString('utf8').match(/\d+ path=([^\n]*)\n/); nextPath = m ? m[1] : null; }
          if (current.stream) await new Promise((res, rej) => current.stream.end(e => (e ? rej(e) : res())));
          current = null; state = pad ? 'pad' : 'header';
        }
      } else {
        if (pending.length < pad) { pad -= pending.length; pending = Buffer.alloc(0); return; }
        pending = pending.subarray(pad); pad = 0; state = 'header';
      }
    }
  }
  try {
    for await (const chunk of fs.createReadStream(archive).pipe(zlib.createGunzip())) await consume(chunk);
  } catch (error) {
    if (current?.stream) current.stream.destroy();
    if (error.status) throw error;
    fail(`The files archive could not be read: ${error.message}`);
  }
  if (!ended) fail('The files archive is incomplete');
  return { files, bytes };
}

module.exports = { createArchive, readArchive, _header: header };
