const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { createDueTasks } = require('../recurringTasks');

// ids are filled in once the fixture has seeded the database.
const at = () => `/api/customers/${ids.customer}/recurring-tasks`;
const tasksFor = async title => db.prepare('SELECT id, deadline, assigned_to, customer_id, project_id FROM tasks WHERE title = ? ORDER BY deadline').all(title);

test('a recurring task creates its next task a few days before it is due', async () => {
  const today = appTime.today();
  const soon = appTime.addDays(today, 3);
  const made = await api(at(), { method: 'POST', token: ids.tokenManager, body: { title: 'Monthly backup check', frequency: 'monthly', start_date: soon, lead_days: 7, assigned_to: ids.engineerEnabled, priority: 'critical' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.next_due, require('../recurringTasks').occurrence(soon, 'monthly', 1), 'the schedule moved on to the following month');
  const created = await tasksFor('Monthly backup check');
  assert.equal(created.length, 1, 'the first one is within its lead time, so it exists straight away');
  assert.deepEqual([created[0].deadline, Number(created[0].customer_id), created[0].project_id, Number(created[0].assigned_to)], [soon, Number(ids.customer), null, Number(ids.engineerEnabled)]);
  assert.equal((await createDueTasks({ today })).created, 0, 'running again the same day creates nothing');

  const listed = await api(at(), { token: ids.tokenEnabled });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.rows.some(row => row.id === made.data.id), 'engineers who work with the customer can see the schedule');
  assert.equal((await api(at(), { method: 'POST', token: ids.tokenEnabled, body: { title: 'x', frequency: 'weekly', start_date: today } })).status, 403);
  assert.equal((await api(`/api/customers/${ids.customerUnassigned}/recurring-tasks`, { token: ids.tokenEnabled })).status, 403);
});

test('after downtime only the latest missed occurrence is created, then the schedule carries on', async () => {
  const today = appTime.today();
  const made = await api(at(), { method: 'POST', token: ids.tokenManager, body: { title: 'Weekly log review', frequency: 'weekly', start_date: appTime.addDays(today, 30), lead_days: 0 } });
  assert.equal(made.status, 201);
  // Pretend the server was off: the stored next date is five weeks ago.
  await db.prepare('UPDATE recurring_tasks SET start_date = ?, next_due = ? WHERE id = ?').run(appTime.addDays(today, -35), appTime.addDays(today, -35), made.data.id);
  assert.equal((await createDueTasks({ today })).created >= 1, true);
  const created = await tasksFor('Weekly log review');
  assert.equal(created.length, 2, 'the latest missed one, plus today');
  assert.deepEqual(created.map(task => task.deadline), [appTime.addDays(today, -7), today]);
  const row = await db.prepare('SELECT next_due FROM recurring_tasks WHERE id = ?').get(made.data.id);
  assert.equal(row.next_due, appTime.addDays(today, 7));
});

test('managers pause, edit and delete schedules; created tasks stay', async () => {
  const today = appTime.today();
  const made = (await api(at(), { method: 'POST', token: ids.tokenManager, body: { title: 'Quarterly review', frequency: 'quarterly', start_date: appTime.addDays(today, 60) } })).data;
  const paused = await api(`${at()}/${made.id}`, { method: 'PUT', token: ids.tokenManager, body: { active: false } });
  assert.equal(paused.status, 200); assert.equal(paused.data.active, 0);
  assert.equal((await api(`${at()}/${made.id}`, { method: 'PUT', token: ids.tokenManager, body: { assigned_to: ids.manager } })).status, 400, 'only engineers');
  assert.equal((await api(`${at()}/${made.id}`, { method: 'PUT', token: ids.tokenManager, body: { frequency: 'hourly' } })).status, 400);
  assert.equal((await api(`/api/customers/${ids.customerUnassigned}/recurring-tasks/${made.id}`, { method: 'PUT', token: ids.tokenManager, body: { active: true } })).status, 404, 'another customer cannot touch it');
  assert.equal((await api(`${at()}/${made.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`${at()}/${made.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 404);
});

test('a task can be saved with Critical priority', async () => {
  const made = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { title: 'Critical fix', priority: 'critical', customer_id: ids.customer } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
});
