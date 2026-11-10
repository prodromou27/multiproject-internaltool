const { test, assert, api, db, ids } = require('./lib/activityFixture');

test('a team can have many members at once; duplicates are merged and unknown people refused', async () => {
  const team = (await db.prepare("INSERT INTO teams (name, service_activity_enabled) VALUES ('Many members', 1)").run()).lastInsertRowid;
  const path = `/api/teams/${team}/members`;
  const people = [ids.engineerEnabled, ids.engineerDisabled, ids.planner, ids.manager];
  const saved = await api(path, { method: 'PUT', token: ids.tokenManager, body: { user_ids: [...people, ids.planner] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const members = (await db.prepare('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY user_id').all(team)).map(row => Number(row.user_id));
  assert.deepEqual(members, [...people].sort((a, b) => a - b));
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { user_ids: [ids.engineerEnabled, 999999] } })).status, 400);
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { user_ids: ['1'] } })).status, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team)).n, 4, 'a refused save changes nothing');
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenManager, body: { user_ids: [] } })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team)).n, 0);
  assert.equal((await api(path, { method: 'PUT', token: ids.tokenEnabled, body: { user_ids: [ids.engineerEnabled] } })).status, 403);
});
