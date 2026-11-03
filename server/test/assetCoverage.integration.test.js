// Asset coverage follows the contracts: covered → managed / under support; uncovered again → neither.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { syncCoverage } = require('../assetCoverage');

const day = n => appTime.addDays(appTime.today(), n);
const contracts = id => `/api/customers/${id}/contracts`;
let customer, fw1, fw2, sw, handSet;
const asset = async (name, coverage = 'neither') => (await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, coverage_type, created_by) VALUES (?, ?, 'firewall', ?, ?)")
  .run(customer, name, coverage, ids.manager)).lastInsertRowid;
const coverage = async id => (await db.prepare('SELECT coverage_type, coverage_source FROM customer_assets WHERE id = ?').get(id));
const addContract = async (reference, start, end, assetIds) => {
  const made = await api(contracts(customer), { method: 'POST', token: ids.tokenManager, body: { reference, start_date: start, end_date: end, asset_ids: assetIds } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data.id;
};

test('an asset added to a contract in force becomes Under support (not a managed customer), with a new version and history', async () => {
  customer = Number((await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Coverage Co' } })).data.id);
  fw1 = await asset('FW-1'); fw2 = await asset('FW-2'); sw = await asset('SW-1'); handSet = await asset('AP-1', 'support');
  const before = (await db.prepare('SELECT version FROM customer_assets WHERE id = ?').get(fw1)).version;
  await addContract('SUP-1', day(-10), day(100), [fw1]);
  assert.deepEqual(await coverage(fw1), { coverage_type: 'support', coverage_source: 'contract' });
  assert.equal((await coverage(fw2)).coverage_type, 'neither', 'not in the contract');
  assert.equal((await db.prepare('SELECT version FROM customer_assets WHERE id = ?').get(fw1)).version, before + 1);
  const history = await db.prepare("SELECT coverage_type, user_id FROM customer_asset_history WHERE asset_id = ? ORDER BY id DESC").get(fw1);
  assert.deepEqual([history.coverage_type, Number(history.user_id)], ['support', ids.manager]);
});

test('a managed customer\'s assets under contract become Managed, and back to Under support when it is no longer managed', async () => {
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (?, 1)').run(customer);
  await syncCoverage({ customerIds: [customer] });
  assert.equal((await coverage(fw1)).coverage_type, 'managed');
  await db.prepare('UPDATE managed_customer_configurations SET managed_services_enabled = 0 WHERE customer_id = ?').run(customer);
  await syncCoverage({ customerIds: [customer] });
  assert.equal((await coverage(fw1)).coverage_type, 'support');
});

test('a contract that starts later covers its assets from its first day; a renewal leaves no gap', async () => {
  const later = await addContract('SUP-2', day(5), day(30), [fw2]);
  assert.equal((await coverage(fw2)).coverage_type, 'neither', 'not yet');
  await syncCoverage({ customerIds: [customer], today: day(5) });
  assert.equal((await coverage(fw2)).coverage_type, 'support', 'on its first day');
  // Renewed for the next period, starting the day after it ends.
  assert.equal((await api(`${contracts(customer)}/${later}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(31), end_date: day(395) } })).status, 201);
  await syncCoverage({ customerIds: [customer], today: day(31) });
  assert.equal((await coverage(fw2)).coverage_type, 'support', 'covered by the renewal');
  await syncCoverage({ customerIds: [customer], today: day(396) });
  assert.deepEqual(await coverage(fw2), { coverage_type: 'neither', coverage_source: null }, 'after the last period ends');
});

test('when no contract covers it, an asset the contracts set goes back to Neither; one set by hand is left alone', async () => {
  const ending = await addContract('SUP-3', day(-30), day(-1), [sw]);
  assert.equal((await coverage(sw)).coverage_type, 'neither', 'an expired contract covers nothing');
  await syncCoverage({ customerIds: [customer], today: day(-1) });
  assert.equal((await coverage(sw)).coverage_type, 'support', 'on its last day');
  await syncCoverage({ customerIds: [customer] });
  assert.equal((await coverage(sw)).coverage_type, 'neither', 'the day after');

  // Deleting the contract that covers FW-1 uncovers it at once.
  const supOne = (await api(contracts(customer), { token: ids.tokenManager })).data.contracts.find(c => c.reference === 'SUP-1').id;
  assert.equal((await api(`${contracts(customer)}/${supOne}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await coverage(fw1)).coverage_type, 'neither');
  assert.equal((await api(`${contracts(customer)}/${ending}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);

  // AP-1 was set to Under support by a person and is in no contract: untouched.
  await syncCoverage({ customerIds: [customer] });
  assert.deepEqual(await coverage(handSet), { coverage_type: 'support', coverage_source: null });
  // Retired assets are never changed.
  await db.prepare("UPDATE customer_assets SET lifecycle_status = 'retired' WHERE id = ?").run(fw1);
  await addContract('SUP-4', day(-1), day(50), [fw1]);
  assert.equal((await coverage(fw1)).coverage_type, 'neither');
});

test('a person changing the coverage of a contract-set asset takes it over: it is not reset when the contract goes', async () => {
  const ups = await asset('UPS-1');
  const covering = await addContract('SUP-5', day(-1), day(60), [ups]);
  assert.deepEqual(await coverage(ups), { coverage_type: 'support', coverage_source: 'contract' });
  const listed = (await api(`/api/customers/${customer}/assets`, { token: ids.tokenManager })).data;
  const current = (Array.isArray(listed) ? listed : listed.rows).find(a => Number(a.id) === Number(ups));
  const saved = await api(`/api/customers/${customer}/assets/${ups}`, { method: 'PUT', token: ids.tokenManager, body: { ...current, coverage_type: 'managed', version: current.version } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(await coverage(ups), { coverage_type: 'managed', coverage_source: null });
  assert.equal((await api(`${contracts(customer)}/${covering}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await coverage(ups)).coverage_type, 'managed', 'left as the person set it');
});

test('several identical devices are added at once as separate assets, with their serial numbers', async () => {
  const add = body => api(`/api/customers/${customer}/assets`, { method: 'POST', token: ids.tokenManager, body });
  for (const bad of [{ quantity: 0 }, { quantity: 51 }, { quantity: 2.5 }, { quantity: 3, serials: ['A', 'B', 'C', 'D'] }, { quantity: 3, hostname: 'ap.local' }, { quantity: 2, asset_tag: 'T-1' }])
    assert.equal((await add({ name: 'Access point', asset_type: 'Access point', ...bad })).status, 400, JSON.stringify(bad));
  const made = await add({ name: 'Access point', asset_type: 'Access point', vendor: 'Ubiquiti', quantity: 5, serials: ['SN-1', 'SN-2', ' SN-3 '] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.count, 5);
  assert.deepEqual(made.data.assets.map(a => [a.name, a.serial_number, a.vendor]),
    [['Access point 1', 'SN-1', 'Ubiquiti'], ['Access point 2', 'SN-2', 'Ubiquiti'], ['Access point 3', 'SN-3', 'Ubiquiti'], ['Access point 4', null, 'Ubiquiti'], ['Access point 5', null, 'Ubiquiti']]);
  const history = await db.prepare("SELECT COUNT(*) AS n FROM customer_asset_history WHERE action = 'created' AND asset_id IN (" + made.data.assets.map(() => '?').join(',') + ')').get(...made.data.assets.map(a => a.id));
  assert.equal(Number(history.n), 5, 'each has its own history');
  // One at a time works as before and returns the asset itself.
  const single = await add({ name: 'Microsoft 365', asset_type: 'Cloud service', vendor: 'Microsoft', model: 'Business Premium' });
  assert.equal(single.status, 201);
  assert.equal(single.data.name, 'Microsoft 365');
});
