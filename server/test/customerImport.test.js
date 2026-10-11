const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, yesNo } = require('../customerImport');

test('CSV: commas, semicolons (Excel in many locales), quotes, BOM and blank lines', () => {
  assert.deepEqual(parseCsv('name,managed\r\nAcme,yes\r\n"Beta, Ltd",no\r\n'), [{ name: 'Acme', managed: 'yes' }, { name: 'Beta, Ltd', managed: 'no' }]);
  assert.deepEqual(parseCsv('﻿name;notes\n"Quote ""Co""";"two\nlines"\n\n'), [{ name: 'Quote "Co"', notes: 'two\nlines' }]);
  assert.deepEqual(parseCsv('name\tteam\nGamma\tSecurity Team'), [{ name: 'Gamma', team: 'Security Team' }]);
  assert.deepEqual(parseCsv('name,managed\nDelta'), [{ name: 'Delta', managed: '' }], 'short rows fill with blanks');
  assert.deepEqual(parseCsv(''), []);
});

test('managed accepts yes/no in common spellings and refuses anything else', () => {
  for (const v of ['yes', 'Y', 'TRUE', '1', 'x', 'Managed']) assert.equal(yesNo(v), true, v);
  for (const v of ['', 'no', 'N', 'false', '0', '-']) assert.equal(yesNo(v), false, v);
  assert.equal(yesNo('maybe'), null);
});
