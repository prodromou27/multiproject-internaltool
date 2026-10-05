const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');

test('a new activity is logged as completed unless a status is given', async () => {
  const body = { customer_id: ids.customer, activity_date: '2026-10-01', category_id: ids.category, title: 'Completed by default' };
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(created.status, 200);
  const row = await db.prepare('SELECT status, completed_at FROM service_activities WHERE id = ?').get(created.data.id);
  assert.match(row.status, /complet/);
  assert.ok(row.completed_at);
});

test('a task can be created for a customer without a project, and shows on that customer', async () => {
  const path = `/api/customers/${ids.customer}/operations/tasks`;
  const made = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { title: 'Renew SSL certificate', customer_id: ids.customer, assigned_to: ids.engineerEnabled, priority: 'high', deadline: '2026-11-01' } });
  assert.equal(made.status, 200);
  const stored = await db.prepare('SELECT project_id, customer_id, assigned_to FROM tasks WHERE id = ?').get(made.data.id);
  assert.deepEqual([stored.project_id, Number(stored.customer_id), Number(stored.assigned_to)], [null, Number(ids.customer), Number(ids.engineerEnabled)]);

  const listed = await api(path, { token: ids.tokenManager });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.rows.some(row => row.id === made.data.id && Number(row.customer_id) === Number(ids.customer)), 'listed on the customer');
  const filtered = await api(`/api/tasks?customer_id=${ids.customer}`, { token: ids.tokenManager });
  const task = filtered.data.find(row => row.id === made.data.id);
  assert.ok(task, 'the Tasks page can filter by customer');
  assert.ok(task.customer_name, 'and shows the customer name');
  const overview = await api(`/api/customers/${ids.customer}/overview`, { token: ids.tokenManager });
  assert.ok(overview.data.recent_tasks?.some?.(row => row.id === made.data.id) ?? true);
});

test('engineers add customer tasks only for customers they work with, assigned to themselves', async () => {
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenEnabled, body: { title: 'No home' } })).status, 400);
  const mine = await api('/api/tasks', { method: 'POST', token: ids.tokenEnabled, body: { title: 'Check backups', customer_id: ids.customer, assigned_to: ids.manager } });
  assert.equal(mine.status, 200);
  assert.equal(Number((await db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(mine.data.id)).assigned_to), Number(ids.engineerEnabled));
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenEnabled, body: { title: 'Not mine', customer_id: ids.customerUnassigned } })).status, 403);
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { title: 'Ghost', customer_id: 999999 } })).status, 400);
});

test("an engineer's customer list includes their team's customers, so they can pick them for a task", async () => {
  const list = (await api('/api/customers', { token: ids.tokenEnabled })).data;
  const rows = Array.isArray(list) ? list : list.rows;
  assert.ok(rows.some(row => Number(row.id) === Number(ids.customer)), 'team customer listed');
  assert.ok(!rows.some(row => Number(row.id) === Number(ids.customerUnassigned)), 'other customers are not');
});
