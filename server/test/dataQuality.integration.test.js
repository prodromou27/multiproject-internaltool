// Customer data-quality queue (enhancement E06).
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const queue = async (token = ids.tokenManager) => api('/api/data-quality', { token });
const itemsFor = async customerId => (await queue()).data.items.filter(i => i.customer_id === customerId);
const rulesFor = async customerId => (await itemsFor(customerId)).map(i => i.rule).sort();

let managed;
test('a managed customer with gaps shows each as a fixable item with its owner', async () => {
  managed = (await db.prepare('INSERT INTO customers (name, active) VALUES (?, 1)').run('Quality Managed Ltd')).lastInsertRowid;
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled, responsible_team_id) VALUES (?, 1, ?)').run(managed, ids.teamEnabled);
  await db.prepare("INSERT INTO software_products (name, source, asset_vendor) VALUES ('FortiOS', 'manual', 'Fortinet')").run();
  const asset = (vendor, version, reviewed) => db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, vendor, software_version, reviewed_at, created_by) VALUES (?, 'fw', 'firewall', ?, ?, ?, ?)").run(managed, vendor, version, reviewed, ids.manager);
  await asset('Unknown Vendor', '1.2.3', null);
  await asset('Fortinet', 'not a version', appTime.today());
  await asset('Fortinet', null, appTime.today());

  assert.equal((await queue(ids.tokenEnabled)).status, 403, 'managers only');
  const items = await itemsFor(managed);
  assert.deepEqual(items.map(i => i.rule).sort(), ['no_contact', 'no_current_contract', 'no_owner', 'review_due', 'untracked_versions']);
  const byRule = Object.fromEntries(items.map(i => [i.rule, i]));
  assert.equal(byRule.no_owner.detail, 'No service manager.');
  assert.equal(byRule.no_owner.owner, 'Security Team', 'the responsible team owns it');
  assert.equal(byRule.untracked_versions.detail, '2 devices: vendor not followed, or version not understood.');
  assert.equal(byRule.review_due.detail, '1 device to review.');
  assert.equal(byRule.no_current_contract.fix, `/customers/${managed}?section=contracts`);
});

test('fixing the record clears the item; archived customers are left out', async () => {
  await db.prepare('INSERT INTO customer_contracts (customer_id, reference, start_date, end_date) VALUES (?, ?, ?, ?)').run(managed, 'Q-1', '2000-01-01', '2999-12-31');
  await db.prepare('UPDATE managed_customer_configurations SET service_manager_id = ? WHERE customer_id = ?').run(ids.manager, managed);
  await db.prepare('UPDATE customers SET primary_contact = ? WHERE id = ?').run('Dana Ops', managed);
  assert.deepEqual(await rulesFor(managed), ['review_due', 'untracked_versions']);
  await db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(managed);
  assert.deepEqual(await rulesFor(managed), []);
  await db.prepare('UPDATE customers SET active = 1 WHERE id = ?').run(managed);
});

test('a manager may dismiss an item with a reason, and undo it; both are audited', async () => {
  const dismiss = (body, token = ids.tokenManager) => api('/api/data-quality/dismiss', { method: 'POST', token, body });
  assert.equal((await dismiss({ customer_id: managed, rule: 'review_due', reason: 'x' }, ids.tokenEnabled)).status, 403);
  assert.equal((await dismiss({ customer_id: managed, rule: 'review_due', reason: '  ' })).status, 400, 'a reason is required');
  assert.equal((await dismiss({ customer_id: managed, rule: 'made_up', reason: 'x' })).status, 400);
  assert.equal((await dismiss({ customer_id: 999999, rule: 'review_due', reason: 'x' })).status, 404);
  assert.equal((await dismiss({ customer_id: managed, rule: 'review_due', reason: 'Lab devices, reviewed yearly' })).status, 200);
  const item = (await itemsFor(managed)).find(i => i.rule === 'review_due');
  assert.equal(item.dismissed.reason, 'Lab devices, reviewed yearly');
  const audit = await db.prepare("SELECT detail FROM audit_log WHERE action = 'data_quality_dismissed' AND entity_id = ?").get(managed);
  assert.equal(audit.detail, 'review_due: Lab devices, reviewed yearly');

  const restore = body => api('/api/data-quality/restore', { method: 'POST', token: ids.tokenManager, body });
  assert.equal((await restore({ customer_id: managed, rule: 'review_due' })).status, 200);
  assert.equal((await itemsFor(managed)).find(i => i.rule === 'review_due').dismissed, null);
  assert.equal((await restore({ customer_id: managed, rule: 'review_due' })).status, 404);
});
