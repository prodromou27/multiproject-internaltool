const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, teamA, teamB;

test.before(async () => {
  h = await harness.start({ '/api/activity-categories': require('../routes/activityCategories') });
  manager = await h.makeUser('Category Manager', 'manager');
  teamA = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('Category Team A')).lastInsertRowid;
  teamB = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('Category Team B')).lastInsertRowid;
});
test.after(() => h.stop());

test('category names are unique per team, not globally', async () => {
  const create = (name, team_id) => h.api('/api/activity-categories', { method: 'POST', token: manager.token, body: { name, team_id } });

  const globalOne = await create('Patch', null);
  assert.equal(globalOne.status, 200);
  assert.equal((await create('patch', null)).status, 409); // case-insensitive, same (global) scope

  const teamOne = await create('Patch', teamA);
  assert.equal(teamOne.status, 200); // same name, different scope: allowed
  assert.equal((await create('Patch', teamA)).status, 409); // same team, same name: rejected
  assert.equal((await create('Patch', teamB)).status, 200); // a third, independent scope

  assert.equal((await create('Invalid team', 999999)).status, 400);
  assert.equal((await create('', teamA)).status, 400);
});

test('GET lists every category with its team name attached, for any authenticated role', async () => {
  const engineer = await h.makeUser('Category Engineer', 'engineer');
  const list = await h.api('/api/activity-categories', { token: engineer.token });
  assert.equal(list.status, 200);
  const scoped = list.data.find(c => c.name === 'Patch' && c.team_id === teamA);
  assert.equal(scoped.team_name, 'Category Team A');
  const global = list.data.find(c => c.name === 'Patch' && c.team_id === null);
  assert.equal(global.team_name, null); // no team joined
});

test('PUT can move a category between teams, revalidating uniqueness in the new scope', async () => {
  const created = await h.api('/api/activity-categories', { method: 'POST', token: manager.token, body: { name: 'Firewall Review', team_id: teamA } });
  const id = created.data.id;
  // Moving it to global while a global category already has that exact name is rejected...
  await h.api('/api/activity-categories', { method: 'POST', token: manager.token, body: { name: 'Firewall Review', team_id: null } });
  assert.equal((await h.api(`/api/activity-categories/${id}`, { method: 'PUT', token: manager.token, body: { team_id: null } })).status, 409);
  // ...but moving it to the still-free teamB scope succeeds.
  assert.equal((await h.api(`/api/activity-categories/${id}`, { method: 'PUT', token: manager.token, body: { team_id: teamB } })).status, 200);
  assert.equal((await h.api(`/api/activity-categories/${id}`, { method: 'PUT', token: manager.token, body: { team_id: 999999 } })).status, 400);
});

test('only managers can create or edit categories', async () => {
  const engineer = await h.makeUser('Category Engineer 2', 'engineer');
  assert.equal((await h.api('/api/activity-categories', { method: 'POST', token: engineer.token, body: { name: 'X' } })).status, 403);
});
