/* Route-level tests for the small reference-data routes that had none:
   technologies, statuses and the audit log. Each is short, but each guards
   something that matters — who may change it, what it refuses, and what it
   won't let you delete. */
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, engineer;

test.before(async () => {
  h = await harness.start({
    '/api/technologies': require('../routes/technologies'),
    '/api/statuses': require('../routes/statuses'),
    '/api/audit': require('../routes/audit'),
  });
  manager = await h.makeUser('Reference Manager', 'manager');
  engineer = await h.makeUser('Reference Engineer', 'engineer');
});
test.after(() => h.stop());

/* ── technologies ───────────────────────────────────────── */
test('technologies: anyone signed in can read the active list, only managers can change it', async () => {
  assert.equal((await h.api('/api/technologies')).status, 401);
  assert.equal((await h.api('/api/technologies', { token: engineer.token })).status, 200);
  const body = { name: 'Cisco ISE' };
  assert.equal((await h.api('/api/technologies', { method: 'POST', token: engineer.token, body })).status, 403);
  const created = await h.api('/api/technologies', { method: 'POST', token: manager.token, body });
  assert.equal(created.status, 200);
  const listed = await h.api('/api/technologies', { token: engineer.token });
  assert.ok(listed.data.some(row => row.id === created.data.id && row.name === 'Cisco ISE'));
});

test('technologies: names are required and unique ignoring case', async () => {
  assert.equal((await h.api('/api/technologies', { method: 'POST', token: manager.token, body: { name: '   ' } })).status, 400);
  await h.api('/api/technologies', { method: 'POST', token: manager.token, body: { name: 'Fortinet' } });
  const duplicate = await h.api('/api/technologies', { method: 'POST', token: manager.token, body: { name: 'FORTINET' } });
  assert.equal(duplicate.status, 409);
});

test('technologies: deactivating hides one from the list; deleting one in use is refused', async () => {
  const id = (await h.api('/api/technologies', { method: 'POST', token: manager.token, body: { name: 'Palo Alto' } })).data.id;
  assert.equal((await h.api(`/api/technologies/${id}`, { method: 'PUT', token: manager.token, body: { active: false } })).status, 200);
  assert.equal((await h.api('/api/technologies', { token: engineer.token })).data.some(row => row.id === id), false);
  assert.equal((await h.api('/api/technologies/not-a-number', { method: 'DELETE', token: manager.token })).status, 400);

  const inUse = (await h.api('/api/technologies', { method: 'POST', token: manager.token, body: { name: 'Juniper' } })).data.id;
  const customer = (await h.db.prepare("INSERT INTO customers (name) VALUES ('Tech Co')").run()).lastInsertRowid;
  const category = (await h.db.prepare("INSERT INTO activity_categories (name) VALUES ('Tech category')").run()).lastInsertRowid;
  const team = (await h.db.prepare("INSERT INTO teams (name) VALUES ('Tech team')").run()).lastInsertRowid;
  const activity = (await h.db.prepare('INSERT INTO service_activities (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run('TECH-1', customer, team, engineer.id, '2026-09-01', category, 'Uses Juniper', manager.id)).lastInsertRowid;
  await h.db.prepare('INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (?, ?)').run(activity, inUse);
  const refused = await h.api(`/api/technologies/${inUse}`, { method: 'DELETE', token: manager.token });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /deactivate it instead/);
  assert.equal((await h.api(`/api/technologies/${id}`, { method: 'DELETE', token: manager.token })).status, 200); // unused: fine
});

/* ── statuses ───────────────────────────────────────────── */
test('statuses: defaults are served until a manager saves a custom set, and the set is validated', async () => {
  assert.equal((await h.api('/api/statuses')).status, 401);
  const defaults = await h.api('/api/statuses', { token: engineer.token });
  assert.equal(defaults.status, 200);
  for (const key of ['project', 'task', 'visit', 'service_activity']) assert.ok(defaults.data[key].length > 0);
  assert.ok(defaults.data.task.some(status => status.value === 'closed' && status.is_terminal));

  assert.equal((await h.api('/api/statuses', { method: 'PUT', token: engineer.token, body: defaults.data })).status, 403);
  assert.equal((await h.api('/api/statuses', { method: 'PUT', token: manager.token, body: { project: [] } })).status, 400); // missing arrays
  const noLabel = { ...defaults.data, task: [{ value: 'open' }] };
  assert.equal((await h.api('/api/statuses', { method: 'PUT', token: manager.token, body: noLabel })).status, 400);

  const custom = { ...defaults.data, task: [{ value: 'triage', label: 'Triage', is_terminal: false }] };
  assert.equal((await h.api('/api/statuses', { method: 'PUT', token: manager.token, body: custom })).status, 200);
  const saved = await h.api('/api/statuses', { token: engineer.token });
  assert.deepEqual(saved.data.task.map(status => status.value), ['triage']);
});

/* ── audit log ──────────────────────────────────────────── */
test('audit log: manager-only, filterable, and the page size is capped', async () => {
  assert.equal((await h.api('/api/audit', { token: engineer.token })).status, 403);
  assert.equal((await h.api('/api/audit/users', { token: engineer.token })).status, 403);
  for (const [action, entity] of [['user_deactivated', 'user'], ['team_created', 'team'], ['team_created', 'team']]) {
    await h.db.prepare('INSERT INTO audit_log (user_id, user_name, user_role, entity_type, entity_id, action) VALUES (?,?,?,?,?,?)')
      .run(manager.id, 'Reference Manager', 'manager', entity, 1, action);
  }
  const all = await h.api('/api/audit', { token: manager.token });
  assert.equal(all.status, 200);
  assert.ok(all.data.total >= 3);
  const teams = await h.api('/api/audit?action=team_created', { token: manager.token });
  assert.ok(teams.data.rows.length >= 2 && teams.data.rows.every(row => row.action === 'team_created'));
  assert.equal(teams.data.total, teams.data.rows.length);
  // limit is clamped to a sane range rather than trusted
  assert.equal((await h.api('/api/audit?limit=1', { token: manager.token })).data.rows.length, 1);
  assert.ok((await h.api('/api/audit?limit=999999', { token: manager.token })).data.rows.length <= 500);
  assert.equal((await h.api('/api/audit?limit=-5', { token: manager.token })).status, 200);
  const users = await h.api('/api/audit/users', { token: manager.token });
  assert.ok(users.data.some(user => user.user_id === manager.id));
});
