const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createArchive, readArchive, _header } = require('../uploadsArchive');

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('uploads round-trip: nested folders, long names, empty and binary files; exports left out', async () => {
  const src = tmp('arc-src-'), out = tmp('arc-out-'), dest = tmp('arc-dest-');
  const longName = `managed-report-${'x'.repeat(140)}.docx`;
  const files = { 'a.bin': crypto.randomBytes(70000), 'empty.txt': Buffer.alloc(0), [`reports/2026/${longName}`]: Buffer.from('long'), 'exports/tmp.xlsx': Buffer.from('skip') };
  for (const [name, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true }); fs.writeFileSync(path.join(src, name), data); }
  const archive = path.join(out, 'teamhub-20261011-023000-manual.files.tar.gz');
  const made = await createArchive(src, archive, { exclude: name => name === 'exports' });
  assert.deepEqual(made, { files: 3, bytes: 70004 });
  assert.deepEqual(await readArchive(archive), { files: 3, bytes: 70004 });
  await readArchive(archive, { targetDir: dest });
  for (const name of ['a.bin', 'empty.txt', `reports/2026/${longName}`]) assert.ok(fs.readFileSync(path.join(dest, name)).equals(files[name]), name);
  assert.equal(fs.existsSync(path.join(dest, 'exports')), false);

  // Plain tar can read it too (when a tar is on this machine).
  const tar = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  if (tar.status === 0) assert.ok(tar.stdout.includes(longName) && tar.stdout.includes('a.bin'), tar.stdout);
});

test('an archive with unsafe paths or links is refused and writes nothing outside the target', async () => {
  const out = tmp('arc-bad-'), dest = tmp('arc-bad-dest-');
  const make = (name, type = '0', body = Buffer.from('x')) => {
    const file = path.join(out, `${crypto.randomUUID()}.tar.gz`);
    const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
    fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([_header(name, type === '0' ? body.length : 0, { type }), type === '0' ? Buffer.concat([body, pad]) : Buffer.alloc(0), Buffer.alloc(1024)])));
    return file;
  };
  for (const name of ['../evil.txt', '/etc/evil', 'a/../../evil', 'C:/evil']) await assert.rejects(readArchive(make(name), { targetDir: dest }), /Unsafe path/, name);
  await assert.rejects(readArchive(make('link', '2'), { targetDir: dest }), /other than files and folders/);
  assert.equal(fs.existsSync(path.join(path.dirname(dest), 'evil.txt')), false);
  const damaged = path.join(out, 'damaged.tar.gz');
  fs.writeFileSync(damaged, zlib.gzipSync(Buffer.alloc(300, 7)));
  await assert.rejects(readArchive(damaged), /incomplete|damaged/);
});
