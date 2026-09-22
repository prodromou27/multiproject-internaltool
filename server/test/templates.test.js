const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, engineer, activeEngineer, customer;

// GET /api/templates uses a correlated subquery (task_count per template) that
// pg-mem cannot execute; it runs on the real database in CI via TEST_DATABASE_URL
// (see server/test/notificationsSearch.integration.test.js for the same pattern).
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem lacks correlated subqueries)' };

test.before(async () => {
  h = await harness.start({ '/api/templates': require('../routes/templates') });
  manager = await h.makeUser('Template Manager', 'manager');
  engineer = await h.makeUser('Template Engineer', 'engineer');
  activeEngineer = await h.makeUser('Template Active Engineer', 'engineer');
  customer = (await h.db.prepare("INSERT INTO customers (name, active) VALUES ('Template Co', 1)").run()).lastInsertRowid;
});
test.after(() => h.stop());

test('template CRUD is manager-only', async () => {
  const body = { name: 'Onboarding', description: 'Standard onboarding' };
  assert.equal((await h.api('/api/templates', { method: 'POST', token: engineer.token, body })).status, 403);
  assert.equal((await h.api('/api/templates', { token: engineer.token })).status, 403);

  const created = await h.api('/api/templates', { method: 'POST', token: manager.token, body });
  assert.equal(created.status, 200);
  const id = created.data.id;

  const single = await h.api(`/api/templates/${id}`, { token: manager.token });
  assert.equal(single.data.name, 'Onboarding');
  assert.deepEqual(single.data.tasks, []);

  assert.equal((await h.api('/api/templates', { method: 'POST', token: manager.token, body: { name: '  ' } })).status, 400);
});

test('the template list includes each template\'s task count', realDb, async () => {
  const created = await h.api('/api/templates', { method: 'POST', token: manager.token, body: { name: 'List count check' } });
  const list = await h.api('/api/templates', { token: manager.token });
  assert.ok(list.data.some(t => t.id === created.data.id && t.task_count === 0));
  await h.api(`/api/templates/${created.data.id}/tasks`, { method: 'POST', token: manager.token, body: { title: 'A task' } });
  const after = await h.api('/api/templates', { token: manager.token });
  assert.equal(after.data.find(t => t.id === created.data.id).task_count, 1);
});

test('a missing template returns 404 on GET but writes silently no-op', async () => {
  assert.equal((await h.api('/api/templates/99999999', { token: manager.token })).status, 404);
  // PUT/DELETE on a nonexistent id are not guarded by an existence check —
  // documenting the current (silent-success) behavior rather than assuming otherwise.
  assert.equal((await h.api('/api/templates/99999999', { method: 'PUT', token: manager.token, body: { name: 'x' } })).status, 200);
  assert.equal((await h.api('/api/templates/99999999', { method: 'DELETE', token: manager.token })).status, 200);
});

test('template tasks are scoped to their template and support ordering', async () => {
  const tpl = (await h.api('/api/templates', { method: 'POST', token: manager.token, body: { name: 'Task scoping' } })).data.id;
  const other = (await h.api('/api/templates', { method: 'POST', token: manager.token, body: { name: 'Other template' } })).data.id;

  assert.equal((await h.api(`/api/templates/${tpl}/tasks`, { method: 'POST', token: manager.token, body: { title: '' } })).status, 400);
  const t1 = (await h.api(`/api/templates/${tpl}/tasks`, { method: 'POST', token: manager.token, body: { title: 'Kickoff call', order_index: 2 } })).data.id;
  const t2 = (await h.api(`/api/templates/${tpl}/tasks`, { method: 'POST', token: manager.token, body: { title: 'Provision access', order_index: 1 } })).data.id;

  const fetched = await h.api(`/api/templates/${tpl}`, { token: manager.token });
  assert.deepEqual(fetched.data.tasks.map(t => t.id), [t2, t1]); // ordered by order_index

  // A task update/delete scoped to the WRONG template id is a silent no-op, not an error —
  // and must not affect the task under its real template.
  await h.api(`/api/templates/${other}/tasks/${t1}`, { method: 'PUT', token: manager.token, body: { title: 'Hijacked' } });
  assert.equal((await h.api(`/api/templates/${tpl}`, { token: manager.token })).data.tasks.find(t => t.id === t1).title, 'Kickoff call');
  await h.api(`/api/templates/${other}/tasks/${t1}`, { method: 'DELETE', token: manager.token });
  assert.equal((await h.api(`/api/templates/${tpl}`, { token: manager.token })).data.tasks.length, 2);

  await h.api(`/api/templates/${tpl}/tasks/${t1}`, { method: 'DELETE', token: manager.token });
  assert.equal((await h.api(`/api/templates/${tpl}`, { token: manager.token })).data.tasks.length, 1);
});

test('applying a template creates a project and its tasks, assigning only active engineers', async () => {
  await h.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(engineer.id); // inactive by the time we apply
  const tpl = (await h.api('/api/templates', { method: 'POST', token: manager.token, body: { name: 'Apply source', description: 'fallback description' } })).data.id;
  await h.api(`/api/templates/${tpl}/tasks`, { method: 'POST', token: manager.token, body: { title: 'Step one', priority: 'high' } });
  await h.api(`/api/templates/${tpl}/tasks`, { method: 'POST', token: manager.token, body: { title: 'Step two' } });

  assert.equal((await h.api(`/api/templates/${tpl}/apply`, { method: 'POST', token: manager.token, body: { title: '' } })).status, 400);
  assert.equal((await h.api('/api/templates/99999999/apply', { method: 'POST', token: manager.token, body: { title: 'X' } })).status, 404);

  const applied = await h.api(`/api/templates/${tpl}/apply`, { method: 'POST', token: manager.token, body: {
    title: 'New customer rollout', customer_id: customer, member_ids: [engineer.id, activeEngineer.id, manager.id],
  } });
  assert.equal(applied.status, 200);
  const projectId = applied.data.id;

  const project = await h.db.prepare('SELECT title, description, customer_id FROM projects WHERE id = ?').get(projectId);
  assert.equal(project.title, 'New customer rollout');
  assert.equal(project.description, 'fallback description'); // fell back to the template's description
  assert.equal(project.customer_id, customer);

  const assignees = (await h.db.prepare('SELECT user_id FROM project_assignments WHERE project_id = ?').all(projectId)).map(r => r.user_id);
  assert.deepEqual(assignees, [activeEngineer.id]); // inactive engineer and the manager were excluded

  const tasks = (await h.db.prepare('SELECT title, priority FROM tasks WHERE project_id = ? ORDER BY id').all(projectId));
  assert.deepEqual(tasks.map(t => t.title), ['Step one', 'Step two']);
  assert.equal(tasks[0].priority, 'high');
  assert.equal(tasks[1].priority, 'medium'); // template task default

  const activity = await h.db.prepare("SELECT detail FROM project_activity WHERE project_id = ? AND action = 'project_created'").get(projectId);
  assert.match(activity.detail, /Apply source/);
});
