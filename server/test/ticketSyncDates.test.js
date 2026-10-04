const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
const { ticketRecord } = require('../ticketSync');

const mapping = { customer_id: 1, external_queue_id: '7', external_queue_name: 'Support' };
const UNSET = '1970-01-01T00:00:00Z';

test('RT unset dates (the Unix epoch) are stored as empty, not as 1970', () => {
  const record = ticketRecord({ id: '101', Subject: 'S', Status: 'open', Priority: 70, Created: '2026-10-02T08:00:00Z', LastUpdated: '2026-10-03T09:00:00Z', Resolved: UNSET, Due: UNSET },
    mapping, 'https://rt.example.com', new Date('2026-10-04T12:00:00Z'));
  assert.equal(record.sla_due_at, null);
  assert.equal(record.resolved_at_external, null);
  assert.equal(record.sla_breached, false, 'an open ticket with no due date is not an SLA breach');
  assert.equal(record.created_at_external, '2026-10-02T08:00:00.000Z');
});

test('a real past due date on an open ticket is still a breach', () => {
  const record = ticketRecord({ id: '103', Subject: 'S', Status: 'new', Priority: 90, Created: '2026-09-28T07:00:00Z', Resolved: UNSET, Due: '2026-10-01T17:00:00Z' },
    mapping, 'https://rt.example.com', new Date('2026-10-04T12:00:00Z'));
  assert.equal(record.sla_due_at, '2026-10-01T17:00:00.000Z');
  assert.equal(record.sla_breached, true);
});
