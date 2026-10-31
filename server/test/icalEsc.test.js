const { test } = require('node:test');
const assert = require('node:assert/strict');
const { icalEsc } = require('../routes/ical');

test('icalEsc escapes backslash, semicolon, comma and every line-break form', () => {
  assert.equal(icalEsc('a\\b'), 'a\\\\b');
  assert.equal(icalEsc('a;b'), 'a\\;b');
  assert.equal(icalEsc('a,b'), 'a\\,b');
  assert.equal(icalEsc('a\nb'), 'a\\nb');
  assert.equal(icalEsc('a\rb'), 'a\\nb', 'a lone CR must not reach the output as a raw control byte');
  assert.equal(icalEsc('a\r\nb'), 'a\\nb', 'a CRLF pair collapses to one escaped \\n, not an escaped \\n plus a raw CR');
});

test('icalEsc leaves ordinary text untouched', () => {
  assert.equal(icalEsc('ordinary title'), 'ordinary title');
  assert.equal(icalEsc(''), '');
});
