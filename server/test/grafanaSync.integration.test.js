// Grafana device sync: Check Point devices from Prometheus, matched to customer assets.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const grafana = require('../grafana');
const { decrypt, encrypt } = require('../fieldCipher');

// As in the real dashboard: value mappings build → "Take N" (one build mapped differently in two panels).
const dashboard = { spec: { elements: {
  'panel-16': { spec: { vizConfig: { spec: { fieldConfig: { defaults: { mappings: [{ type: 'value', options: { 996000077: { text: 'Take 170' }, 997000046: { text: 'Take 99' }, 998000035: { text: 'Take 127' }, R81_20_jumbo_hf_main: { text: 'R81.20' } } }] } } } } } },
  'panel-18': { spec: { vizConfig: { spec: { fieldConfig: { defaults: { mappings: [{ type: 'value', options: { 997000046: { text: 'Take 99' }, 998000035: { text: 'Take 126' }, 999000017: { text: 'Take 44' } } }] } } } } } },
} } };

// Grafana's /api/ds/query answer: versions as one labelled field per series, models as a table.
const series = (host, name, build) => ({ schema: { fields: [{ name: 'Time' }, { name: 'Value', labels: { __name__: 'system_gaia_module_version', host_name: host, name, module: 'Firewall-1' } }] }, data: { values: [[1], [build]] } });
const answer = { results: {
  A: { frames: [series('EXTFW01', 'R81_20_jumbo_hf_main', 996000077), series('oc-fw-a', 'R82_jumbo_hf_main', 998000035), series('MetroMGMT', 'jess_main', 999000017), series('UNKNOWN-FW', 'R81_10_jumbo_hf_main', 996000055)] },
  B: { frames: [{ schema: { fields: [{ name: 'Time' }, { name: 'host_name' }, { name: 'model' }, { name: 'Value' }] }, data: { values: [[1, 1, 1], ['EXTFW01', 'oc-fw-a', 'MetroMGMT'], ['Check Point 6600', 'Check Point 7000', 'Smart-1 600-S'], [1, 1, 1]] } }] },
} };
let request = null;
const fetchImpl = async (url, options) => { request = { url, ...options }; return { ok: true, status: 200, json: async () => answer }; };
const validateUrl = async raw => Object.assign(new URL(raw), { validatedAddresses: ['10.0.0.5'] });

let ext, oc, metro;
const asset = (name, hostname, version, model) => db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, vendor, hostname, software_version, model, created_by) VALUES (?, ?, 'firewall', 'Check Point', ?, ?, ?, ?) RETURNING id")
  .get(ids.customer, name, hostname === null ? null : encrypt(hostname), version === null ? null : encrypt(version), encrypt(model), ids.manager).then(row => row.id);

