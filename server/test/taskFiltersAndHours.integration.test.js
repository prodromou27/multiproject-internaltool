// More task filters (engineer, team, status, due range) and hours kept per work day.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');
// The paged task list is beyond pg-mem; the filter test runs on PostgreSQL (CI).
const pgOnly = { skip: !process.env.TEST_DATABASE_URL && 'needs PostgreSQL' };

const list = async (query, token = ids.tokenManager) => {
  const res = await api(`/api/tasks?${new URLSearchParams({ page: '1', page_size: '100', ...query })}`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.rows.map(t => t.title).filter(title => title.startsWith('Filter '));
};

test('tasks filter by engineer, team, status and a due-date range', pgOnly, async () => {
  const add = (title, assigned, status, deadline) => db.prepare('INSERT INTO tasks (title, customer_id, assigned_to, status, deadline, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(title, ids.customer, assigned, status, deadline, ids.manager);
  await add('Filter A', ids.engineerEnabled, 'in_progress', '2027-01-10');
  await add('Filter B', ids.engineerEnabled, 'open', '2027-02-10');
  await add('Filter C', ids.engineerDisabled, 'in_progress', '2027-01-15');

  assert.deepEqual((await list({ assigned_to: String(ids.engineerEnabled) })).sort(), ['Filter A', 'Filter B']);
  assert.deepEqual((await list({ team_id: String(ids.teamEnabled) })).sort(), ['Filter A', 'Filter B'], 'tasks of the team members');
  assert.deepEqual((await list({ status: 'in_progress' })).sort(), ['Filter A', 'Filter C']);
  assert.deepEqual((await list({ due_from: '2027-01-01', due_to: '2027-01-31' })).sort(), ['Filter A', 'Filter C']);
  assert.deepEqual(await list({ status: 'in_progress', due_from: '2027-01-12', assigned_to: String(ids.engineerDisabled) }), ['Filter C']);
  // Engineers filter only their own tasks.
  assert.deepEqual((await list({ status: 'in_progress' }, ids.tokenEnabled)).sort(), ['Filter A']);
  for (const bad of [{ due_from: '2027-02-30' }, { status: 'DROP TABLE' }, { team_id: 'x' }])
    assert.equal((await api(`/api/tasks?${new URLSearchParams(bad)}`, { token: ids.tokenManager })).status, 400, JSON.stringify(bad));
});

test('hours are kept by the day the work was done, and listed per day with the customer', async () => {
  const task = (await db.prepare("INSERT INTO tasks (title, customer_id, assigned_to, status, ticket_reference, created_by) VALUES ('Hours task', ?, ?, 'in_progress', 'RT-77', ?) RETURNING id").get(ids.customer, ids.engineerEnabled, ids.manager)).id;
  const log = body => api('/api/time-logs', { method: 'POST', token: ids.tokenEnabled, body: { task_id: task, ...body } });
  const today = appTime.today(), yesterday = appTime.addDays(today, -1);
  assert.equal((await log({ hours: 2, description: 'Config review', work_date: yesterday })).status, 200);
  assert.equal((await log({ hours: 1.5 })).status, 200, 'today by default');
  assert.equal((await log({ hours: 1, work_date: appTime.addDays(today, 1) })).status, 400, 'not in the future');
  assert.equal((await log({ hours: 1, work_date: appTime.addDays(today, -400) })).status, 400, 'at most a year back');

  const mine = await api(`/api/time-logs/mine?from=${yesterday}&to=${today}`, { token: ids.tokenEnabled });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  const rows = mine.data.filter(r => r.task_id === task);
  assert.deepEqual(rows.map(r => [r.work_date, Number(r.hours)]), [[today, 1.5], [yesterday, 2]], 'newest day first');
  assert.equal(rows[1].customer_name, 'Acme Corp');
  assert.equal(rows[1].ticket_reference, 'RT-77');
  assert.equal(rows[1].description, 'Config review');
  const onlyYesterday = await api(`/api/time-logs/mine?from=${yesterday}&to=${yesterday}`, { token: ids.tokenEnabled });
  assert.deepEqual(onlyYesterday.data.filter(r => r.task_id === task).map(r => Number(r.hours)), [2], 'by work day, not by when it was typed');
});

test('general time: hours with no task or visit, a category and optionally a customer, listed in My time', async () => {
  const log = (body, token = ids.tokenEnabled) => api('/api/time-logs', { method: 'POST', token, body });
  const day = appTime.addDays(appTime.today(), -2);
  assert.equal((await log({ hours: 1, work_date: day })).status, 400, 'a category is needed');
  assert.equal((await log({ hours: 1, category: 'holiday', work_date: day })).status, 400);
  assert.equal((await log({ hours: 1, category: 'meeting', customer_id: 999999, work_date: day })).status, 404);
  assert.equal((await log({ hours: 1, category: 'meeting' }, ids.tokenPlanner)).status, 403, 'engineers and managers only');
  assert.equal((await log({ hours: 1.5, category: 'meeting', description: 'Weekly team meeting', work_date: day })).status, 200);
  assert.equal((await log({ hours: 0.5, category: 'admin', customer_id: ids.customer, description: 'Contract paperwork', work_date: day })).status, 200);

  const mine = (await api(`/api/time-logs/mine?from=${day}&to=${day}`, { token: ids.tokenEnabled })).data.filter(r => !r.task_id && !r.visit_id);
  assert.deepEqual(mine.map(r => [r.category_label, Number(r.hours), r.customer_name, r.description]).sort(),
    [['Admin', 0.5, 'Acme Corp', 'Contract paperwork'], ['Meeting', 1.5, null, 'Weekly team meeting']]);
  assert.deepEqual((await api('/api/time-logs/categories', { token: ids.tokenEnabled })).data.map(c => c.label), ['Meeting', 'Admin', 'Internal work', 'Training', 'Other']);

  // Removing your own entry works for general time too.
  assert.equal((await api(`/api/time-logs/${mine[0].id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 200);
});
