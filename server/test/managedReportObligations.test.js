const test = require('node:test');
const assert = require('node:assert/strict');
const { periodFor, REPORT_DUE_DAYS } = require('../managedReportObligations');

test('the owed period is the last complete one for each frequency', () => {
  const pick = value => [value.from, value.to, value.label, value.due_date];
  assert.equal(REPORT_DUE_DAYS, 10);
  assert.deepEqual(pick(periodFor('monthly', '2026-10-05')), ['2026-09-01', '2026-09-30', 'September 2026', '2026-10-10']);
  assert.deepEqual(pick(periodFor('Monthly', '2026-01-15')), ['2025-12-01', '2025-12-31', 'December 2025', '2026-01-10']);
  assert.deepEqual(pick(periodFor('monthly', '2026-03-01')), ['2026-02-01', '2026-02-28', 'February 2026', '2026-03-10']);
  assert.deepEqual(pick(periodFor('quarterly', '2026-10-05')), ['2026-07-01', '2026-09-30', 'Q3 2026', '2026-10-10']);
  assert.deepEqual(pick(periodFor('quarterly', '2026-02-20')), ['2025-10-01', '2025-12-31', 'Q4 2025', '2026-01-10']);
  assert.deepEqual(pick(periodFor('semiannual', '2026-10-05')), ['2026-01-01', '2026-06-30', 'H1 2026', '2026-07-10']);
  assert.deepEqual(pick(periodFor('annual', '2026-10-05')), ['2025-01-01', '2025-12-31', '2025', '2026-01-10']);
  assert.deepEqual(pick(periodFor('monthly', '2026-10-05', 0)), ['2026-10-01', '2026-10-31', 'October 2026', '2026-11-10']);
  assert.equal(periodFor('weekly', '2026-10-05'), null);
  assert.equal(periodFor('', '2026-10-05'), null);
});

test('a customer can have its own report due window; anything invalid falls back to the standard one', () => {
  assert.equal(periodFor('monthly', '2026-10-05', -1, 30).due_date, '2026-10-30');
  assert.equal(periodFor('quarterly', '2026-10-05', -1, 45).due_date, '2026-11-14');
  assert.equal(periodFor('monthly', '2026-10-05', -1, 0).due_date, '2026-09-30');
  for (const fallback of [null, undefined, '', -1, 121, 'x', 2.5]) assert.equal(periodFor('monthly', '2026-10-05', -1, fallback).due_date, '2026-10-10', String(fallback));
});
