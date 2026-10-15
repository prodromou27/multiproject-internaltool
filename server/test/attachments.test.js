const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const attachments = require('../routes/attachments');

test('stored attachment names must stay inside the upload directory', () => {
  assert.equal(attachments._safeStoredName('abc123.pdf'), 'abc123.pdf');
  assert.equal(attachments._safeStoredName('../secret.pdf'), null);
  assert.equal(attachments._safeStoredName('nested/secret.pdf'), null);
  assert.equal(attachments._safeStoredName(''), null);
});

test('download names are reduced to safe header/display text', () => {
  assert.equal(attachments._safeDownloadName('../report\r\nX-Test: bad.pdf'), 'report__X-Test_ bad.pdf');
  assert.equal(attachments._safeDownloadName(''), 'download');
});

test('attachment magic-byte validation rejects spoofed html content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-test-'));
  const file = path.join(dir, 'fake.pdf');
  fs.writeFileSync(file, '<script>alert(1)</script>');

  assert.equal(attachments._hasAllowedMagic(file, 'application/pdf'), false);
});

test('attachment magic-byte validation accepts pdf and zip signatures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-test-'));
  const pdf = path.join(dir, 'doc.pdf');
  const zip = path.join(dir, 'docx.zip');
  fs.writeFileSync(pdf, Buffer.from('%PDF-1.7\n'));
  fs.writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

  assert.equal(attachments._hasAllowedMagic(pdf, 'application/pdf'), true);
  assert.equal(attachments._hasAllowedMagic(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
});
