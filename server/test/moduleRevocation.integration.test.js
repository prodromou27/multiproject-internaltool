/* F02: revoking a module closes every route that shows its data, not only the
   module's own pages (time logs, attachments, milestones, calendar, iCal, search). */
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');

const revoke = (key, allowed = 0) => db.prepare(`INSERT INTO user_permission_overrides (user_id, permission_key, allowed) VALUES (?, ?, ?)
  ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = excluded.allowed`).run(ids.engineerEnabled, key, allowed);
const as = (path) => api(path, { token: ids.tokenEnabled });

test('a revoked module is closed on its related routes too', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Revocation project', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const task = (await db.prepare("INSERT INTO tasks (project_id, title, assigned_to, created_by, deadline) VALUES (?, 'Revocation task', ?, ?, ?)").run(project, ids.engineerEnabled, ids.manager, '2026-10-20')).lastInsertRowid;

  // Allowed first.
  assert.equal((await as(`/api/time-logs?task_id=${task}`)).status, 200);
  assert.equal((await as(`/api/attachments/${project}`)).status, 200);

  await revoke('tasks.access');
  assert.equal((await as('/api/tasks')).status, 403);
  assert.equal((await as(`/api/time-logs?task_id=${task}`)).status, 403);
  assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenEnabled, body: { task_id: task, hours: 1 } })).status, 403);
  const calendar = (await as('/api/calendar?month=2026-10')).data;
  assert.ok(!JSON.stringify(calendar).includes('Revocation task'), 'no tasks on the calendar');
  assert.deepEqual((await as('/api/search?q=Revocation')).data.tasks, []);

  await revoke('projects.access');
  assert.equal((await as(`/api/attachments/${project}`)).status, 403);
  assert.equal((await as(`/api/milestones?project_id=${project}`)).status, 403);
  assert.deepEqual((await as('/api/search?q=Revocation')).data.projects, []);

  // The calendar feed is checked when fetched.
  const token = 'feed-' + Date.now();
  await db.prepare('UPDATE users SET ical_token_hash = ? WHERE id = ?').run(require('crypto').createHash('sha256').update(token).digest('hex'), ids.engineerEnabled);
  const feed = await (await fetch(`${suiteFixture.baseUrl}/api/calendar/ical?token=${token}`)).text();
  assert.ok(!feed.includes('Revocation task'), 'no revoked tasks in the iCal feed');

  // Giving the modules back opens them again.
  await revoke('tasks.access', 1); await revoke('projects.access', 1);
  assert.equal((await as(`/api/time-logs?task_id=${task}`)).status, 200);
  assert.equal((await as(`/api/attachments/${project}`)).status, 200);
});

test('custom roles: a named role on a base role with its own permissions', async () => {
  const { bcrypt, signJwt } = suiteFixture;
  const person = (await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Lead Person', 'lead.person@test.local', ?, 'engineer')").run(bcrypt.hashSync('x', 4))).lastInsertRowid;
  const tokenOf = async () => signJwt({ id: person, token_version: (await db.prepare('SELECT token_version FROM users WHERE id = ?').get(person)).token_version });
  const asManager = (path, method = 'GET', body) => api(path, { method, token: ids.tokenManager, body });
  const effective = async () => (await api('/api/auth/permissions', { token: await tokenOf() })).data.permissions;

  // Checked: a name that is not a built-in role, a base role, and only permissions the base may hold.
  assert.equal((await asManager('/api/permissions/custom-roles', 'POST', { name: 'Engineer', base_role: 'engineer' })).status, 400);
  assert.equal((await asManager('/api/permissions/custom-roles', 'POST', { name: 'Lead', base_role: 'boss' })).status, 400);
  assert.equal((await asManager('/api/permissions/custom-roles', 'POST', { name: 'Lead', base_role: 'engineer', permissions: { 'reports.access': true } })).status, 400);
  assert.equal((await api('/api/permissions/custom-roles', { method: 'POST', token: ids.tokenEnabled, body: { name: 'Lead', base_role: 'engineer' } })).status, 403, 'managers only');

  const made = await asManager('/api/permissions/custom-roles', 'POST', { name: 'Field lead', base_role: 'engineer', description: 'Engineers without the activity log', permissions: { 'service_activities.access': false } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.permissions['service_activities.access'], false);
  assert.equal(made.data.permissions['tasks.access'], true, 'the rest start from the base role');
  assert.equal((await asManager('/api/permissions/custom-roles', 'POST', { name: 'Field lead', base_role: 'engineer' })).status, 409, 'names are unique');

  // Given to a person from Settings → Users: their role is the base role.
  assert.equal((await asManager(`/api/admin/users/${person}`, 'PUT', { custom_role_id: made.data.id })).status, 200);
  const row = await db.prepare('SELECT role, custom_role_id FROM users WHERE id = ?').get(person);
  assert.deepEqual([row.role, Number(row.custom_role_id)], ['engineer', Number(made.data.id)]);
  assert.equal((await effective())['service_activities.access'], false);
  assert.equal((await api('/api/service-activities', { token: await tokenOf() })).status, 403);
  const listed = await db.prepare('SELECT cr.name FROM users u JOIN custom_roles cr ON cr.id = u.custom_role_id WHERE u.id = ?').get(person);
  assert.equal(listed.name, 'Field lead');
  assert.equal((await asManager('/api/permissions')).data.custom_roles.find(role => role.name === 'Field lead').members, 1);

  // Changing the role changes it for everyone who has it; a personal exception still wins.
  const changed = await asManager(`/api/permissions/custom-roles/${made.data.id}`, 'PUT', { name: 'Field lead', version: made.data.version, permissions: { 'service_activities.access': true, 'visits.access': false } });
  assert.equal(changed.status, 200);
  assert.equal((await asManager(`/api/permissions/custom-roles/${made.data.id}`, 'PUT', { name: 'Field lead', version: made.data.version })).status, 409, 'stale version');
  assert.equal((await asManager(`/api/permissions/custom-roles/${made.data.id}`, 'PUT', { name: 'Field lead', base_role: 'manager', version: changed.data.version })).status, 400, 'the base role stays');
  let now = await effective();
  assert.deepEqual([now['service_activities.access'], now['visits.access']], [true, false]);
  await db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, allowed) VALUES (?, ?, 1)').run(person, 'visits.access');
  assert.equal((await effective())['visits.access'], true);
  const { usersWithPermission } = require('../permissions');
  assert.ok((await usersWithPermission('service_activities.access')).some(user => Number(user.id) === Number(person)));

  // A plain role clears the custom role; deleting a role leaves its people on the base role.
  assert.equal((await asManager(`/api/admin/users/${person}`, 'PUT', { custom_role_id: made.data.id })).status, 200);
  assert.equal((await asManager(`/api/permissions/custom-roles/${made.data.id}`, 'DELETE')).status, 200);
  const after = await db.prepare('SELECT role, custom_role_id FROM users WHERE id = ?').get(person);
  assert.deepEqual([after.role, after.custom_role_id], ['engineer', null]);
  now = await effective();
  assert.equal(now['service_activities.access'], true, 'back to the engineer defaults');
});
