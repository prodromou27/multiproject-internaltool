const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeCell } = require('../xlsxSafety');

test('safeCell quote-prefixes values that look like a formula or start with tab/CR/LF', () => {
  for (const value of ['=cmd', '+1', '-1', '@SUM(1)', '\tx', '\rx', '\nx'])
    assert.equal(safeCell(value), `'${value}`);
});

test('safeCell leaves ordinary values untouched', () => {
  assert.equal(safeCell('ordinary title'), 'ordinary title');
  assert.equal(safeCell(42), 42);
  assert.equal(safeCell(''), '');
  assert.equal(safeCell(null), '');
  assert.equal(safeCell(undefined), '');
});
