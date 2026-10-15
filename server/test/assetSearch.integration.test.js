// Large-data paths (review I11): asset search through the blind index, and lists that decrypt only what they show.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'c'.repeat(64);
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const { candidateAssetIds, ensureAssetSearchIndex } = require('../assetSearchIndex');

const make = (customer, body) => api(`/api/customers/${customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { asset_type: 'Firewall', ...body } });
const search = (q, token = ids.tokenManager) => api(`/api/search?q=${encodeURIComponent(q)}`, { token }).then(r => r.data.assets);

test('assets are indexed by keyed hashes; the database never holds readable values', async () => {
  const created = await make(ids.customer, { name: 'CORE-SW-01', serial_number: 'SN-ALPHA-4411', hostname: 'core-sw-01.acme.local', ip_address: '10.20.30.40' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const tokens = await db.prepare('SELECT token_hash FROM asset_search_tokens WHERE asset_id = ?').all(created.data.id);
  assert.ok(tokens.length > 20);
  assert.ok(tokens.every(row => /^[a-f0-9]{64}$/.test(row.token_hash)), 'only hashes');
  assert.ok(!JSON.stringify(tokens).includes('alpha'));
  assert.deepEqual([...await candidateAssetIds(db, 'alpha-44')], [Number(created.data.id)]);
});

test('search finds by serial, hostname or IP, limited to what each person may see', async () => {
  await make(ids.customerUnassigned, { name: 'EDGE-FW-02', serial_number: 'SN-ALPHA-9999' });
  assert.deepEqual((await search('alpha-4411')).map(a => [a.name, a.matched?.field]), [['CORE-SW-01', 'Serial']]);
  assert.equal((await search('core-sw-01.acme'))[0].matched.field, 'Hostname');
  assert.equal((await search('10.20.30.40'))[0].matched.field, 'IP');
  assert.equal((await search('SN-ALPHA')).length, 2, 'managers see every customer');
  assert.deepEqual((await search('SN-ALPHA', ids.tokenEnabled)).map(a => a.name), ['CORE-SW-01'], 'engineers only their customers');
  assert.deepEqual(await search('no-such-thing'), []);
  assert.equal((await search('SN')).length, 2, 'a 2-letter term still works (bounded scan)');
});

test('an edit re-indexes the asset; a deleted asset leaves no hashes', async () => {
  const asset = (await make(ids.customer, { name: 'TEMP-AP-1', serial_number: 'OLD-SERIAL-777' })).data;
  const changed = await api(`/api/customers/${ids.customer}/assets/${asset.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...asset, serial_number: 'NEW-SERIAL-888', version: asset.version } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.deepEqual(await search('old-serial-777'), []);
  assert.equal((await search('new-serial-888'))[0].name, 'TEMP-AP-1');
  assert.equal((await api(`/api/customers/${ids.customer}/assets/${asset.id}`, { method: 'DELETE', token: ids.tokenManager, body: { version: changed.data.version } })).status, 200);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM asset_search_tokens WHERE asset_id = ?').get(asset.id)).n), 0);
});

test('assets without an entry for the current key are indexed at start-up', async () => {
  await db.prepare('DELETE FROM asset_search_tokens').run();
  await db.prepare('DELETE FROM asset_search_documents').run();
  assert.deepEqual(await search('alpha-4411'), [], 'nothing indexed, nothing found');
  const done = await ensureAssetSearchIndex(db);
  assert.ok(done.indexed >= 2);
  assert.equal((await search('alpha-4411'))[0].name, 'CORE-SW-01');
});

test('the project list counts tasks in one pass and still reports pins, progress and customer names', async () => {
  const { encryptCustomer } = require('../fieldCipher');
  const sealed = encryptCustomer({ name: 'Zephyr Shipping' });
  const customer = (await db.prepare('INSERT INTO customers (name, active) VALUES (?, 1)').run(sealed.name)).lastInsertRowid;
  const project = (await db.prepare("INSERT INTO projects (title, customer_id, created_by, status, deadline) VALUES ('Port upgrade', ?, ?, 'in_progress', '2099-01-01')").run(customer, ids.manager)).lastInsertRowid;
  for (const [status, deadline] of [['completed', null], ['todo', '2000-01-01'], ['in_progress', null], ['cancelled', null]])
    await db.prepare('INSERT INTO tasks (project_id, title, status, deadline, created_by) VALUES (?, ?, ?, ?, ?)').run(project, `T ${status}`, status, deadline, ids.manager);
  await api(`/api/projects/${project}/pin`, { method: 'POST', token: ids.tokenManager });
  const page = await api('/api/projects?paged=1&status=all&search=zephyr', { token: ids.tokenManager });
  assert.equal(page.status, 200, JSON.stringify(page.data));
  const row = page.data.rows.find(r => Number(r.id) === Number(project));
  assert.deepEqual([row.customer_name, row.task_count, row.done_count, row.overdue_task_count, row.is_pinned, row.completion_pct], ['Zephyr Shipping', 3, 1, 1, true, 33]);
  assert.equal(row.customer_name_decrypted, undefined, 'no internal fields leak');
  const full = await api('/api/projects', { token: ids.tokenManager });
  assert.equal(full.data.find(r => Number(r.id) === Number(project)).customer_name, 'Zephyr Shipping');
});

test('a very common term keeps the newest candidates only', async () => {
  const index = require('../assetSearchIndex');
  const many = Array.from({ length: 30 }, (_, i) => i);
  for (const i of many) await make(ids.customer, { name: `BULK-${i}`, model: 'CommonModel X' });
  const all = await candidateAssetIds(db, 'commonmodel');
  assert.ok(all.size >= 30 && all.size <= index.MAX_CANDIDATES);
  assert.equal((await search('commonmodel')).length, 8, 'the search shows the first few');
});
