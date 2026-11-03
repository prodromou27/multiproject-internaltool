// Remediation campaigns (enhancement E01).
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

let product, other, behind1, behind2, behind3, campaign;
const as = (method, path, body, token = ids.tokenManager) => api(`/api/remediation-campaigns${path}`, { method, token, body });
const asset = (customer, name, version) => db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, vendor, software_version, created_by) VALUES (?, ?, 'firewall', 'Fortinet', ?, ?) RETURNING id").get(customer, name, version, ids.manager).then(row => row.id);

test('a preview groups the devices on old software by customer, with what already covers them', async () => {
  product = (await db.prepare("INSERT INTO software_products (name, source, asset_vendor) VALUES ('FortiOS', 'manual', 'Fortinet') RETURNING id").get()).id;
  await db.prepare("INSERT INTO software_releases (product_id, branch, latest_version) VALUES (?, '7.4', '7.4.5')").run(product);
  other = (await db.prepare("INSERT INTO customers (name, active) VALUES ('Remedy Two', 1) RETURNING id").get()).id;
  behind1 = await asset(ids.customer, 'fw-acme-1', '7.4.1');
  behind2 = await asset(ids.customer, 'fw-acme-2', '7.4.2');
  behind3 = await asset(other, 'fw-two-1', '7.4.0');
  await asset(other, 'fw-two-current', '7.4.5');
  await db.prepare("INSERT INTO tasks (customer_id, title, status, asset_id, created_by) VALUES (?, 'Already planned', 'not_started', ?, ?)").run(ids.customer, behind2, ids.manager);

  assert.equal((await as('POST', '/preview', { source_type: 'software', source_ref: product }, ids.tokenEnabled)).status, 403, 'managers only');
  assert.equal((await as('POST', '/preview', { source_type: 'cve', source_ref: 'not-a-cve' })).status, 400);
  const res = await as('POST', '/preview', { source_type: 'software', source_ref: product });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.title, 'FortiOS');
  const byCustomer = Object.fromEntries(res.data.customers.map(c => [c.customer_id, c.devices.map(d => d.asset_id).sort()]));
  assert.deepEqual(byCustomer, { [ids.customer]: [behind1, behind2].sort(), [other]: [behind3] }, 'the current device is left out');
  const planned = res.data.customers.find(c => c.customer_id === ids.customer).devices.find(d => d.asset_id === behind2);
  assert.equal(planned.open_task.title, 'Already planned');
});

test('starting a campaign creates one task per customer with a subtask per device, and never repeats a device', async () => {
  const body = { source_type: 'software', source_ref: product, name: 'FortiOS 7.4.5 rollout', target_date: '2026-12-15',
    customers: [{ customer_id: ids.customer, asset_ids: [behind1], assigned_to: ids.engineerEnabled }, { customer_id: other, assigned_to: ids.engineerEnabled }] };
  assert.equal((await as('POST', '', { ...body, target_date: 'soon' })).status, 400);
  assert.equal((await as('POST', '', { ...body, customers: [{ customer_id: ids.customer, asset_ids: [999999] }] })).status, 400);
  const made = await as('POST', '', body);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  campaign = made.data.id;
  const tasks = await db.prepare("SELECT id, customer_id, assigned_to, deadline, title FROM tasks WHERE title LIKE 'FortiOS 7.4.5 rollout%' ORDER BY customer_id").all();
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map(t => [t.assigned_to, String(t.deadline).slice(0, 10)]), [[ids.engineerEnabled, '2026-12-15'], [ids.engineerEnabled, '2026-12-15']]);
  assert.equal(tasks.find(t => t.customer_id === ids.customer).title, 'FortiOS 7.4.5 rollout: upgrade 1 device');
  const subtasks = await db.prepare('SELECT asset_id FROM task_subtasks WHERE task_id IN (?, ?)').all(tasks[0].id, tasks[1].id);
  assert.deepEqual(subtasks.map(s => s.asset_id).sort(), [behind1, behind3].sort());

  // The same devices cannot go into a second active campaign for this product.
  const again = await as('POST', '/preview', { source_type: 'software', source_ref: product });
  assert.equal(again.data.customers.find(c => c.customer_id === other).devices[0].in_campaign.id, campaign);
  assert.equal((await as('POST', '', { ...body, name: 'Twice', customers: [{ customer_id: other }] })).status, 400);
});

test('each device moves from planned to upgraded to verified by a fresh review; exceptions are recorded', async () => {
  const status = async () => Object.fromEntries((await as('GET', `/${campaign}`)).data.items.map(i => [i.asset_id, i.status]));
  assert.deepEqual(await status(), { [behind1]: 'planned', [behind3]: 'planned' });

  await db.prepare('UPDATE task_subtasks SET done = 1 WHERE asset_id = ?').run(behind1);
  assert.equal((await status())[behind1], 'upgraded', 'ticked, not yet confirmed');
  await db.prepare('UPDATE customer_assets SET software_version = ? WHERE id = ?').run('7.4.5', behind1);
  let item = (await as('GET', `/${campaign}`)).data.items.find(i => i.asset_id === behind1);
  assert.equal(item.status, 'upgraded');
  assert.equal(item.needs_review, true, 'shown fixed only after someone reviews the device');
  await db.prepare('UPDATE customer_assets SET reviewed_at = ? WHERE id = ?').run(appTime.today(), behind1);
  assert.equal((await status())[behind1], 'verified');

  assert.equal((await as('PUT', `/${campaign}/items/${behind3}`, { exception_reason: '' })).status, 400);
  assert.equal((await as('PUT', `/${campaign}/items/${behind3}`, { exception_reason: 'Customer replacing the unit in Q1' })).status, 200);
  const full = (await as('GET', `/${campaign}`)).data;
  assert.deepEqual(full.counts, { planned: 0, upgraded: 0, verified: 1, exception: 1 });
  assert.equal(full.items.find(i => i.asset_id === behind3).exception_reason, 'Customer replacing the unit in Q1');
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'remediation_campaign' AND action = 'exception_recorded'").get());

  assert.equal((await as('PUT', `/${campaign}`, { status: 'closed' })).status, 200);
  assert.equal((await as('GET', '')).data.rows.find(r => r.id === campaign).status, 'closed');
});
