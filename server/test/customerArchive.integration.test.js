const { test, assert, api, db, ids } = require('./lib/activityFixture');

const make = async name => (await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name } })).data.id;

test('customers are archived, not deleted: history stays and they can be restored', async () => {
  const id = await make('Archive Me Ltd');
  await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Old visit', '2026-01-10', 'completed', ?)").run(id, ids.manager);
  assert.equal((await api(`/api/customers/${id}`, { method: 'DELETE', token: ids.tokenManager })).status, 409, 'an active customer must be archived first');

  assert.equal((await api(`/api/customers/${id}/archive`, { method: 'POST', token: ids.tokenPlanner, body: {} })).status, 200, 'planners can archive');
  assert.equal((await db.prepare('SELECT active FROM customers WHERE id = ?').get(id)).active, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM maintenance_visits WHERE customer_id = ?').get(id)).n, 1, 'its history is kept');
  assert.equal((await api(`/api/customers/${id}/restore`, { method: 'POST', token: ids.tokenManager, body: {} })).status, 200);
  assert.equal((await db.prepare('SELECT active FROM customers WHERE id = ?').get(id)).active, 1);
  assert.equal((await api(`/api/customers/${id}/archive`, { method: 'POST', token: ids.tokenEnabled, body: {} })).status, 403, 'engineers cannot');

  const actions = (await db.prepare("SELECT action FROM audit_log WHERE entity_type = 'customer' AND entity_id = ? ORDER BY id").all(id)).map(r => r.action);
  assert.deepEqual(actions, ['customer_archived', 'customer_restored']);
});

test('only managers delete, only archived customers, and it is recorded', async () => {
  const id = await make('Delete Me Ltd');
  await api(`/api/customers/${id}/archive`, { method: 'POST', token: ids.tokenManager, body: {} });
  assert.equal((await api(`/api/customers/${id}`, { method: 'DELETE', token: ids.tokenPlanner })).status, 403);
  assert.equal((await api(`/api/customers/${id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal(await db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id), undefined);
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'customer_deleted' AND entity_id = ?").get(id));
});