test('managers connect Grafana; the token is kept encrypted and never shown', async () => {
  assert.equal((await api('/api/grafana/settings', { token: ids.tokenEnabled })).status, 403);
  const saved = await api('/api/grafana/settings', { method: 'PUT', token: ids.tokenManager, body: { base_url: 'http://grafana.internal:3000/', token: 'glsa_secret', datasource_uid: 'fe8guxq67er5sf', version_map: { jess_main: 'R82.10' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.base_url, 'http://grafana.internal:3000');
  assert.equal(saved.data.token_set, true);
  assert.equal(JSON.stringify(saved.data).includes('glsa_secret'), false);
  assert.equal((await api('/api/grafana/settings', { method: 'PUT', token: ids.tokenManager, body: { datasource_uid: 'bad uid!' } })).status, 400);
});

test('take mappings are imported from the dashboard; a build mapped two ways is left to a person', async () => {
  const res = await api('/api/grafana/take-map/import', { method: 'POST', token: ids.tokenManager, body: { dashboard: JSON.stringify(dashboard) } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.take_map, { 996000077: 170, 997000046: 99, 999000017: 44 });
  assert.deepEqual(res.data.conflicts, { 998000035: [127, 126] });
});

test('a sync reads Grafana and lists each device against its asset, for review', async () => {
  ext = await asset('Ext firewall 1', 'EXTFW01', 'R81.20 Take 99', 'Check Point 6600');
  oc = await asset('OC-FW-A', null, 'R82 Take 118', 'Check Point 7000'); // matched by asset name
  metro = await asset('Metro management', 'metromgmt', 'R82.10 Take 44', 'Smart-1 600-S'); // already right
  const result = await grafana.sync({ fetchImpl, validateUrl });
  assert.deepEqual(result, { ok: true, devices: 4, differs: 1, unmatched: 1, unknown_takes: 2, applied: 0 }, 'nothing applied at first: review first');
  assert.equal(request.url, 'http://grafana.internal:3000/api/ds/query');
  assert.equal(request.headers.Authorization, 'Bearer glsa_secret');
  assert.deepEqual(request.addresses, ['10.0.0.5'], 'pinned to the checked address');
  assert.deepEqual(JSON.parse(request.body).queries.map(q => [q.refId, q.datasource.uid, q.instant]), [['A', 'fe8guxq67er5sf', true], ['B', 'fe8guxq67er5sf', true]]);

  const rows = Object.fromEntries((await api('/api/grafana/devices', { token: ids.tokenManager })).data.rows.map(r => [r.host_name, r]));
  assert.equal(rows.EXTFW01.status, 'differs');
  assert.deepEqual(rows.EXTFW01.changes, [{ field: 'software_version', from: 'R81.20 Take 99', to: 'R81.20 Take 170' }]);
  assert.equal(rows['oc-fw-a'].status, 'matches', 'the build has no settled take, so only the version line is compared');
  assert.equal(rows['oc-fw-a'].proposed_version, 'R82');
  assert.equal(rows.MetroMGMT.status, 'matches', 'jess_main named R82.10 by the managers');
  assert.equal(rows['UNKNOWN-FW'].status, 'unmatched');
  assert.equal((await db.prepare('SELECT software_version FROM customer_assets WHERE id = ?').get(ext)).software_version !== null, true);
  assert.equal(decrypt((await db.prepare('SELECT software_version FROM customer_assets WHERE id = ?').get(ext)).software_version), 'R81.20 Take 99', 'unchanged until applied');
});

test('applying updates the asset and records a review; unmatched devices are linked or ignored', async () => {
  assert.equal((await api('/api/grafana/apply', { method: 'POST', token: ids.tokenEnabled, body: { host_names: ['EXTFW01'] } })).status, 403);
  const applied = await api('/api/grafana/apply', { method: 'POST', token: ids.tokenManager, body: { host_names: ['EXTFW01', 'MetroMGMT'] } });
  assert.deepEqual(applied.data, { applied: 2 }, 'a matching device is confirmed as reviewed');
  const row = await db.prepare('SELECT software_version, reviewed_at, reviewed_by FROM customer_assets WHERE id = ?').get(ext);
  assert.deepEqual([decrypt(row.software_version), !!row.reviewed_at, row.reviewed_by], ['R81.20 Take 170', true, ids.manager]);
  const log = await db.prepare("SELECT from_version, to_version, note FROM customer_asset_versions WHERE asset_id = ? AND kind = 'reviewed' ORDER BY id DESC LIMIT 1").get(ext);
  assert.deepEqual([decrypt(log.from_version), decrypt(log.to_version), decrypt(log.note)], ['R81.20 Take 99', 'R81.20 Take 170', 'From Grafana (EXTFW01)']);
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'updated_from_grafana' AND entity_id = ?").get(ext));

  const link = body => api('/api/grafana/link', { method: 'POST', token: ids.tokenManager, body });
  const spare = await asset('Old R81.10 box', 'old-box', 'R81.10 Take 87', 'Check Point 5600');
  assert.equal((await link({ host_name: 'UNKNOWN-FW', asset_id: spare })).status, 200);
  let rows = Object.fromEntries((await api('/api/grafana/devices', { token: ids.tokenManager })).data.rows.map(r => [r.host_name, r]));
  assert.deepEqual([rows['UNKNOWN-FW'].status, rows['UNKNOWN-FW'].asset.id, rows['UNKNOWN-FW'].linked], ['matches', spare, true], 'same version line; its take is not known yet');
  assert.equal(rows['UNKNOWN-FW'].proposed_version, 'R81.10', 'build 996000055 has no take yet');
  assert.equal((await link({ host_name: 'UNKNOWN-FW', ignore: true })).status, 200);
  rows = Object.fromEntries((await api('/api/grafana/devices', { token: ids.tokenManager })).data.rows.map(r => [r.host_name, r]));
  assert.equal(rows['UNKNOWN-FW'].status, 'ignored');

  // A mapping added later applies at once.
  const settings = (await api('/api/grafana/settings', { token: ids.tokenManager })).data;
  await api('/api/grafana/settings', { method: 'PUT', token: ids.tokenManager, body: { take_map: { ...settings.take_map, 998000035: 127 } } });
  rows = Object.fromEntries((await api('/api/grafana/devices', { token: ids.tokenManager })).data.rows.map(r => [r.host_name, r]));
  assert.deepEqual(rows['oc-fw-a'].changes, [{ field: 'software_version', from: 'R82 Take 118', to: 'R82 Take 127' }]);
});

test('turned on, a sync applies the differences itself; a Grafana failure is reported', async () => {
  const s = await grafana.settings();
  await grafana.saveSettings({ ...s, auto_apply: true });
  const result = await grafana.sync({ fetchImpl, validateUrl });
  assert.equal(result.applied, 1);
  assert.equal(decrypt((await db.prepare('SELECT software_version FROM customer_assets WHERE id = ?').get(oc)).software_version), 'R82 Take 127');
  const refused = await grafana.sync({ fetchImpl: async () => ({ ok: false, status: 401 }), validateUrl });
  assert.deepEqual(refused, { ok: false, error: 'Grafana refused the token (it needs Viewer rights on the data source)' });
  assert.equal((await grafana.settings()).last_result.ok, false);
  assert.ok(metro);
});
