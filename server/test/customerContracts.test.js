const test = require('node:test');
const assert = require('node:assert/strict');
const { contractStatus, currentContract } = require('../customerContracts');

test('contract status comes from the dates; ending soon is the last 30 days', () => {
  const today = '2026-10-11';
  const status = (start_date, end_date, renewed) => contractStatus({ start_date, end_date }, today, renewed);
  assert.equal(status('2026-01-01', '2026-12-31'), 'active');
  assert.equal(status('2026-01-01', '2026-11-10'), 'ending_soon');
  assert.equal(status('2026-01-01', '2026-11-11'), 'active');
  assert.equal(status('2026-01-01', '2026-10-11'), 'ending_soon', 'the last day still counts');
  assert.equal(status('2025-01-01', '2026-10-10'), 'expired');
  assert.equal(status('2026-10-12', '2027-10-11'), 'upcoming');
  assert.equal(status('2025-01-01', '2026-10-10', true), 'renewed');
});

test('the current contract is the one in force, else the next, else the last', () => {
  const c = (id, status, start_date, end_date) => ({ id, status, start_date, end_date });
  assert.equal(currentContract([c(1, 'expired', '2025-01-01', '2025-12-31'), c(2, 'active', '2026-01-01', '2026-12-31'), c(3, 'upcoming', '2027-01-01', '2027-12-31')]).id, 2);
  assert.equal(currentContract([c(1, 'expired', '2025-01-01', '2025-12-31'), c(3, 'upcoming', '2027-01-01', '2027-12-31')]).id, 3);
  assert.equal(currentContract([c(1, 'expired', '2024-01-01', '2024-12-31'), c(2, 'renewed', '2025-01-01', '2025-12-31')]).id, 2);
  assert.equal(currentContract([]), null);
});
