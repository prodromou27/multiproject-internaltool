const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');
const { attemptTicketWriteback } = require('../ticketWriteback');

let h, customer;

test.before(async () => {
  h = await harness.start({});
  customer = (await h.db.prepare("INSERT INTO customers (name, active, service_activity_enabled) VALUES ('Writeback Co', 1, 1)").run()).lastInsertRowid;
});
test.after(() => h.stop());

async function config(overrides) {
  await h.db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(customer);
  await h.db.prepare(`
    INSERT INTO customer_ticketing_configurations (customer_id, provider_type, external_queue_id, external_queue_name, enabled, write_back_enabled, write_back_status)
    VALUES (?, 'request_tracker', '7', 'Support', ?, ?, ?)
  `).run(customer, overrides.enabled ? 1 : 0, overrides.write_back_enabled ? 1 : 0, overrides.write_back_status ?? null);
}

async function ticket(externalId) {
  await h.db.prepare('DELETE FROM external_tickets WHERE customer_id = ?').run(customer);
  await h.db.prepare(`
    INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group)
    VALUES (?, 'request_tracker', '7', 'Support', ?, ?, 'Test ticket', 'open', 'Open', 'open')
  `).run(customer, externalId, externalId);
}

test('no ticket_reference: not attempted', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  assert.deepEqual(await attemptTicketWriteback({ customerId: customer, ticketReference: '' }), { attempted: false, reason: 'no_ticket_reference' });
  assert.deepEqual(await attemptTicketWriteback({ customerId: customer, ticketReference: null }), { attempted: false, reason: 'no_ticket_reference' });
});

test('write-back not configured: not attempted', async () => {
  await config({ enabled: true, write_back_enabled: false });
  const result = await attemptTicketWriteback({ customerId: customer, ticketReference: '123' });
  assert.deepEqual(result, { attempted: false, reason: 'not_configured' });

  await h.db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(customer);
  assert.deepEqual(await attemptTicketWriteback({ customerId: customer, ticketReference: '123' }), { attempted: false, reason: 'not_configured' });
});

test('ticket_reference accepts "123", "#123" and "RT#123" — all match the same synced ticket', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  await ticket('123');
  const fakeProvider = { updateTicketStatus: async (id, status) => ({ ok: true, message: `set ${id} to ${status}` }) };
  const makeProvider = () => fakeProvider;

  for (const reference of ['123', '#123', 'RT#123', 'RT-123', '  123  ']) {
    const result = await attemptTicketWriteback({ customerId: customer, ticketReference: reference }, { makeProvider });
    assert.equal(result.attempted, true);
    assert.equal(result.ok, true);
    assert.equal(result.ticket_id, '123');
  }
});

test('no matching synced ticket: not attempted', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  await ticket('999');
  const result = await attemptTicketWriteback({ customerId: customer, ticketReference: '123' });
  assert.deepEqual(result, { attempted: false, reason: 'ticket_not_found' });
});

test('a non-numeric reference cannot match anything', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  await ticket('123');
  const result = await attemptTicketWriteback({ customerId: customer, ticketReference: 'no-number-here' });
  assert.deepEqual(result, { attempted: false, reason: 'reference_not_numeric' });
});

test('an RT failure is reported, not thrown', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  await ticket('123');
  const makeProvider = () => ({ updateTicketStatus: async () => { throw Object.assign(new Error('Request Tracker returned HTTP 500'), { status: 502 }); } });
  const result = await attemptTicketWriteback({ customerId: customer, ticketReference: '123' }, { makeProvider });
  assert.deepEqual(result, { attempted: true, ok: false, ticket_id: '123', error: 'Request Tracker returned HTTP 500' });
});

test('with real settings unconfigured (no base_url/token), the default provider factory fails safely rather than throwing', async () => {
  await config({ enabled: true, write_back_enabled: true, write_back_status: 'resolved' });
  await ticket('123');
  const result = await attemptTicketWriteback({ customerId: customer, ticketReference: '123' }); // no makeProvider override
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /not fully configured/);
});
