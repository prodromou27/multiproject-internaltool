const test=require('node:test');
const assert=require('node:assert/strict');
const { normalizeDate,normalizeStatus,normalizePriority,ticketRecord }=require('../ticketSync');
const { timestamp }=require('../ticketSyncScheduler');

test('RT ticket values normalize into stable reporting fields',() => {
  assert.equal(normalizeDate('2018-06-29:10:25Z'),'2018-06-29T10:25:00.000Z');
  assert.deepEqual(normalizeStatus('stalled'),{ external:'stalled',normalized:'Pending',group:'open' });
  assert.deepEqual(normalizeStatus('custom-active'),{ external:'custom-active',normalized:'custom-active',group:'open' });
  assert.deepEqual(normalizePriority('95'),{ external:'95',normalized:'Critical' });
  assert.equal(timestamp('2026-09-21 12:00:00'),Date.parse('2026-09-21T12:00:00Z'));
});

test('ticket records retain external values and derive safe local metadata',() => {
  const record=ticketRecord({ id:'77',Subject:'Gateway alert',Status:'resolved',Priority:'High',Owner:{ id:'alice',Name:'Alice' },Created:'2026-09-01T10:00:00Z',LastUpdated:'2026-09-02T10:00:00Z',Resolved:'2026-09-02T09:00:00Z' },
    { customer_id:4,external_queue_id:'42',external_queue_name:'Acme Support' },'https://rt.example.test/rt',new Date('2026-09-03T00:00:00Z'));
  assert.equal(record.external_status,'resolved');assert.equal(record.normalized_status,'Resolved');assert.equal(record.status_group,'closed');
  assert.equal(record.normalized_priority,'High');assert.equal(record.owner_name,'Alice');assert.equal(record.closed_at_external,'2026-09-02T09:00:00.000Z');
  assert.equal(record.external_url,'https://rt.example.test/rt/Ticket/Display.html?id=77');
  assert.equal(record.sla_breached,false);
});
