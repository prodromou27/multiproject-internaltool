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
