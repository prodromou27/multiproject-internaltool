const test=require('node:test');
const assert=require('node:assert/strict');
const { DEFAULTS,validate }=require('../ticketMappings');
const { normalizeStatus,normalizePriority }=require('../ticketSync');

test('ticket mappings validate unique external values and approved normalized values',() => {
  assert.deepEqual(validate(DEFAULTS),DEFAULTS);
  assert.throws(() => validate({ statuses:[{ external:'open',normalized:'Open',group:'open' },{ external:'OPEN',normalized:'Pending',group:'open' }],priorities:[] }),/Duplicate status/);
  assert.throws(() => validate({ statuses:[{ external:'open',normalized:'Invalid',group:'open' }],priorities:[] }),/valid external value/);
  assert.throws(() => validate({ statuses:[],priorities:[{ external:'P1',normalized:'Urgent' }] }),/valid external value/);
});

test('custom ticket mappings override defaults while unknown values stay visible',() => {
  const config={ statuses:[{ external:'waiting-customer',normalized:'Pending',group:'open' }],priorities:[{ external:'P1',normalized:'Critical' }] };
  assert.deepEqual(normalizeStatus('WAITING-CUSTOMER',config),{ external:'WAITING-CUSTOMER',normalized:'Pending',group:'open' });
  assert.deepEqual(normalizeStatus('custom',config),{ external:'custom',normalized:'custom',group:'open' });
  assert.deepEqual(normalizePriority('p1',config),{ external:'p1',normalized:'Critical' });
  assert.deepEqual(normalizeStatus('in_progress'),{ external:'in_progress',normalized:'In Progress',group:'open' });
});
