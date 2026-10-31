const { test, assert, api, db, ids } = require('./lib/activityFixture');
const sync = require('../cve/sync');

const cve = (id, product, match, severity = 'CRITICAL', score = 9.8, published = '2026-09-01T10:00:00.000') => ({ cve: {
  id, published, lastModified: published, vulnStatus: 'Analyzed', descriptions: [{ lang: 'en', value: `${id} lets an attacker do things in ${product}.` }],
  metrics: { cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: score, baseSeverity: severity, vectorString: 'CVSS:3.1/AV:N', version: '3.1' } }] },
  configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: `cpe:2.3:o:fortinet:${product}:*:*:*:*:*:*:*:*`, ...match }] }] }],
  references: [{ url: `https://fortiguard.example/${id}`, tags: ['Vendor Advisory'] }],
} });
const NVD = {
  'cpe:2.3:*:fortinet:*': [cve('CVE-2026-1001', 'fortios', { versionStartIncluding: '7.2.0', versionEndExcluding: '7.2.8' }), cve('CVE-2026-1002', 'fortiproxy', { versionEndExcluding: '7.0.5' }, 'HIGH', 7.5)],
  'cpe:2.3:*:fortinet:fortios': [cve('CVE-2026-1001', 'fortios', { versionStartIncluding: '7.2.0', versionEndExcluding: '7.2.8' }), cve('CVE-2026-1003', 'fortios', { versionStartIncluding: '7.4.0', versionEndExcluding: '7.4.2' }, 'MEDIUM', 5.3)],
};
const calls = [];
const fakeFetch = async url => {
  const target = new URL(url);
  calls.push(target.hostname + target.pathname + target.search);
  const json = data => ({ ok: true, status: 200, json: async () => data });
  if (target.hostname === 'www.cisa.gov') return json({ vulnerabilities: [{ cveID: 'CVE-2026-1001', vulnerabilityName: 'FortiOS bug', dateAdded: '2026-09-02', dueDate: '2026-09-23', requiredAction: 'Apply updates', knownRansomwareCampaignUse: 'Known' }] });
  const match = target.searchParams.get('virtualMatchString');
  if (match === 'cpe:2.3:*:microsoft:*') return json({ totalResults: 15000, resultsPerPage: 2000, startIndex: 0, vulnerabilities: [] });
  const items = NVD[match] || [];
  return json({ totalResults: items.length, resultsPerPage: 2000, startIndex: 0, vulnerabilities: items });
};
const run = () => sync.syncAll({ fetchImpl: fakeFetch, sleep: async () => {} });

test('CVEs for our vendors are fetched, matched to asset versions and flagged when exploited', async () => {
  for (const [name, version] of [['FW-HQ', '7.2.5'], ['FW-BRANCH', '7.4.3']]) {
    const made = await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { name, asset_type: 'Firewall', vendor: 'Fortinet', model: 'FortiGate 60F', software_version: version, environment: 'production', criticality: 'high', lifecycle_status: 'active', coverage_type: 'managed' } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
  }
  let result = await run();
  assert.equal(result.errors, 0, JSON.stringify(result));
  const watch = (await api('/api/vulnerabilities/admin/status', { token: ids.tokenManager })).data.watch;
  assert.ok(watch.some(row => row.cpe_vendor === 'fortinet' && row.source === 'asset'), 'the asset vendor is watched automatically');

  let list = (await api('/api/vulnerabilities', { token: ids.tokenManager })).data;
  assert.deepEqual(list.rows.map(row => row.id).sort(), ['CVE-2026-1001', 'CVE-2026-1002']);
  assert.equal(list.counts.kev, 1);
  assert.equal(list.counts.affected, 0, 'no product chosen for the FortiGates yet, so versions are not checked');

  // Say which product FortiGates run; its CVEs are then fetched and versions checked.
  assert.equal((await api('/api/vulnerabilities/admin/asset-products', { method: 'PUT', token: ids.tokenManager, body: { asset_vendor: 'Fortinet', asset_model: 'FortiGate 60F', cpe_vendor: 'fortinet', cpe_product: 'fortios' } })).status, 200);
  result = await run();
  assert.equal(result.errors, 0);
  list = (await api('/api/vulnerabilities', { token: ids.tokenManager })).data;
  const critical = list.rows.find(row => row.id === 'CVE-2026-1001');
  assert.equal(critical.affected_assets, 1, '7.2.5 is in 7.2.0 to before 7.2.8');
  assert.equal(critical.kev.due_date, '2026-09-23');
  assert.equal(list.rows.find(row => row.id === 'CVE-2026-1003').affected_assets, 0, '7.4.3 is past the fix in 7.4.2');
  assert.equal(list.counts.affected, 1);
  assert.deepEqual((await api('/api/vulnerabilities?affected=1', { token: ids.tokenManager })).data.rows.map(row => row.id), ['CVE-2026-1001']);
  assert.deepEqual((await api('/api/vulnerabilities?kev=1', { token: ids.tokenManager })).data.rows.map(row => row.id), ['CVE-2026-1001']);
  assert.deepEqual((await api('/api/vulnerabilities?severity=high', { token: ids.tokenManager })).data.rows.map(row => row.id), ['CVE-2026-1002']);
  assert.deepEqual((await api('/api/vulnerabilities?product=fortinet:fortiproxy', { token: ids.tokenManager })).data.rows.map(row => row.id), ['CVE-2026-1002']);

  const detail = (await api('/api/vulnerabilities/CVE-2026-1001', { token: ids.tokenManager })).data;
  assert.equal(detail.affected.length, 1);
  assert.deepEqual([detail.affected[0].asset_name, detail.affected[0].version], ['FW-HQ', '7.2.5']);
  assert.equal(detail.kev.required_action, 'Apply updates');
  assert.match(detail.nvd_url, /nvd\.nist\.gov\/vuln\/detail\/CVE-2026-1001/);

  const products = (await api('/api/vulnerabilities/products', { token: ids.tokenManager })).data.groups;
  const fortigate = products.find(group => group.model === 'FortiGate 60F');
  assert.deepEqual(fortigate.product, { vendor: 'fortinet', product: 'fortios' });
  assert.deepEqual(fortigate.versions.map(entry => [entry.version, entry.cves.total, entry.cves.kev]), [['7.4.3', 0, 0], ['7.2.5', 1, 1]]);
  assert.ok(fortigate.known_products.includes('fortiproxy'), 'products seen for the vendor are offered when mapping');
});

