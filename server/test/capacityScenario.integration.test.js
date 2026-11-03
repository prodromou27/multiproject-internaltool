// What-if capacity planning (enhancement E05).
const { test, assert, api, db, ids } = require('./lib/activityFixture');
// The live plan's query is beyond pg-mem; these run on PostgreSQL (CI).
const pgOnly = { skip: !process.env.TEST_DATABASE_URL && 'needs PostgreSQL' };

// Monday 1 March 2027: weeks of 1, 8, 15 and 22 March.
const asOf = '2027-03-01';
const scenario = (changes, token = ids.tokenManager) => api('/api/workload/planning/scenario', { method: 'POST', token, body: { as_of: asOf, changes } });
const week = (result, userId, start) => result.data.engineers.find(e => e.id === userId).weeks.find(w => w.start === start);

let tech;
test('leave and new work are laid over the live plan without saving anything', pgOnly, async () => {
  await db.prepare('INSERT INTO workload_availability (user_id, week_start, available_hours) VALUES (?, ?, 40), (?, ?, 40)').run(ids.engineerEnabled, '2027-03-01', ids.engineerEnabled, '2027-03-08');
  const task = (await db.prepare("INSERT INTO tasks (title, status, assigned_to, deadline, created_by) VALUES ('Live work', 'in_progress', ?, '2027-03-03', ?) RETURNING id").get(ids.engineerEnabled, ids.manager)).id;
  await db.prepare('INSERT INTO workload_estimates (task_id, remaining_hours) VALUES (?, 10)').run(task);
  tech = (await db.prepare("INSERT INTO technologies (name) VALUES ('Scenario Tech') RETURNING id").get()).id;
  await db.prepare('INSERT INTO engineer_skills (user_id, technology_id, level) VALUES (?, ?, 3)').run(ids.engineerEnabled, tech);
  const before = await db.prepare('SELECT COUNT(*) AS n FROM workload_availability').get();

  assert.equal((await scenario([{ type: 'leave', user_id: ids.engineerEnabled, from: asOf, to: asOf }], ids.tokenEnabled)).status, 403);
  const res = await scenario([
    { type: 'leave', user_id: ids.engineerEnabled, from: '2027-03-01', to: '2027-03-02' },          // 2 of 5 working days
    { type: 'work', user_id: ids.engineerEnabled, hours: 20, from: '2027-03-08', to: '2027-03-19', title: 'New firewall project', technology_id: tech },
  ]);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.saved, false);
  const first = week(res, ids.engineerEnabled, '2027-03-01');
  assert.equal(first.live.available_hours, 40);
  assert.equal(first.scenario.available_hours, 24, 'two days of leave out of five');
  assert.equal(first.scenario.estimated_hours, first.live.estimated_hours);
  const second = week(res, ids.engineerEnabled, '2027-03-08');
  assert.equal(second.scenario.estimated_hours - second.live.estimated_hours, 10, 'half the new work falls in its first week');
  assert.equal(second.scenario.capacity_percent, Math.round(second.scenario.estimated_hours / 40 * 1000) / 10);
  assert.equal(res.data.engineers.find(e => e.id === ids.engineerEnabled).skill_levels[tech], 3, "the engineer's level on the technology");
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM workload_availability').get()).n, before.n, 'nothing saved');
});

test('unknown availability stays unknown, and a week with no hours says so instead of a percentage', pgOnly, async () => {
  const res = await scenario([{ type: 'leave', user_id: ids.engineerEnabled, from: '2027-03-08', to: '2027-03-12' }, { type: 'work', user_id: ids.engineerEnabled, hours: 5, from: '2027-03-15', to: '2027-03-15' }]);
  const full = week(res, ids.engineerEnabled, '2027-03-08');
  assert.deepEqual([full.scenario.available_hours, full.scenario.capacity_percent, full.scenario.state], [0, null, 'no_hours']);
  const unset = week(res, ids.engineerEnabled, '2027-03-15');
  assert.deepEqual([unset.live.available_hours, unset.scenario.available_hours, unset.scenario.state], [null, null, 'availability_unknown']);
  assert.equal(unset.scenario.capacity_percent, null, 'not shown as 0% or as overloaded');
});

test('changes are checked', pgOnly, async () => {
  for (const change of [{ type: 'holiday', user_id: ids.engineerEnabled, from: asOf, to: asOf }, { type: 'leave', user_id: ids.manager, from: asOf, to: asOf },
    { type: 'leave', user_id: ids.engineerEnabled, from: '2027-03-05', to: '2027-03-01' }, { type: 'work', user_id: ids.engineerEnabled, from: asOf, to: asOf, hours: 0 }])
    assert.equal((await scenario([change])).status, 400, JSON.stringify(change));
  assert.equal((await scenario([])).status, 400);
});
