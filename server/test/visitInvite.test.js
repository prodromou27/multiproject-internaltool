const test = require('node:test');
const assert = require('node:assert/strict');
const { visitInvite, inviteFileName } = require('../visitInvite');

const visit = { id: 42, title: 'Quarterly firewall check', description: 'Review rules; check HA, logs', notes: 'Bring console cable', scheduled_date: '2026-10-12', status: 'scheduled', updated_at: '2026-10-06 09:30:00' };
const unfold = text => text.replace(/\r\n /g, '');

test('a visit becomes an all-day calendar event with its customer, place, people and a reminder', () => {
  const ics = visitInvite({ visit, customer: { name: 'Northwind, Ltd', address: '1 Harbour St; Limassol', contact_name: 'Anna', contact_phone: '+357 99 000000' }, engineers: ['Maria Security', 'Paul Delivery'], appUrl: 'https://teamhub.example.com/', now: new Date('2026-10-06T10:00:00Z') });
  assert.ok(ics.endsWith('\r\n') && !/[^\r]\n/.test(ics), 'CRLF line endings');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `folded: ${line}`);
  assert.ok(ics.includes('\r\nBEGIN:VEVENT\r\nUID:visit-42@solutionshub\r\n'), 'short lines are not folded');
  assert.ok(ics.split('\r\n').filter(line => line.startsWith(' ')).every(line => line.length > 2), 'only long lines are continued');
  const text = unfold(ics);
  assert.match(text, /METHOD:PUBLISH/);
  assert.match(text, /UID:visit-42@solutionshub/, 'same UID as the calendar feed, so it updates rather than duplicates');
  assert.match(text, /DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013/);
  assert.match(text, /SUMMARY:Maintenance visit: Quarterly firewall check \(Northwind\\, Ltd\)/);
  assert.match(text, /LOCATION:1 Harbour St\\; Limassol/);
  // iCalendar escapes ; , and new lines with a backslash.
  assert.ok(text.includes(String.raw`DESCRIPTION:Review rules\; check HA\, logs\n\nNotes: Bring console cable\n\nEngineers: Maria Security\, Paul Delivery\n\nCustomer contact: Anna\, +357 99 000000\n\nIn TeamHub: https://teamhub.example.com/maintenance-visits?visit=42`));
  assert.match(text, /STATUS:CONFIRMED/);
  assert.match(text, /BEGIN:VALARM[\s\S]*TRIGGER:-PT15H[\s\S]*END:VALARM/, 'a reminder at 09:00 the day before');
  assert.match(text, /SEQUENCE:\d+/);
});

test('a cancelled visit cancels the event, and later changes outrank earlier ones', () => {
  const cancelled = unfold(visitInvite({ visit: { ...visit, status: 'cancelled' } }));
  assert.match(cancelled, /METHOD:CANCEL/); assert.match(cancelled, /STATUS:CANCELLED/); assert.doesNotMatch(cancelled, /VALARM/);
  const seq = updated_at => Number(unfold(visitInvite({ visit: { ...visit, updated_at } })).match(/SEQUENCE:(\d+)/)[1]);
  assert.ok(seq('2026-10-07 08:00:00') > seq('2026-10-06 09:30:00'));
  assert.throws(() => visitInvite({ visit: { ...visit, scheduled_date: '' } }), /no date/);
  assert.equal(inviteFileName(visit), 'visit-2026-10-12-quarterly-firewall-check.ics');
  assert.equal(inviteFileName({ ...visit, title: 'Ελέγχος / "test"' }), 'visit-2026-10-12-test.ics');
});
