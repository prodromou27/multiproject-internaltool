// An engineer from another team can be added to a customer individually, alongside its teams.
const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');

test('an engineer from another team, added to a customer, works with it like its team; the team keeps working too', async () => {
  // A second team with activity tracking, and an engineer in it (not in the customer's team).
  const team = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 1)').run('Network Team')).lastInsertRowid;
  const engineer = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Nick Network', 'nick.network@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(team, engineer);
  const token = signJwt({ id: engineer });
  const log = (who, title) => api('/api/service-activities', { method: 'POST', token: who, body: { customer_id: ids.customer, activity_date: '2026-10-01', category_id: ids.category, title } });
  const metaCustomers = async who => (await api('/api/service-activities/meta', { token: who })).data.customers.map(c => Number(c.id));

  assert.equal((await log(token, 'Before')).status, 403, 'not their customer yet');
  assert.ok(!(await metaCustomers(token)).includes(Number(ids.customer)));
  assert.equal((await api(`/api/customers/${ids.customer}`, { token })).status, 403);

  const set = user_ids => api(`/api/customers/${ids.customer}/engineers`, { method: 'PUT', token: ids.tokenManager, body: { user_ids } });
  assert.equal((await set([ids.manager])).status, 400, 'engineers only');
  assert.equal((await api(`/api/customers/${ids.customer}/engineers`, { method: 'PUT', token: ids.tokenEnabled, body: { user_ids: [engineer] } })).status, 403);
  assert.equal((await set([Number(engineer)])).status, 200);
  assert.deepEqual((await api(`/api/customers/${ids.customer}/engineers`, { token: ids.tokenManager })).data.map(e => e.name), ['Nick Network']);

  assert.ok((await metaCustomers(token)).includes(Number(ids.customer)), 'offered when logging');
  assert.equal((await api(`/api/customers/${ids.customer}`, { token })).status, 200, 'sees the customer');
  const logged = await log(token, 'Checked the core switches');
  assert.equal(logged.status, 200, JSON.stringify(logged.data));
  assert.equal(Number((await db.prepare('SELECT team_id FROM service_activities WHERE id = ?').get(logged.data.id)).team_id), Number(team), 'under their own team');

  // The customer's own team is not restricted by the addition.
  assert.equal((await log(ids.tokenEnabled, 'Team member still logs')).status, 200);
  assert.ok((await metaCustomers(ids.tokenEnabled)).includes(Number(ids.customer)));

  assert.equal((await set([])).status, 200);
  assert.equal((await log(token, 'After removal')).status, 403);
});
