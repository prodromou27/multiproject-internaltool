const test = require('node:test');
const assert = require('node:assert/strict');
const { occurrence, firstOnOrAfter, validateTemplate } = require('../recurringTasks');

test('occurrences keep the day of the month, and month ends', () => {
  assert.equal(occurrence('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(occurrence('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(occurrence('2028-01-31', 'monthly', 1), '2028-02-29');
  assert.equal(occurrence('2026-01-15', 'quarterly', 3), '2026-10-15');
  assert.equal(occurrence('2026-11-30', 'semiannual', 1), '2027-05-30');
  assert.equal(occurrence('2026-02-28', 'annual', 2), '2028-02-28');
  assert.equal(occurrence('2026-10-01', 'weekly', 4), '2026-10-29');
});

test('the next occurrence on or after a day', () => {
  assert.deepEqual(firstOnOrAfter('2026-01-15', 'monthly', '2026-10-06'), { n: 9, date: '2026-10-15' });
  assert.deepEqual(firstOnOrAfter('2026-01-15', 'monthly', '2026-10-16'), { n: 10, date: '2026-11-15' });
  assert.deepEqual(firstOnOrAfter('2026-01-15', 'monthly', '2026-10-15'), { n: 9, date: '2026-10-15' });
  assert.deepEqual(firstOnOrAfter('2026-12-01', 'quarterly', '2026-10-06'), { n: 0, date: '2026-12-01' });
  assert.deepEqual(firstOnOrAfter('2026-09-07', 'weekly', '2026-10-06'), { n: 5, date: '2026-10-12' });
});

test('templates are validated', () => {
  const ok = { title: 'Backup check', frequency: 'monthly', start_date: '2026-11-01' };
  assert.deepEqual(validateTemplate(ok).value, { title: 'Backup check', priority: 'medium', frequency: 'monthly', start_date: '2026-11-01', lead_days: 7, assigned_to: null, active: 1 });
  for (const bad of [{ ...ok, title: ' ' }, { ...ok, frequency: 'daily' }, { ...ok, start_date: '2026-02-30' }, { ...ok, lead_days: 91 }, { ...ok, lead_days: 1.5 }, { ...ok, priority: 'urgent' }, { ...ok, assigned_to: 'x' }, { ...ok, active: 'yes' }])
    assert.ok(validateTemplate(bad).error, JSON.stringify(bad));
});
