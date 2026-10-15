import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatNumber, DEFAULT_LOCALE_CONFIG } from '../src/utils/locale.js';

const cfg = fmt => ({ ...DEFAULT_LOCALE_CONFIG, ...fmt });

test('formatDate renders every configured pattern without shifting the calendar day', () => {
  assert.equal(formatDate('2026-09-22', cfg({ date_format: 'DD/MM/YYYY' })), '22/09/2026');
  assert.equal(formatDate('2026-09-22', cfg({ date_format: 'MM/DD/YYYY' })), '09/22/2026');
  assert.equal(formatDate('2026-09-22', cfg({ date_format: 'YYYY-MM-DD' })), '2026-09-22');
  assert.equal(formatDate('2026-09-22', cfg({ date_format: 'D MMM YYYY' })), '22 Sep 2026');
  assert.equal(formatDate('2026-09-22', cfg({ date_format: 'MMM D, YYYY' })), 'Sep 22, 2026');
  // A midnight-adjacent UTC timestamp must not roll the calendar date backward/forward.
  assert.equal(formatDate('2026-09-22T23:59:00Z', cfg({})), '22/09/2026');
  assert.equal(formatDate(null, cfg({})), null);
  assert.equal(formatDate('not a date', cfg({})), '—');
});

test('formatDateTime converts into the configured timezone and time format', () => {
  // 2026-09-22 00:30 UTC is 2026-09-22 03:30 in Asia/Nicosia (UTC+3 in September).
  assert.equal(formatDateTime('2026-09-22T00:30:00Z', cfg({ timezone: 'Asia/Nicosia', time_format: '24h' })), '22/09/2026, 03:30');
  assert.equal(formatDateTime('2026-09-22T00:30:00Z', cfg({ timezone: 'Asia/Nicosia', time_format: '12h' })), '22/09/2026, 3:30 AM');
  // Crossing a calendar day boundary via timezone conversion.
  assert.equal(formatDateTime('2026-09-22T23:30:00Z', cfg({ timezone: 'Asia/Nicosia', date_format: 'YYYY-MM-DD' })), '2026-09-23, 02:30');
  assert.equal(formatDateTime('2026-01-01T00:00:00Z', cfg({ timezone: 'UTC', time_format: '12h' })), '01/01/2026, 12:00 AM');
  assert.equal(formatDateTime(null, cfg({})), '—');
  assert.equal(formatDateTime('garbage', cfg({})), '—');
});

test('formatDateTime falls back to local time instead of throwing on an unknown timezone', () => {
  assert.doesNotThrow(() => formatDateTime('2026-09-22T00:30:00Z', cfg({ timezone: 'Not/AZone' })));
});

test('formatNumber applies the configured group and decimal separators', () => {
  assert.equal(formatNumber(1234567, cfg({ number_format: '1,000.00' })), '1,234,567');
  assert.equal(formatNumber(1234567.5, cfg({ number_format: '1.000,00' })), '1.234.567,50');
  assert.equal(formatNumber(1234.5, cfg({ number_format: '1 000.00' })), '1 234.50');
  assert.equal(formatNumber(1234, cfg({ number_format: '1000.00' })), '1234');
  assert.equal(formatNumber(-1234.5, cfg({ number_format: '1,000.00' })), '-1,234.50');
  assert.equal(formatNumber(0, cfg({})), '0');
  assert.equal(formatNumber(null, cfg({})), '—');
  assert.equal(formatNumber('abc', cfg({})), '—');
  assert.equal(formatNumber(7.5, cfg({}), { decimals: 1 }), '7.5');
});
