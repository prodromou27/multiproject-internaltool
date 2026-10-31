const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { buckets } = require('../insights');

test('periods group by week up to 90 days and by month beyond', () => {
  const weeks = buckets('2026-07-14', '2026-10-11', 'week');
  assert.equal(weeks[0].key, '2026-07-13', 'weeks start on Monday');
  assert.equal(weeks.at(-1).key, '2026-10-05');
  assert.deepEqual(buckets('2025-10-12', '2026-10-11', 'month').map(b => b.key).slice(0, 3), ['2025-10', '2025-11', '2025-12']);
});

test('insights add up the work, tasks on time and late, visits, and what needs attention', async () => {
  const today = appTime.today(), day = n => appTime.addDays(today, n);
  const activity = async (ref, date, minutes, status = 'completed') => db.prepare(`INSERT INTO service_activities
    (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, created_by, duration_minutes, status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(ref, ids.customer, ids.teamEnabled, ids.engineerEnabled, date, ids.category, ref, ids.manager, minutes, status);
  await activity('INS-1', day(-1), 90); await activity('INS-2', day(-10), 30); await activity('INS-3', day(-2), 600, 'cancelled'); await activity('INS-OLD', day(-200), 60);
  const task = (title, extra) => db.prepare(`INSERT INTO tasks (title, status, customer_id, assigned_to, created_by, deadline, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(title, extra.status, ids.customer, ids.engineerEnabled, ids.manager, extra.deadline || null, extra.completed_at || null);
  await task('On time', { status: 'completed', deadline: day(-3), completed_at: `${day(-4)} 10:00:00` });
  await task('Late', { status: 'completed', deadline: day(-8), completed_at: `${day(-5)} 10:00:00` });
  await task('Overdue', { status: 'open', deadline: day(-1) });
  await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Check', ?, 'completed', ?)").run(ids.customer, day(-6), ids.manager);
  await api(`/api/customers/${ids.customer}/contracts`, { method: 'POST', token: ids.tokenManager, body: { reference: 'INS-C', start_date: day(-300), end_date: day(20) } });

  const res = await api('/api/insights?days=30', { token: ids.tokenManager });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const k = res.data.kpis;
  assert.deepEqual([k.hours, k.activities], [2, 2], 'cancelled and older work left out');
  assert.deepEqual([k.tasks_done, k.on_time_rate, k.overdue_tasks], [2, 50, 1]);
  assert.equal(k.visits_done, 1);
  assert.equal(k.contracts_ending, 1);
  assert.equal(res.data.attention.contracts_ending[0].reference, 'INS-C');
  assert.equal(res.data.series.reduce((sum, b) => sum + b.hours, 0), 2);
  assert.equal(res.data.series.reduce((sum, b) => sum + b.tasks_late, 0), 1);
  assert.deepEqual(res.data.hours_by_customer.map(c => [c.name, c.hours]), [['Acme Corp', 2]]);
  const engineer = res.data.engineers.find(e => e.id === Number(ids.engineerEnabled));
  assert.deepEqual([engineer.hours, engineer.done_tasks, engineer.overdue_tasks], [2, 2, 1]);
  assert.equal(res.data.period.unit, 'week');
  assert.equal((await api('/api/insights?days=365', { token: ids.tokenManager })).data.period.unit, 'month');
});

test('insights are for people with reporting access, and the period is checked', async () => {
  assert.equal((await api('/api/insights', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api('/api/insights?days=45', { token: ids.tokenManager })).status, 400);
});

test('insights filter by customer, team and engineer', async () => {
  const q = async params => (await api(`/api/insights?days=30&${new URLSearchParams(params)}`, { token: ids.tokenManager })).data;
  const all = await q({});
  assert.ok(all.kpis.hours > 0, 'the earlier test logged work');
  const other = await q({ customer_id: ids.customerUnassigned });
  assert.deepEqual([other.kpis.hours, other.kpis.tasks_done, other.kpis.contracts_ending], [0, 0, 0], 'another customer has none of it');
  const mine = await q({ engineer_id: ids.engineerEnabled });
  assert.deepEqual([mine.kpis.hours, mine.kpis.tasks_done], [all.kpis.hours, all.kpis.tasks_done]);
  assert.deepEqual(mine.engineers.map(e => e.id), [Number(ids.engineerEnabled)]);
  const someoneElse = await q({ engineer_id: ids.engineerDisabled });
  assert.deepEqual([someoneElse.kpis.hours, someoneElse.kpis.tasks_done], [0, 0]);
  const team = await q({ team_id: ids.teamEnabled });
  assert.equal(team.kpis.hours, all.kpis.hours, 'the team is its members');
  assert.ok(!team.engineers.some(e => e.id === Number(ids.engineerDisabled)), 'only the team\'s engineers');
  assert.equal((await api('/api/insights?customer_id=abc', { token: ids.tokenManager })).status, 400);
});

test('the tasks dashboard counts open, overdue, waiting and done work, by person and customer, with filters', async () => {
  const today = appTime.today(), day = n => appTime.addDays(today, n);
  const add = async (title, values) => (await db.prepare(`INSERT INTO tasks (title, status, customer_id, assigned_to, created_by, deadline, completed_at, created_at, updated_at, pending_from_customer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).all(title, values.status, values.customer ?? ids.customer, values.assigned_to ?? ids.engineerEnabled, ids.manager,
    values.deadline || null, values.completed_at || null, values.created_at || `${day(-3)} 09:00:00`, values.updated_at || `${day(-1)} 09:00:00`, values.reason || null))[0].id;
  const late = await add('TD overdue', { status: 'open', deadline: day(-4) });
  await add('TD on time', { status: 'completed', deadline: day(-1), completed_at: `${day(-2)} 10:00:00`, created_at: `${day(-6)} 10:00:00` });
  await add('TD late', { status: 'completed', deadline: day(-9), completed_at: `${day(-5)} 10:00:00`, created_at: `${day(-9)} 10:00:00` });
  const waiting = await add('TD waiting', { status: 'waiting_customer', updated_at: `${day(-12)} 09:00:00`, reason: 'Credentials' });
  await add('TD elsewhere', { status: 'open', customer: ids.customerUnassigned, assigned_to: ids.engineerDisabled, deadline: day(-2) });
  await db.prepare('INSERT INTO task_subtasks (task_id, title, assigned_to, due_date) VALUES (?, ?, ?, ?)').run(late, 'TD sub', ids.engineerEnabled, day(-1));

  const get = async query => (await api(`/api/insights/tasks?days=30&${new URLSearchParams(query)}`, { token: ids.tokenManager })).data;
  const mine = await get({ customer_id: ids.customer, engineer_id: ids.engineerEnabled });
  const k = mine.kpis;
  assert.ok(k.open >= 2 && k.overdue >= 1 && k.waiting >= 1 && k.completed >= 2, JSON.stringify(k));
  assert.ok(k.overdue_subtasks >= 1);
  assert.ok(mine.overdue.some(t => t.id === Number(late) && t.days_overdue === 4 && t.customer_name === 'Acme Corp'));
  assert.ok(mine.stuck.some(t => t.id === Number(waiting) && t.waiting_days === 12 && t.reason === 'Credentials'));
  assert.deepEqual(mine.people.map(p => p.name), ['Engineer Enabled']);
  assert.equal(mine.series.reduce((sum, b) => sum + b.on_time + b.late, 0), k.completed);
  assert.ok(!mine.overdue.some(t => t.title === 'TD elsewhere'), 'other customer filtered out');
  const all = await get({});
  assert.ok(all.overdue.some(t => t.title === 'TD elsewhere'));
  assert.ok(all.by_customer.some(c => c.name === 'Other Corp'));
  assert.equal((await api('/api/insights/tasks', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api('/api/insights/tasks?days=7', { token: ids.tokenManager })).status, 400);
});
