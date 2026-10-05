const test = require('node:test');
const assert = require('node:assert/strict');
const { nextOccurrence, fromLocal, automaticSettings } = require('../reminders');

test('repeating reminders keep their local time, across daylight saving and short months', () => {
  // Cyprus leaves summer time on 25 October 2026: 09:00 local is 06:00 UTC before and 07:00 UTC after.
  const before = fromLocal({ year: 2026, month: 10, day: 20, hour: 9, minute: 0 }, 'Asia/Nicosia').toISOString();
  assert.equal(before, '2026-10-20T06:00:00.000Z');
  assert.equal(nextOccurrence(before, 'weekly', 'Asia/Nicosia'), '2026-10-27T07:00:00.000Z');
  assert.equal(nextOccurrence('2026-10-24T06:00:00.000Z', 'daily', 'Asia/Nicosia'), '2026-10-25T07:00:00.000Z');
  // The 31st of a month falls back to the last day of shorter months.
  assert.equal(nextOccurrence('2026-01-31T08:30:00.000Z', 'monthly', 'UTC'), '2026-02-28T08:30:00.000Z');
  assert.equal(nextOccurrence('2028-02-29T08:30:00.000Z', 'yearly', 'UTC'), '2029-02-28T08:30:00.000Z');
  assert.equal(nextOccurrence('2026-10-20T06:00:00.000Z', 'none', 'UTC'), null);
});

test('automatic reminders default on, and only managers get the customer ones', () => {
  assert.deepEqual(automaticSettings(null, 'engineer'), { visit_tomorrow: true, task_due: true });
  assert.deepEqual(automaticSettings('{"report_due":false}', 'manager'), { visit_tomorrow: true, task_due: true, report_due: false, asset_expiring: true });
  assert.deepEqual(automaticSettings('not json', 'engineer'), { visit_tomorrow: true, task_due: true });
});
