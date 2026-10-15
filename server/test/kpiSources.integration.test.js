const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { periodRange } = require('../kpiDefinitions');

const today = appTime.today();
const day = n => appTime.addDays(today, -n);
const base = { description: '', category: 'People', calculation_config: {}, direction: 'higher', enabled: true, display_order: 0, visualization_type: 'number' };
const create = async body => api('/api/kpis/definitions', { method: 'POST', token: ids.tokenManager, body: { ...base, ...body } });
const preview = async body => api('/api/kpis/definitions/preview', { method: 'POST', token: ids.tokenManager, body: { ...base, ...body } });

test('periods end today in the organisation\'s time zone', () => {
  assert.deepEqual(periodRange('month', '2026-10-07'), { from: '2026-10-01', to: '2026-10-07', label: 'This month' });
  assert.equal(periodRange('quarter', '2026-11-20').from, '2026-10-01');
  assert.equal(periodRange('last_30', '2026-10-07').from, '2026-09-08');
});

test('KPIs measure tickets, tasks and visits for an engineer, a team or a customer, and per engineer', async () => {
  const nick = Number((await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Nick KPI', 'nick.kpi@test.local', ?, 'engineer')").run(bcrypt.hashSync('pw', 4))).lastInsertRowid);
  const maria = Number(ids.engineerEnabled);
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(ids.teamEnabled, nick);
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(ids.teamEnabled, maria);
  // engineer_tickets has no id column, so no RETURNING: exec.
  const ticket = (id, user, resolvedDaysAgo, tookDays) => db.exec(`INSERT INTO engineer_tickets (external_ticket_id, user_id, queue_name, subject, normalized_status, status_group, created_at_external, resolved_at_external)
    VALUES ('${id}', ${user}, 'Support', 'T', 'Resolved', 'closed', '${day(resolvedDaysAgo + tookDays)}T09:00:00Z', '${day(resolvedDaysAgo)}T09:00:00Z')`);
  await ticket(9101, nick, 1, 2); await ticket(9102, nick, 2, 4); await ticket(9103, maria, 1, 1); await ticket(9104, nick, 200, 1);
  await db.prepare("INSERT INTO tasks (title, status, assigned_to, created_by, deadline, updated_at) VALUES ('On time', 'completed', ?, ?, ?, ?)").run(nick, ids.manager, day(0), `${day(1)} 10:00:00`);
  await db.prepare("INSERT INTO tasks (title, status, assigned_to, created_by, deadline, updated_at) VALUES ('Late', 'completed', ?, ?, ?, ?)").run(nick, ids.manager, day(5), `${day(1)} 10:00:00`);

  // One engineer: tickets resolved in the last 30 days.
  const one = await preview({ name: 'Nick tickets', data_source: 'tickets_resolved', scope_type: 'engineer', user_id: nick, calculation_config: { period: 'last_30' }, target_value: 2, warning_threshold: 1, critical_threshold: 0 });
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.equal(one.data.value, 2);
  assert.equal(one.data.status, 'healthy');
  assert.equal(one.data.period.label, 'Last 30 days');
  assert.equal((await preview({ name: 'Days', data_source: 'ticket_resolution_days', scope_type: 'engineer', user_id: nick, direction: 'lower', calculation_config: { period: 'last_30' }, target_value: 2, warning_threshold: 3, critical_threshold: 5 })).data.value, 3);
  assert.equal((await preview({ name: 'On time', data_source: 'tasks_on_time', scope_type: 'engineer', user_id: nick, calculation_config: { period: 'last_30' }, target_value: 90, warning_threshold: 75, critical_threshold: 50 })).data.value, 50);

  // The team, per engineer: each against the same target.
  const team = await preview({ name: 'Team tickets', data_source: 'tickets_resolved', scope_type: 'team', team_id: ids.teamEnabled, calculation_config: { period: 'last_30', per_engineer: true }, target_value: 2, warning_threshold: 2, critical_threshold: 0 });
  assert.equal(team.status, 200, JSON.stringify(team.data));
  const byName = Object.fromEntries(team.data.breakdown.map(row => [row.user_id, row]));
  assert.deepEqual([byName[nick].value, byName[nick].status, byName[maria].value, byName[maria].status], [2, 'healthy', 1, 'warning']);
  assert.equal(team.data.facts.meeting_target, 1);

  // Not every source fits every scope.
  assert.equal((await preview({ name: 'x', data_source: 'time_logged', scope_type: 'customer', customer_id: ids.customer, target_value: 1, warning_threshold: 1, critical_threshold: 0 })).status, 400);
  assert.equal((await preview({ name: 'x', data_source: 'tickets_resolved', scope_type: 'engineer', target_value: 1, warning_threshold: 1, critical_threshold: 0 })).status, 400, 'engineer required');
  assert.equal((await preview({ name: 'x', data_source: 'project_completion', scope_type: 'organization', calculation_config: { per_engineer: true }, target_value: 1, warning_threshold: 1, critical_threshold: 0 })).status, 400);
  assert.equal((await preview({ name: 'x', data_source: 'tickets_resolved', scope_type: 'organization', calculation_config: { period: 'fortnight' }, target_value: 1, warning_threshold: 1, critical_threshold: 0 })).status, 400);
});

test('managers record trainings and certifications, and the KPI counts them per engineer', async () => {
  const made = await create({ name: 'Trainings completed', category: 'Development', data_source: 'records', scope_type: 'team', team_id: ids.teamEnabled,
    calculation_config: { period: 'year', per_engineer: true, aggregate: 'count', unit: 'trainings' }, target_value: 2, warning_threshold: 1, critical_threshold: 0 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id, maria = Number(ids.engineerEnabled);
  for (const note of ['Fortinet NSE4', 'Microsoft AZ-104'])
    assert.equal((await api(`/api/kpis/definitions/${id}/records`, { method: 'POST', token: ids.tokenManager, body: { user_id: maria, record_date: day(3), note } })).status, 201);
  assert.equal((await api(`/api/kpis/definitions/${id}/records`, { method: 'POST', token: ids.tokenManager, body: { user_id: maria, record_date: 'yesterday' } })).status, 400);
  assert.equal((await api(`/api/kpis/definitions/${id}/records`, { method: 'POST', token: ids.tokenEnabled, body: { user_id: maria, record_date: day(1) } })).status, 403);
  const records = await api(`/api/kpis/definitions/${id}/records`, { token: ids.tokenManager });
  assert.deepEqual(records.data.rows.map(row => row.note).sort(), ['Fortinet NSE4', 'Microsoft AZ-104']);

  const scorecard = await api('/api/kpis/scorecard', { token: ids.tokenManager });
  assert.equal(scorecard.status, 200, JSON.stringify(scorecard.data));
  const row = scorecard.data.rows.find(r => r.id === id);
  assert.equal(row.breakdown.find(b => b.user_id === maria).value, 2);
  assert.equal(row.breakdown.find(b => b.user_id === maria).status, 'healthy');
  assert.equal(row.period.label, 'This year');

  assert.equal((await api(`/api/kpis/records/${records.data.rows[0].id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await api('/api/kpis/scorecard', { token: ids.tokenManager })).data.rows.find(r => r.id === id).breakdown.find(b => b.user_id === maria).value, 1);
  const other = await create({ name: 'Hours', data_source: 'service_hours', scope_type: 'organization', calculation_config: { period: 'month' }, target_value: 1, warning_threshold: 1, critical_threshold: 0 });
  assert.equal((await api(`/api/kpis/definitions/${other.data.id}/records`, { token: ids.tokenManager })).status, 400, 'only for recorded-entry KPIs');
});

test('every enabled KPI gets one value a day in its history', async () => {
  const { snapshotAll } = require('../kpiSnapshots');
  const first = await snapshotAll();
  assert.ok(first.recorded >= 1);
  assert.equal((await snapshotAll()).recorded, 0, 'once a day');
  const values = await db.prepare('SELECT COUNT(*) AS n FROM kpi_values WHERE calculated_by IS NULL AND period_end=?').get(today);
  assert.equal(Number(values.n), first.recorded);
});
