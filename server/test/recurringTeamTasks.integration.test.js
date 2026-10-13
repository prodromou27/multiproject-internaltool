const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const at = (customer = ids.customer) => `/api/customers/${customer}/recurring-tasks`;
const tasksOf = async token => (await api('/api/tasks', { token })).data;
const pgOnly = { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL' };

test('a team task appears for every member of the team; whoever completes it takes it', async () => {
  const today = appTime.today();
  const asset = (await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, created_by) VALUES (?, 'FW-01', 'firewall', ?)").run(ids.customer, ids.manager)).lastInsertRowid;
  const made = await api(at(), { method: 'POST', token: ids.tokenManager, body: {
    title: 'Review firewall logs', frequency: 'custom', interval_count: 3, interval_unit: 'day', start_date: today,
    team_id: ids.teamEnabled, asset_id: asset, technology_id: ids.technology, lead_days: 0 } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual([made.data.team_name, made.data.asset_name, made.data.notify, made.data.next_due], ['Security Team', 'FW-01', false, appTime.addDays(today, 3)]);

  // Today's occurrence exists now, for the team, about the asset and technology.
  const task = await db.prepare('SELECT * FROM tasks WHERE recurring_task_id = ?').get(made.data.id);
  assert.deepEqual([task.assigned_to, Number(task.team_id), Number(task.asset_id), Number(task.technology_id), task.deadline], [null, Number(ids.teamEnabled), Number(asset), Number(ids.technology), today]);

  // The team member sees it in their tasks; an engineer from another team does not.
  // (pg-mem mis-evaluates the full task-list query; CI checks this on PostgreSQL.)
  if (process.env.TEST_DATABASE_URL) {
    assert.ok((await tasksOf(ids.tokenEnabled)).some(t => t.id === task.id));
    assert.ok(!(await tasksOf(ids.tokenDisabled)).some(t => t.id === task.id));
  }
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'PUT', token: ids.tokenDisabled, body: { status: 'completed' } })).status, 403);
  const counts = (await api('/api/tasks/overdue-counts', { token: ids.tokenEnabled })).status;
  assert.equal(counts, 200);

  // Completing it records who did it and when.
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: 'completed' } })).status, 200);
  const done = await db.prepare('SELECT assigned_to, status, completed_at FROM tasks WHERE id = ?').get(task.id);
  assert.deepEqual([Number(done.assigned_to), done.status, !!done.completed_at], [Number(ids.engineerEnabled), 'completed', true]);
  const row = (await api(at(), { token: ids.tokenManager })).data.rows.find(r => r.id === made.data.id);
  assert.deepEqual(row.history, { created: 1, completed: 1, on_time: 1, open: 0, overdue: 0 });

  // Reopening clears the completion date.
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: 'open' } })).status, 200);
  assert.equal((await db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(task.id)).completed_at, null);
});

test('every 2 weeks and custom repeats are checked; the asset must be this customer’s', async () => {
  const today = appTime.today();
  const post = body => api(at(), { method: 'POST', token: ids.tokenManager, body: { title: 'Check', start_date: appTime.addDays(today, 30), ...body } });
  const biweekly = await post({ frequency: 'biweekly', assigned_to: ids.engineerEnabled, notify: true });
  assert.equal(biweekly.status, 201, JSON.stringify(biweekly.data));
  assert.equal(biweekly.data.notify, true);
  assert.equal((await post({ frequency: 'custom' })).status, 400, 'custom needs a count and unit');
  assert.equal((await post({ frequency: 'custom', interval_count: 0, interval_unit: 'day' })).status, 400);
  assert.equal((await post({ frequency: 'custom', interval_count: 2, interval_unit: 'year' })).status, 400);
  const elsewhere = (await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, created_by) VALUES (?, 'X', 'server', ?)").run(ids.customerUnassigned, ids.manager)).lastInsertRowid;
  assert.equal((await post({ frequency: 'weekly', asset_id: elsewhere })).status, 400);
  assert.equal((await post({ frequency: 'weekly', team_id: 999999 })).status, 400);
  // Choosing a team clears the engineer: it is one or the other.
  const switched = await api(`${at()}/${biweekly.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { team_id: ids.teamEnabled } });
  assert.deepEqual([switched.data.assigned_to, Number(switched.data.team_id)], [null, Number(ids.teamEnabled)]);
});

test('recurring tasks can be reported: done on time, who took them, which team', pgOnly, async () => {
  const preview = await api('/api/reports/custom/preview', { method: 'POST', token: ids.tokenManager, body: {
    source: 'recurring_tasks', fields: ['schedule', 'repeat', 'team_id', 'engineer_id', 'on_time', 'technology'],
    filters: [{ field: 'customer_id', operator: 'eq', value: Number(ids.customer) }] } });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const row = preview.data.rows.find(r => r.schedule === 'Review firewall logs');
  assert.deepEqual([row.repeat, row.team_id, row.engineer_id, Number(row.on_time)], ['every 3 days', 'Security Team', 'Engineer Enabled', 0]);
});

test('a team task changed by someone else meanwhile is not overwritten, and its copy stays the team’s', async () => {
  const id = (await db.prepare("INSERT INTO tasks (customer_id, title, team_id, status, created_by) VALUES (?, 'Shared check', ?, 'todo', ?)").run(ids.customer, ids.teamEnabled, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO task_subtasks (task_id, title, position, created_by) VALUES (?, ?, 0, ?)').run(id, 'Step one', ids.manager);
  // A copy keeps the team (so the engineer can still work on it) and the checklist.
  const copy = await api(`/api/tasks/${id}/duplicate`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(copy.status, 200);
  const copied = await db.prepare('SELECT team_id, assigned_to FROM tasks WHERE id = ?').get(copy.data.id);
  assert.deepEqual([Number(copied.team_id), copied.assigned_to], [Number(ids.teamEnabled), null]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM task_subtasks WHERE task_id = ?').get(copy.data.id)).n), 1);
  assert.equal((await api(`/api/tasks/${copy.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: 'in_progress' } })).status, 200, 'and can work on it');

  // Another engineer claims the task between this engineer's read and write: the write is refused.
  const realPrepare = db.prepare;
  let raced = false;
  db.prepare = function (sql) {
    const statement = realPrepare.call(this, sql);
    if (!raced && /^UPDATE tasks SET\s+title=COALESCE/.test(sql.trim())) {
      raced = true;
      return { ...statement, run: async (...params) => {
        await realPrepare.call(db, 'UPDATE tasks SET assigned_to = ? WHERE id = ?').run(ids.manager, id);
        return statement.run(...params);
      } };
    }
    return statement;
  };
  try {
    const late = await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: 'in_progress' } });
    assert.equal(late.status, 409);
  } finally { db.prepare = realPrepare; }
  assert.equal(Number((await db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(id)).assigned_to), Number(ids.manager), 'the other claim stands');
});
