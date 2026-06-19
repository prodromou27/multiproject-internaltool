const test = require('node:test');
const assert = require('node:assert/strict');

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
