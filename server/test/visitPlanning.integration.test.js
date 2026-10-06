const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');

// A fixed fortnight in the future: Monday 2027-03-01 to Sunday 2027-03-14.
const FROM = '2027-03-01', TO = '2027-03-14';

test('team availability shows visits, time off and weekends, and suggests the best engineers', async () => {
  const other = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Zoe Other', 'zoe.other@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  // Engineer Enabled serves the customer (its team); Zoe does not.
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, created_by) VALUES (?, ?, ?, ?)').run(ids.customer, 'Firewall check', '2027-03-02', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  assert.equal((await api('/api/visit-planning/time-off', { method: 'POST', token: ids.tokenManager, body: { user_id: ids.engineerEnabled, start_date: '2027-03-03', end_date: '2027-03-04', reason: 'Training' } })).status, 201);

  const res = await api(`/api/visit-planning/availability?from=${FROM}&to=${TO}&customer_id=${ids.customer}`, { token: ids.tokenManager });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const enabled = res.data.engineers.find(e => e.id === Number(ids.engineerEnabled));
  const zoe = res.data.engineers.find(e => e.id === Number(other));
  const cell = (engineer, date) => engineer.cells.find(c => c.date === date);
  assert.equal(enabled.serves_customer, true);
  assert.equal(zoe.serves_customer, false);
  assert.equal(cell(enabled, '2027-03-02').free, false, 'busy with a visit');
  assert.equal(cell(enabled, '2027-03-02').visits[0].title, 'Firewall check');
  assert.equal(cell(enabled, '2027-03-03').time_off.reason, 'Training');
  assert.equal(cell(enabled, '2027-03-06').free, false, 'Saturday');
  assert.equal(cell(enabled, '2027-03-01').free, true);
  assert.equal(res.data.days.find(d => d.date === '2027-03-07').weekend, true);

  const days = res.data.suggestions.map(s => s.date);
  assert.ok(!days.includes('2027-03-06') && !days.includes('2027-03-07'), 'no weekends');
  const tuesday = res.data.suggestions.find(s => s.date === '2027-03-02');
  if (tuesday) assert.ok(!tuesday.engineers.some(e => e.id === Number(ids.engineerEnabled)), 'not someone already on a visit');
  assert.equal(res.data.suggestions[0].engineers[0].serves_customer, true, 'engineers who serve the customer come first');

  // A week marked as 0 available hours in Workload makes the engineer unavailable.
  await db.prepare('INSERT INTO workload_availability (user_id, week_start, available_hours) VALUES (?, ?, 0)').run(ids.engineerEnabled, '2027-03-08');
  const later = (await api(`/api/visit-planning/availability?from=${FROM}&to=${TO}`, { token: ids.tokenManager })).data;
  assert.equal(later.engineers.find(e => e.id === Number(ids.engineerEnabled)).cells.find(c => c.date === '2027-03-09').no_hours, true);
});

test('only managers and planners plan; engineers record only their own time off', async () => {
  const planner = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Pat Planner', 'pat.planner@test.local', bcrypt.hashSync('pw', 4), 'planner')).lastInsertRowid;
  const plannerToken = signJwt({ id: planner });
  assert.equal((await api(`/api/visit-planning/availability?from=${FROM}&to=${TO}`, { token: plannerToken })).status, 200);
  assert.equal((await api(`/api/visit-planning/availability?from=${FROM}&to=${TO}`, { token: ids.tokenEnabled })).status, 403);
  for (const query of ['from=bad&to=2027-03-01', 'from=2027-03-10&to=2027-03-01', 'from=2027-01-01&to=2027-06-01', `from=${FROM}&to=${TO}&team_id=x`])
    assert.equal((await api(`/api/visit-planning/availability?${query}`, { token: ids.tokenManager })).status, 400, query);

  // An engineer's own time off is theirs whatever user_id they send.
  const mine = await api('/api/visit-planning/time-off', { method: 'POST', token: ids.tokenDisabled, body: { user_id: ids.engineerEnabled, start_date: '2027-04-01', end_date: '2027-04-02' } });
  assert.equal(mine.status, 201);
  assert.equal(Number((await db.prepare('SELECT user_id FROM engineer_time_off WHERE id = ?').get(mine.data.id)).user_id), Number(ids.engineerDisabled));
  const managersEntry = (await db.prepare("SELECT id FROM engineer_time_off WHERE reason = 'Training'").get()).id;
  assert.equal((await api(`/api/visit-planning/time-off/${managersEntry}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 403, "not someone else's");
  assert.equal((await api(`/api/visit-planning/time-off/${mine.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 200);
  assert.equal((await api('/api/visit-planning/time-off', { method: 'POST', token: ids.tokenManager, body: { user_id: ids.engineerEnabled, start_date: '2027-04-05', end_date: '2027-04-01' } })).status, 400);
  const list = (await api(`/api/visit-planning/time-off?from=2027-01-01&to=2027-12-31`, { token: ids.tokenDisabled })).data.rows;
  assert.ok(list.every(row => Number(row.user_id) === Number(ids.engineerDisabled)), 'engineers see only their own');
});
