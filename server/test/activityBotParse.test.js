const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../activityBot/parse');

const today = '2026-10-07'; // a Wednesday
const customers = [
  { id: 1, name: 'Northwind Logistics', customer_code: 'NWL' },
  { id: 2, name: 'Contoso Bank' },
  { id: 3, name: 'Contoso Hotels' },
  { id: 4, name: 'Our infrastructure', is_internal: true },
];
const categories = [
  { id: 10, name: 'Upgrade', subcategories: [{ id: 101, name: 'Firmware' }] },
  { id: 11, name: 'Troubleshooting', subcategories: [] },
  { id: 12, name: 'Patch / Firmware Update', subcategories: [] },
  { id: 13, name: 'Review / Health Check', subcategories: [] },
  { id: 14, name: 'Support', subcategories: [] },
];
const technologies = [{ id: 20, name: 'Firewall' }, { id: 21, name: 'Microsoft 365' }];
const statuses = [{ value: 'planned' }, { value: 'in_progress' }, { value: 'completed', is_terminal: true }];
const ctx = { customers, categories, technologies, statuses, today };

test('reads time spent in the ways people write it', () => {
  for (const [text, minutes] of [['1h', 60], ['1.5h', 90], ['1,5 hours', 90], ['1h30', 90], ['1h 30m', 90], ['2 hours', 120], ['45 min', 45], ['90m', 90], ['half an hour', 30], ['an hour', 60], ['2 ώρες', 120], ['30 λεπτά', 30]]) {
    assert.equal(parse.parseDuration(text), minutes, text);
  }
  assert.equal(parse.parseDuration('upgraded to 7.6.0'), null);
});

test('reads the day, never in the future', () => {
  assert.equal(parse.parseDate('did it today', today), today);
  assert.equal(parse.parseDate('yesterday afternoon', today), '2026-10-06');
  assert.equal(parse.parseDate('on Monday', today), '2026-10-05');
  assert.equal(parse.parseDate('on Wednesday', today), today);
  assert.equal(parse.parseDate('on 3/10', today), '2026-10-03');
  assert.equal(parse.parseDate('on 25/12', today), '2025-12-25', 'a day later this year means last year');
  assert.equal(parse.parseDate('2026-10-01', today), '2026-10-01');
  assert.equal(parse.parseDate('2026-12-01', today), null);
  assert.equal(parse.parseDate('χθες', today), '2026-10-06');
});

test('reads tickets, versions and billing', () => {
  assert.equal(parse.parseTicket('ticket 4521'), '4521');
  assert.equal(parse.parseTicket('see INC2135 for details'), 'INC2135');
  assert.equal(parse.parseTicket('rt #8812'), '8812');
  assert.equal(parse.parseTicket('fixed it, #77'), '77');
  assert.equal(parse.parseTicket('ticket SR-2026-0042 raised'), 'SR-2026-0042');
  assert.equal(parse.parseTicket('ticket bot-x9k2'), 'BOT-X9K2');
  assert.equal(parse.parseTicket('the ticket queue was busy'), null, 'a word without digits is not a reference');
  assert.equal(parse.parseVersion('upgraded the firewall to 7.6.0'), '7.6.0');
  assert.equal(parse.parseVersion('now on v7.4.3'), '7.4.3');
  assert.equal(parse.parseBillable('this is billable'), 'billable');
  assert.equal(parse.parseBillable('non-billable, goodwill'), 'non_billable');
  assert.equal(parse.parseBillable('covered by the contract'), 'included_in_contract');
});

test('a full message becomes a draft; ambiguous customers become a question', () => {
  const draft = parse.parseMessage('1h on Northwind yesterday, upgraded the firewall firmware to 7.6.0, ticket 4521', ctx);
  assert.equal(draft.customer.id, 1);
  assert.equal(draft.category.id, 10);
  assert.equal(draft.subcategory.id, 101);
  assert.deepEqual([draft.duration_minutes, draft.activity_date, draft.ticket_reference, draft.version], [60, '2026-10-06', '4521', '7.6.0']);
  assert.deepEqual(draft.technologies.map(tech => tech.id), [20]);

  const ambiguous = parse.parseMessage('30m support for Contoso', ctx);
  assert.equal(ambiguous.customer, undefined);
  assert.deepEqual(ambiguous.customer_choices.map(choice => choice.id).sort(), [2, 3]);
  assert.equal(ambiguous.category.id, 14);
  assert.equal(parse.parseMessage('Contoso Bank: health check, 2h', ctx).customer.id, 2);
  assert.equal(parse.parseMessage('NWL review 1h', ctx).customer.id, 1);
  assert.equal(parse.parseMessage('patched our servers 40m', ctx).customer.id, 4);
  assert.equal(parse.parseMessage('patched our servers 40m', ctx).category.id, 12);
  assert.equal(parse.parseMessage('still working on the Northwind outage', ctx).status, 'in_progress');
});

test('assets are matched by name, host name or tag, or by type when only one fits', () => {
  const assets = [{ id: 1, name: 'NW-FW-01', asset_type: 'Firewall', hostname: 'fw01.northwind.local' }, { id: 2, name: 'NW-SW-01', asset_type: 'Switch' }, { id: 3, name: 'NW-SW-02', asset_type: 'Switch' }];
  assert.deepEqual(parse.matchAssets('upgraded NW-FW-01 to 7.6', assets).map(asset => asset.id), [1]);
  assert.deepEqual(parse.matchAssets('rebooted fw01.northwind.local', assets).map(asset => asset.id), [1]);
  assert.deepEqual(parse.matchAssets('checked the firewall', assets).map(asset => asset.id), [1]);
  assert.deepEqual(parse.matchAssets('checked the switch', assets), [], 'two switches: do not guess');
});
