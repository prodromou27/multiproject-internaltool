const test = require('node:test');
const assert = require('node:assert/strict');
const { formatActivityReference } = require('../serviceActivities');

test('activity reference format is ACT-YYYY-NNNNNN, zero-padded to 6 digits', () => {
  assert.equal(formatActivityReference(2026, 1), 'ACT-2026-000001');
  assert.equal(formatActivityReference(2026, 42), 'ACT-2026-000042');
  assert.equal(formatActivityReference(2026, 123456), 'ACT-2026-123456');
});
