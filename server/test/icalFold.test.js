const test = require('node:test');
const assert = require('node:assert/strict');
const { fold } = require('../icalFold');

const octets = line => Buffer.byteLength(line, 'utf8');
const unfold = text => text.replace(/\r\n /g, '');

test('short lines are left alone', () => {
  assert.equal(fold('SUMMARY:Firewall check'), 'SUMMARY:Firewall check');
});

test('folds by octets, so multi-byte text never exceeds 75 bytes per line', () => {
  const line = 'SUMMARY:' + 'é'.repeat(80) + ' – ' + '🔧'.repeat(20);
  const folded = fold(line);
  for (const part of folded.split('\r\n')) assert.ok(octets(part) <= 75, `${octets(part)} octets: ${part}`);
  assert.ok(folded.split('\r\n').length > 1);
  assert.equal(unfold(folded), line, 'unfolding restores the original exactly');
});

test('a fold never splits a character or a surrogate pair', () => {
  const line = 'DESCRIPTION:' + '🔧'.repeat(40);
  const folded = fold(line);
  for (const part of folded.split('\r\n')) assert.equal(part.includes('\uFFFD'), false);
  assert.equal(unfold(folded), line);
});

test('continuation lines start with a single space', () => {
  const parts = fold('X:' + 'a'.repeat(200)).split('\r\n');
  assert.ok(parts.length >= 3);
  for (const part of parts.slice(1)) assert.equal(part[0], ' ');
});
