const { test, assert, api, db, ids } = require('./lib/activityFixture');

const base = () => `/api/customers/${ids.customer}/assets`;
let fwOld, fwNew;

test('setup: a followed product and two assets', async () => {
  const fortios = await db.prepare("SELECT id FROM software_products WHERE source = 'fortinet'").get();
  await db.prepare("UPDATE software_products SET asset_vendor = 'Fortinet', enabled = 1 WHERE id = ?").run(fortios.id);
  await db.exec(`DELETE FROM software_releases WHERE product_id = ${Number(fortios.id)}`);
  await db.prepare('INSERT INTO software_releases (product_id, branch, latest_version) VALUES (?, ?, ?)').run(fortios.id, '7.4', '7.4.8');
  const add = async (name, version) => (await api(base(), { method: 'POST', token: ids.tokenManager, body: { name, asset_type: 'Firewall', vendor: 'Fortinet', model: 'FortiGate 100F', software_version: version } })).data;
  fwOld = await add('FW-OLD', '7.4.3'); fwNew = await add('FW-NEW', '7.4.8');
  assert.ok(fwOld.id && fwNew.id);
});

test('a review confirms or updates the version, and every review and version change is kept', async () => {
  const review = body => api(`${base()}/${fwOld.id}/review`, { method: 'POST', token: ids.tokenManager, body });
  assert.equal((await review({ version: fwOld.version + 5 })).status, 409, 'an old copy of the asset');
  assert.equal((await review({ version: fwOld.version, software_version: 'x'.repeat(501) })).status, 400);

  const confirmed = await review({ version: fwOld.version, note: 'Checked on the console' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.software_version, '7.4.3');
  assert.ok(confirmed.data.reviewed_at);
  const upgraded = await review({ version: confirmed.data.version, software_version: '7.4.8' });
  assert.equal(upgraded.data.software_version, '7.4.8');

  // An edit that changes the version is kept too.
  const edited = await api(`${base()}/${fwOld.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...upgraded.data, software_version: '7.4.9' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  await api(`${base()}/${fwOld.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...edited.data, notes: 'Only a note' } });

  const log = await api(`${base()}/${fwOld.id}/versions`, { token: ids.tokenManager });
  assert.equal(log.status, 200);
  assert.deepEqual(log.data.map(e => [e.kind, e.from_version, e.to_version, e.note]), [
    ['changed', '7.4.8', '7.4.9', null], ['reviewed', '7.4.3', '7.4.8', null], ['reviewed', '7.4.3', '7.4.3', 'Checked on the console']]);
  assert.equal(log.data[0].user_name, 'Manager One');
});

test('the list shows the last review, what is due a review, and assets needing an update', async () => {
  const list = async query => (await api(`${base()}?${new URLSearchParams(query)}`, { token: ids.tokenManager })).data;
  const all = await list({});
  const old = all.rows.find(r => r.id === fwOld.id);
  assert.equal(old.reviewed_by_name, 'Manager One');
  assert.deepEqual([all.expiry_summary.active, all.expiry_summary.review_due, all.expiry_summary.review_days], [2, 1, 90]);
  assert.deepEqual((await list({ review: 'due' })).rows.map(r => r.name), ['FW-NEW']);
  // FW-OLD now runs 7.4.9 (current); make FW-NEW behind.
  await db.prepare("UPDATE software_releases SET latest_version = '7.4.10'").run();
  assert.deepEqual((await list({ software: 'attention' })).rows.map(r => r.name).sort(), ['FW-NEW', 'FW-OLD']);
  await db.prepare("UPDATE software_releases SET latest_version = '7.4.9'").run();
  assert.deepEqual((await list({ software: 'attention' })).rows.map(r => r.name), ['FW-NEW']);
  assert.deepEqual((await list({ software: 'end_of_life' })).rows, []);
  for (const bad of [{ review: 'x' }, { software: 'x' }])
    assert.equal((await api(`${base()}?${new URLSearchParams(bad)}`, { token: ids.tokenManager })).status, 400, JSON.stringify(bad));
});

