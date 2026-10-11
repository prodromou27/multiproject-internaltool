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
