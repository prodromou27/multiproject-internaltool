const { test, assert, api, db, ids } = require('./lib/activityFixture');
const sync = require('../software/sync');

const take = n => `Take ${n} Released on 22 September 2026`;
const checkpointSite = takes => async url => {
  if (String(url).endsWith('/Data/HelpSystem.xml')) return new Response('<x DefaultUrl="R82.00/R82-List-of-all-Resolved-Issues.htm"/>');
  return new Response(takes.map(take).join(' ... '));
};

test('everyone sees the products; FortiOS and Check Point are there from the start', async () => {
  const res = await api('/api/software', { token: ids.tokenEnabled });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.products.map(p => p.name), ['FortiOS', 'Check Point Jumbo Hotfix']);
  assert.equal((await api('/api/software/admin', { token: ids.tokenEnabled })).status, 403);
});

test('a new version is recorded as news, the first reading is not', async () => {
  const product = await db.prepare("SELECT * FROM software_products WHERE source='checkpoint'").get();
  await db.prepare("UPDATE software_products SET config=? WHERE id=?").run(JSON.stringify({ versions: ['R82'] }), product.id);
  const fresh = await db.prepare('SELECT * FROM software_products WHERE id=?').get(product.id);
  const first = await sync.syncProduct(fresh, { fetchImpl: checkpointSite([126, 125]) });
  assert.deepEqual([first.releases, first.events.length], [1, 0]);
  const second = await sync.syncProduct(fresh, { fetchImpl: checkpointSite([127, 126]) });
  assert.deepEqual(second.events, [{ branch: 'R82', kind: 'latest', version: 'Take 127', previous: 'Take 126' }]);
  const page = (await api('/api/software', { token: ids.tokenEnabled })).data;
  assert.equal(page.products.find(p => p.id === product.id).releases[0].latest_version, 'Take 127');
  assert.equal(page.events[0].version, 'Take 127');
  assert.equal(page.events[0].product_name, 'Check Point Jumbo Hotfix');

  // A failing source is shown, and what was read before stays.
  await assert.rejects(sync.syncProduct(fresh, { fetchImpl: async () => new Response('down', { status: 503 }) }));
  const after = (await api('/api/software', { token: ids.tokenEnabled })).data.products.find(p => p.id === product.id);
  assert.match(after.last_error, /HTTP 503/);
  assert.equal(after.releases[0].latest_version, 'Take 127');
});

