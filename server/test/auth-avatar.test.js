const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const authRouter = require('../routes/auth');

test('avatar magic-byte validation rejects spoofed html content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-test-'));
  const file = path.join(dir, 'avatar.jpg');
  fs.writeFileSync(file, '<script>alert(1)</script>');

  assert.equal(authRouter._hasValidImageMagic(file, 'image/jpeg'), false);
});

test('avatar magic-byte validation accepts png content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-test-'));
  const file = path.join(dir, 'avatar.png');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));

  assert.equal(authRouter._hasValidImageMagic(file, 'image/png'), true);
});