test('everyone sees the CVEs, but asset details only for customers they may see', async () => {
  const outsider = (await api('/api/vulnerabilities', { token: ids.tokenDisabled })).data;
  assert.ok(outsider.rows.length >= 2, 'the portal is for everyone');
  assert.equal(outsider.rows.find(row => row.id === 'CVE-2026-1001').affected_assets, 0);
  assert.deepEqual((await api('/api/vulnerabilities/CVE-2026-1001', { token: ids.tokenDisabled })).data.affected, []);
  assert.equal((await api('/api/vulnerabilities/products', { token: ids.tokenDisabled })).data.groups.length, 0);
  const insider = (await api('/api/vulnerabilities/CVE-2026-1001', { token: ids.tokenEnabled })).data;
  assert.equal(insider.affected.length, 1, 'an engineer on the customer team sees it');
  for (const [method, path] of [['GET', '/admin/status'], ['POST', '/admin/sync'], ['POST', '/admin/watch'], ['PUT', '/admin/asset-products'], ['PUT', '/admin/settings']])
    assert.equal((await api(`/api/vulnerabilities${path}`, { method, token: ids.tokenEnabled, ...(method === 'GET' ? {} : { body: {} }) })).status, 403, path);
  assert.equal((await api('/api/vulnerabilities/not-a-cve', { token: ids.tokenEnabled })).status, 400);
  assert.equal((await api('/api/vulnerabilities?severity=extreme', { token: ids.tokenEnabled })).status, 400);
});

test('a vendor too broad to watch whole is reported, and watches can be hidden', async () => {
  assert.equal((await api('/api/vulnerabilities/admin/watch', { method: 'POST', token: ids.tokenManager, body: { cpe_vendor: 'Microsoft' } })).status, 201);
  assert.equal((await api('/api/vulnerabilities/admin/watch', { method: 'POST', token: ids.tokenManager, body: { cpe_vendor: 'bad vendor!' } })).status, 400);
  await run();
  const watch = (await api('/api/vulnerabilities/admin/status', { token: ids.tokenManager })).data.watch;
  const microsoft = watch.find(row => row.cpe_vendor === 'microsoft');
  assert.equal(microsoft.last_status, 'too_broad');
  assert.match(microsoft.last_error, /specific products/);
  const fortinet = watch.find(row => row.cpe_vendor === 'fortinet' && row.cpe_product === '');
  assert.equal((await api(`/api/vulnerabilities/admin/watch/${fortinet.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  const after = (await api('/api/vulnerabilities/admin/status', { token: ids.tokenManager })).data.watch.find(row => row.id === fortinet.id);
  assert.equal(after.hidden, true, 'an asset vendor is hidden rather than deleted');
  const list = (await api('/api/vulnerabilities', { token: ids.tokenManager })).data;
  assert.ok(!list.rows.some(row => row.id === 'CVE-2026-1002'), 'its CVEs leave the portal (fortios is still watched on its own)');
  assert.ok(list.rows.some(row => row.id === 'CVE-2026-1001'));
  assert.equal((await api('/api/vulnerabilities/admin/settings', { method: 'PUT', token: ids.tokenManager, body: { nvd_api_key: 'abc-123' } })).data.nvd_api_key_set, true);
  assert.ok(!JSON.stringify((await api('/api/vulnerabilities/admin/status', { token: ids.tokenManager })).data).includes('abc-123'), 'the key is never sent back');
  assert.ok(calls.some(call => call.includes('lastModStartDate')), 'later syncs ask only for what changed');
});