test('managers add a product whose versions they enter by hand', async () => {
  const created = await api('/api/software/admin/products', { method: 'POST', token: ids.tokenManager, body: { name: 'Sophos Firewall', vendor: 'Sophos', source: 'manual', config: {} } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const path = `/api/software/admin/products/${created.data.id}/releases`;
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { branch: '21.0', latest_version: '21.0 MR1', latest_date: 'soon' } })).status, 400);
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { branch: '21.0', latest_version: '21.0 MR1', latest_date: '2026-09-01', support_end: '2028-06-30', note: 'Check with the vendor' } })).status, 200);
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { branch: '21.0', latest_version: '21.0 MR2', latest_date: '2026-10-01', support_end: '2028-06-30' } })).status, 200);
  const page = (await api('/api/software', { token: ids.tokenEnabled })).data;
  const row = page.products.find(p => p.name === 'Sophos Firewall').releases[0];
  assert.deepEqual([row.latest_version, row.support_end, row.note], ['21.0 MR2', '2028-06-30', 'Check with the vendor']);
  assert.ok(page.events.some(e => e.version === '21.0 MR2' && e.previous === '21.0 MR1'));
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenEnabled, body: { branch: '21.0', latest_version: 'x' } })).status, 403);

  // Products read from a source cannot be edited by hand; bad settings are refused.
  const fortios = page.products.find(p => p.name === 'FortiOS');
  assert.equal((await api(`/api/software/admin/products/${fortios.id}/releases`, { method: 'PUT', token: ids.tokenManager, body: { branch: '7.4', latest_version: '7.4.99' } })).status, 400);
  assert.equal((await api('/api/software/admin/products', { method: 'POST', token: ids.tokenManager, body: { name: 'X', source: 'checkpoint', config: { versions: ['eighty'] } } })).status, 400);
  assert.equal((await api('/api/software/admin/feeds', { method: 'POST', token: ids.tokenManager, body: { name: 'Local', url: 'http://127.0.0.1/feed' } })).status, 400, 'feeds must be public https addresses');
  assert.equal((await api(`/api/software/admin/products/${created.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
});

test('customer assets running older software are found, per customer and across customers', async () => {
  const { encrypt } = require('../fieldCipher');
  const fortios = await db.prepare("SELECT id FROM software_products WHERE source = 'fortinet'").get();
  await db.prepare("UPDATE software_products SET asset_vendor = 'Fortinet', enabled = 1 WHERE id = ?").run(fortios.id);
  await db.exec(`DELETE FROM software_releases WHERE product_id = ${Number(fortios.id)}`);
  await db.prepare('INSERT INTO software_releases (product_id, branch, latest_version) VALUES (?, ?, ?)').run(fortios.id, '7.4', '7.4.8');
  const add = (name, version, lifecycle = 'active') => db.prepare(`INSERT INTO customer_assets (customer_id, name, asset_type, vendor, model, software_version, lifecycle_status, created_by)
    VALUES (?, ?, 'firewall', ?, ?, ?, ?, ?)`).run(ids.customer, encrypt(name), encrypt('Fortinet'), encrypt('FortiGate 100F'), encrypt(version), lifecycle, ids.manager);
  await add('FW-OLD', '7.4.3'); await add('FW-NEW', '7.4.8'); await add('FW-ODD', '6.4.15'); await add('FW-SPARE', '7.4.1', 'spare');

  const res = await api(`/api/customers/${ids.customer}/assets/software-status`, { token: ids.tokenManager });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const byName = Object.fromEntries(res.data.assets.map(a => [a.name, a]));
  assert.deepEqual([byName['FW-OLD'].status, byName['FW-OLD'].behind, byName['FW-OLD'].latest], ['behind', 5, '7.4.8']);
  assert.deepEqual([byName['FW-NEW'].status, byName['FW-ODD'].status], ['current', 'unknown_line']);
  assert.equal(byName['FW-SPARE'], undefined, 'spares are not checked');

  const estate = await api('/api/software/estate', { token: ids.tokenManager });
  assert.equal(estate.status, 200);
  assert.deepEqual(estate.data.attention.map(a => [a.name, a.customer_name]), [['FW-OLD', 'Acme Corp']]);
  assert.equal(estate.data.counts.current, 1);
  assert.equal((await api('/api/software/estate', { token: ids.tokenEnabled })).status, 403);
});

test('Check Point\'s newer documentation layout (one page per take) is read too, keeping the recommended take', async () => {
  const product = await db.prepare("SELECT * FROM software_products WHERE source='checkpoint'").get();
  await db.prepare("UPDATE software_products SET config=? WHERE id=?").run(JSON.stringify({ versions: ['R81.20'] }), product.id);
  await db.exec(`DELETE FROM software_releases WHERE product_id = ${Number(product.id)}`);
  await db.prepare('INSERT INTO software_releases (product_id, branch, latest_version, recommended_version) VALUES (?, ?, ?, ?)').run(product.id, 'R81.20', 'Take 170', 'Take 161');
  const site = async url => {
    if (String(url).endsWith('/Data/HelpSystem.xml')) return new Response('Not found', { status: 404 });
    if (String(url).endsWith('/R81.20/')) return new Response('<a href="Take_170.html">Take 170</a><a href="Take_173.html">Take 173 - Latest</a>');
    if (String(url).endsWith('/Take_173.html')) return new Response('<h1>Take 173 Released on 12 October 2026</h1>');
    return new Response('Not found', { status: 404 });
  };
  const fresh = await db.prepare('SELECT * FROM software_products WHERE id=?').get(product.id);
  const result = await sync.syncProduct(fresh, { fetchImpl: site });
  assert.deepEqual(result.events, [{ branch: 'R81.20', kind: 'latest', version: 'Take 173', previous: 'Take 170' }]);
  const row = await db.prepare('SELECT latest_version, latest_date, recommended_version, link FROM software_releases WHERE product_id = ?').get(product.id);
  assert.deepEqual({ ...row }, { latest_version: 'Take 173', latest_date: '2026-10-12', recommended_version: 'Take 161', link: 'https://sc1.checkpoint.com/documents/Jumbo_HFA/R81.20/Take_173.html' });
});
