import test from 'node:test';
import assert from 'node:assert/strict';
import { businessToday, businessNow } from '../src/utils/dates.js';

test('business today is the organisation\'s date, wherever the browser is', () => {
  // The case from the review: 22:30 UTC on 13 October is already 14 October in Cyprus.
  const at = new Date('2026-10-13T22:30:00Z');
  assert.equal(businessToday(at, 'Asia/Nicosia'), '2026-10-14');
  assert.equal(businessToday(at, 'UTC'), '2026-10-13');
  assert.equal(businessToday(at, 'America/New_York'), '2026-10-13');
});

test('month end, year end and the daylight-saving change agree with the zone', () => {
  assert.equal(businessToday(new Date('2026-10-31T21:59:00Z'), 'Asia/Nicosia'), '2026-10-31', 'still October (UTC+2 after the change)');
  assert.equal(businessToday(new Date('2026-10-31T22:00:00Z'), 'Asia/Nicosia'), '2026-11-01');
  assert.equal(businessToday(new Date('2026-12-31T22:30:00Z'), 'Asia/Nicosia'), '2027-01-01');
  assert.equal(businessToday(new Date('2026-03-29T00:30:00Z'), 'Asia/Nicosia'), '2026-03-29', 'the night clocks go forward');
  assert.equal(businessToday(new Date('2026-03-28T21:30:00Z'), 'Asia/Nicosia'), '2026-03-28');
});

test('an unknown zone falls back to the browser date; businessNow is noon of that date', () => {
  assert.match(businessToday(new Date(), 'Not/AZone'), /^\d{4}-\d{2}-\d{2}$/);
  const noon = businessNow(new Date('2026-10-13T22:30:00Z'));
  assert.equal(noon.getHours(), 12);
  assert.match(`${noon.getFullYear()}-${noon.getMonth() + 1}-${noon.getDate()}`, /^2026-10-1[34]$/);
});