test('engineers on the customer\'s managed-services team review and edit assets, but cannot change service coverage', async () => {
  await db.prepare('UPDATE teams SET managed_service_operations = 1 WHERE id = ?').run(ids.teamEnabled);
  const asEngineer = (path, options = {}) => api(`${base()}${path}`, { token: ids.tokenEnabled, ...options });
  assert.equal((await asEngineer('/software-status')).status, 200);
  const current = (await asEngineer('')).data.rows.find(r => r.id === fwNew.id);
  assert.equal(current.coverage_type, 'neither');
  const reviewed = await asEngineer(`/${fwNew.id}/review`, { method: 'POST', body: { version: current.version } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal((await asEngineer(`/${fwNew.id}/versions`)).data[0].user_name, 'Engineer Enabled');

  // Edits asset details, but a coverage_type sent along with it is silently ignored —
  // service coverage ("Managed"/"Under support"/"Neither") is a manager-only decision.
  const edited = await asEngineer(`/${fwNew.id}`, { method: 'PUT', body: { ...reviewed.data, location: 'Rack 4', coverage_type: 'managed' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.location, 'Rack 4');
  assert.equal(edited.data.coverage_type, 'neither', 'service coverage must stay a manager-only decision');

  assert.equal((await api(`${base()}/${fwNew.id}/review`, { method: 'POST', token: ids.tokenDisabled, body: { version: reviewed.data.version } })).status, 403, 'not on the team');
  assert.equal((await api(`${base()}/${fwNew.id}`, { method: 'PUT', token: ids.tokenDisabled, body: { ...edited.data, location: 'Should fail' } })).status, 403, 'not on the team');
});

test('a customer task can be about one of the customer\'s assets', async () => {
  const add = body => api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Upgrade FW-NEW', ...body } });
  const made = await add({ asset_id: fwNew.id });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(Number((await db.prepare('SELECT asset_id FROM tasks WHERE id = ?').get(made.data.id)).asset_id), Number(fwNew.id));
  const other = await add({ customer_id: ids.customerUnassigned, asset_id: fwNew.id });
  assert.equal(other.status, 400, 'another customer\'s asset');
  const rows = (await api(`/api/customers/${ids.customer}/operations/tasks?filter=open`, { token: ids.tokenManager })).data.rows;
  assert.equal(rows.find(r => r.id === Number(made.data.id)).asset_name, 'FW-NEW');
});

test('the search bar finds assets by serial, hostname or IP, within what each person may see', async () => {
  const make = (customer, body) => api(`/api/customers/${customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { asset_type: 'Firewall', ...body } });
  assert.equal((await make(ids.customer, { name: 'EDGE-FW-77', serial_number: 'FGT60FTK2209XYZ', hostname: 'edge-fw-77.acme.local', ip_address: '10.77.0.1' })).status, 201);
  assert.equal((await make(ids.customerUnassigned, { name: 'OTHER-FW-77', serial_number: 'FGT60FTK2209ABC' })).status, 201);
  const search = (q, token = ids.tokenManager) => api(`/api/search?q=${encodeURIComponent(q)}`, { token }).then(r => r.data);

  const bySerial = await search('tk2209xyz');
  assert.deepEqual(bySerial.assets.map(a => [a.name, a.matched?.field]), [['EDGE-FW-77', 'Serial']]);
  assert.equal(bySerial.assets[0].customer_id, ids.customer);
  assert.equal((await search('edge-fw-77.acme')).assets[0].matched.field, 'Hostname');
  assert.equal((await search('10.77.0.1')).assets[0].matched.field, 'IP');
  assert.equal((await search('FGT60FTK2209')).assets.length, 2, 'managers see every customer');

  // The engineer works with Acme (team) but not Other Corp.
  assert.deepEqual((await search('FGT60FTK2209', ids.tokenEnabled)).assets.map(a => a.name), ['EDGE-FW-77']);
  assert.ok((await search('Acme', ids.tokenEnabled)).customers.some(c => c.id === ids.customer));
  assert.ok(!(await search('Other Corp', ids.tokenEnabled)).customers.length);
  // Planners without assets.access find no assets.
  assert.deepEqual((await search('FGT60FTK2209', ids.tokenPlanner)).assets, []);
});
