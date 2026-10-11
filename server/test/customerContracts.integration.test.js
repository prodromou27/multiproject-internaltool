const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const base = id => `/api/customers/${id}/contracts`;
const today = () => appTime.today();
const day = n => appTime.addDays(today(), n);
const asset = async (name, customer = ids.customer) =>
  (await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, created_by) VALUES (?, ?, 'firewall', ?)").run(customer, name, ids.manager)).lastInsertRowid;

test('managers add contracts with a reference, dates and the assets they cover', async () => {
  const fw1 = await asset('FW-1'), fw2 = await asset('FW-2'), spare = await asset('FW-3');
  await db.prepare("UPDATE customer_assets SET lifecycle_status = 'spare' WHERE id = ?").run(spare);
  const created = await api(base(ids.customer), { method: 'POST', token: ids.tokenManager, body: {
    reference: 'MSP-2026-014', description: 'Managed firewall service', service_level: '24x7', start_date: day(-100), end_date: day(265), asset_ids: [fw1], notes: 'Renews yearly' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const page = (await api(base(ids.customer), { token: ids.tokenManager })).data;
  const contract = page.contracts.find(c => c.id === created.data.id);
  assert.deepEqual([contract.reference, contract.service_level, contract.status, contract.asset_count, contract.days_left], ['MSP-2026-014', '24x7', 'active', 1, 265]);
  assert.deepEqual(contract.assets.map(a => a.name), ['FW-1']);
  assert.deepEqual(page.uncovered_assets.map(a => a.name), ['FW-2'], 'active assets outside any contract stand out; spares do not');
  assert.equal(page.can_manage, true);

  // Stored encrypted; edits replace the assets.
  const raw = await db.prepare('SELECT reference, notes FROM customer_contracts WHERE id = ?').get(created.data.id);
  if (require('../fieldCipher').isConfigured()) assert.match(raw.reference, /^enc:/);
  else assert.equal(raw.reference, 'MSP-2026-014');
  assert.equal((await api(`${base(ids.customer)}/${created.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { asset_ids: [fw1, fw2] } })).status, 200);
  const after = (await api(base(ids.customer), { token: ids.tokenManager })).data;
  assert.equal(after.contracts.find(c => c.id === created.data.id).asset_count, 2);
  assert.deepEqual(after.uncovered_assets, []);

  // The customer list shows the current contract (its visit counts need PostgreSQL).
  if (process.env.TEST_DATABASE_URL) {
    const listed = (await api('/api/customers', { token: ids.tokenManager })).data.find(c => c.id === ids.customer);
    assert.deepEqual([listed.current_contract.reference, listed.current_contract.status], ['MSP-2026-014', 'active']);
  }

  const audit = await db.prepare("SELECT action FROM audit_log WHERE entity_type = 'customer_contract' ORDER BY id").all();
  assert.deepEqual(audit.map(a => a.action), ['created', 'updated']);
});

test('status follows the dates: upcoming, ending soon within 30 days, expired', async () => {
  const add = async (reference, start, end) => (await api(base(ids.customerUnassigned), { method: 'POST', token: ids.tokenManager, body: { reference, start_date: start, end_date: end } })).data.id;
  const soon = await add('SOON', day(-300), day(30)), later = await add('LATER', day(-300), day(31));
  const gone = await add('GONE', day(-400), day(-1)), next = await add('NEXT', day(5), day(370));
  const byId = new Map((await api(base(ids.customerUnassigned), { token: ids.tokenManager })).data.contracts.map(c => [c.id, c.status]));
  assert.deepEqual([byId.get(soon), byId.get(later), byId.get(gone), byId.get(next)], ['ending_soon', 'active', 'expired', 'upcoming']);
});

test('renewing adds the next period with the same reference and assets, and keeps the old one as renewed', async () => {
  const fw = await asset('FW-RENEW');
  const old = (await api(base(ids.customer), { method: 'POST', token: ids.tokenManager, body: { reference: 'SUP-77', service_level: '8x5', start_date: day(-340), end_date: day(20), asset_ids: [fw] } })).data.id;
  assert.equal((await api(`${base(ids.customer)}/${old}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(-400), end_date: day(400) } })).status, 400, 'cannot start before the contract it renews');
  const renewal = await api(`${base(ids.customer)}/${old}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(21), end_date: day(385) } });
  assert.equal(renewal.status, 201, JSON.stringify(renewal.data));
  const contracts = (await api(base(ids.customer), { token: ids.tokenManager })).data.contracts;
  const before = contracts.find(c => c.id === old), next = contracts.find(c => c.id === renewal.data.id);
  assert.equal(before.status, 'renewed');
  assert.deepEqual([next.reference, next.service_level, next.status, next.renewed_from_id, next.assets.map(a => a.name)], ['SUP-77', '8x5', 'upcoming', old, ['FW-RENEW']]);
  assert.equal((await api(`${base(ids.customer)}/${old}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(21), end_date: day(385) } })).status, 409);

  // Deleting the renewal makes the old contract current again.
  assert.equal((await api(`${base(ids.customer)}/${renewal.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await api(base(ids.customer), { token: ids.tokenManager })).data.contracts.find(c => c.id === old).status, 'ending_soon');
});

test('bad contracts are refused, only managers change them, and only people with access see them', async () => {
  const post = (body, token = ids.tokenManager, customer = ids.customer) => api(base(customer), { method: 'POST', token, body });
  assert.equal((await post({ start_date: day(0), end_date: day(10) })).status, 400, 'reference is required');
  assert.equal((await post({ reference: 'X', start_date: day(10), end_date: day(0) })).status, 400, 'end before start');
  assert.equal((await post({ reference: 'X', start_date: '2026-02-30', end_date: day(10) })).status, 400);
  const elsewhere = await asset('OTHER-FW', ids.customerUnassigned);
  assert.equal((await post({ reference: 'X', start_date: day(0), end_date: day(10), asset_ids: [elsewhere] })).status, 400, 'assets must belong to the customer');
  assert.equal((await post({ reference: 'X', start_date: day(0), end_date: day(10) }, ids.tokenPlanner)).status, 403);
  assert.equal((await api(base(ids.customerUnassigned), { token: ids.tokenEnabled })).status, 403, 'engineers only see customers they work with');
  assert.equal((await api(`${base(ids.customer)}/999999`, { method: 'DELETE', token: ids.tokenManager })).status, 404);
  const planner = (await api(base(ids.customer), { token: ids.tokenPlanner })).data;
  assert.equal(planner.can_manage, false);
});

test('managed customers are flagged so their contract type can be set', async () => {
  assert.equal((await api(base(ids.customerUnassigned), { token: ids.tokenManager })).data.is_managed, false);
  await db.exec(`INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (${Number(ids.customerUnassigned)}, 1)
    ON CONFLICT (customer_id) DO UPDATE SET managed_services_enabled = 1`);
  const page = (await api(base(ids.customerUnassigned), { token: ids.tokenManager })).data;
  assert.equal(page.is_managed, true);
  assert.deepEqual(page.service_levels, ['24x7', '12x5', '8x5']);
});
