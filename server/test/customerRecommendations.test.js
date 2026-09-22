const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, planner, authorizedEngineer, otherEngineer, customer, otherCustomer, project, visit;

test.before(async () => {
  h = await harness.start({ '/api/customers/:id/recommendations': require('../routes/customer-recommendations') });
  manager = await h.makeUser('Rec Manager', 'manager');
  planner = await h.makeUser('Rec Planner', 'planner');
  authorizedEngineer = await h.makeUser('Rec Authorized Engineer', 'engineer');
  otherEngineer = await h.makeUser('Rec Other Engineer', 'engineer');
  customer = (await h.db.prepare("INSERT INTO customers (name, active) VALUES ('Recommendations Co', 1)").run()).lastInsertRowid;
  otherCustomer = (await h.db.prepare("INSERT INTO customers (name, active) VALUES ('Unrelated Co', 1)").run()).lastInsertRowid;
  project = (await h.db.prepare("INSERT INTO projects (title, status, customer_id, created_by) VALUES ('Rec project', 'in_progress', ?, ?)").run(customer, manager.id)).lastInsertRowid;
  await h.db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, authorizedEngineer.id);
  visit = (await h.db.prepare("INSERT INTO maintenance_visits (title, customer_id, scheduled_date, status, created_by) VALUES ('Rec visit', ?, '2026-01-01', 'completed', ?)").run(customer, manager.id)).lastInsertRowid;
  await h.db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, authorizedEngineer.id);
});
test.after(() => h.stop());

const base = id => `/api/customers/${id}/recommendations`;
function body(overrides) { return { finding: 'Outdated firmware', recommendation: 'Upgrade to latest release', ...overrides }; }

test('access is scoped: managers and planners see every customer, engineers only assigned ones', async () => {
  assert.equal((await h.api(base('abc'), { token: manager.token })).status, 400);
  assert.equal((await h.api(base(999999), { token: manager.token })).status, 404);
  assert.equal((await h.api(base(customer))).status, 401);

  assert.equal((await h.api(base(customer), { token: manager.token })).status, 200);
  assert.equal((await h.api(base(customer), { token: planner.token })).status, 200);
  assert.equal((await h.api(base(customer), { token: authorizedEngineer.token })).status, 200);
  assert.equal((await h.api(base(customer), { token: otherEngineer.token })).status, 403);
});

test('create validates fields and forces owner_id to self for engineers', async () => {
  const post = (id, b, token = manager.token) => h.api(base(id), { method: 'POST', token, body: b });

  assert.equal((await post(customer, body({ finding: '' }))).status, 400);
  assert.equal((await post(customer, body({ finding: 'x'.repeat(10001) }))).status, 400);
  assert.equal((await post(customer, body({ risk_level: 'extreme' }))).status, 400);
  assert.equal((await post(customer, body({ status: 'bogus' }))).status, 400);
  assert.equal((await post(customer, body({ due_date: '2026-13-40' }))).status, 400);
  assert.equal((await post(customer, body({ owner_id: 'nan' }))).status, 400);
  assert.equal((await post(customer, body({ owner_id: 999999 }))).status, 400); // must be an active manager/engineer
  assert.equal((await post(customer, body({ source_visit_id: visit + 1000 }))).status, 400); // must belong to this customer

  assert.equal((await post(customer, body(), otherEngineer.token)).status, 403); // not an eligible role for this customer

  const created = await post(customer, body({ owner_id: manager.id }), authorizedEngineer.token);
  assert.equal(created.status, 201);
  assert.equal(created.data.owner_id, authorizedEngineer.id, 'engineers cannot set an owner other than themselves');
  assert.equal(created.data.status, 'open');
  assert.equal(created.data.version, 1);

  // An engineer can only cite a source visit they were actually assigned to.
  const otherVisit = (await h.db.prepare("INSERT INTO maintenance_visits (title, customer_id, scheduled_date, status, created_by) VALUES ('Unassigned visit', ?, '2026-01-01', 'completed', ?)").run(customer, manager.id)).lastInsertRowid;
  assert.equal((await post(customer, body({ source_visit_id: otherVisit }), authorizedEngineer.token)).status, 400);
  assert.equal((await post(customer, body({ source_visit_id: visit }), authorizedEngineer.token)).status, 201);
});

test('editing is limited to managers and the recommendation\'s own author, with optimistic concurrency', async () => {
  const created = (await h.api(base(customer), { method: 'POST', token: authorizedEngineer.token, body: body({}) })).data;

  assert.equal((await h.api(`${base(customer)}/${created.id}`, { method: 'PUT', token: otherEngineer.token, body: { ...body({}), version: created.version } })).status, 403);
  assert.equal((await h.api(`${base(customer)}/${created.id}`, { method: 'PUT', token: authorizedEngineer.token, body: { ...body({ finding: 'Updated' }) } })).status, 400); // missing version

  const staleConflict = await h.api(`${base(customer)}/${created.id}`, { method: 'PUT', token: authorizedEngineer.token, body: { ...body({ finding: 'First edit' }), version: created.version } });
  assert.equal(staleConflict.status, 200);
  assert.equal(staleConflict.data.version, created.version + 1);

  const stale = await h.api(`${base(customer)}/${created.id}`, { method: 'PUT', token: authorizedEngineer.token, body: { ...body({ finding: 'Second edit, stale version' }), version: created.version } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'RECOMMENDATION_CONFLICT');

  // A manager may edit even though they didn't create it.
  const managerEdit = await h.api(`${base(customer)}/${created.id}`, { method: 'PUT', token: manager.token, body: { ...body({ finding: 'Manager edit' }), version: staleConflict.data.version } });
  assert.equal(managerEdit.status, 200);
});

test('convert-to-project is manager-only, one-time, and assigns the owner if they are an active engineer', async () => {
  const created = (await h.api(base(customer), { method: 'POST', token: manager.token, body: body({ owner_id: authorizedEngineer.id }) })).data;
  const convert = (token, v) => h.api(`${base(customer)}/${created.id}/convert-to-project`, { method: 'POST', token, body: { title: 'Converted project', version: v } });

  assert.equal((await convert(planner.token, created.version)).status, 403);
  assert.equal((await convert(manager.token, created.version + 1)).status, 409); // wrong version

  const converted = await convert(manager.token, created.version);
  assert.equal(converted.status, 201);
  assert.equal(converted.data.status, 'converted_to_project');
  assert.ok(converted.data.related_project_id);

  const assignees = (await h.db.prepare('SELECT user_id FROM project_assignments WHERE project_id = ?').all(converted.data.related_project_id)).map(r => r.user_id);
  assert.deepEqual(assignees, [authorizedEngineer.id]);

  // Cannot convert the same recommendation twice.
  const second = await convert(manager.token, converted.data.version);
  assert.equal(second.status, 409);
});

test('convert-to-task requires the project to belong to the customer and a valid active-engineer assignee', async () => {
  const created = (await h.api(base(customer), { method: 'POST', token: manager.token, body: body({}) })).data;
  const otherProject = (await h.db.prepare("INSERT INTO projects (title, status, customer_id, created_by) VALUES ('Wrong customer project', 'in_progress', ?, ?)").run(otherCustomer, manager.id)).lastInsertRowid;

  const convert = (b, token = manager.token) => h.api(`${base(customer)}/${created.id}/convert-to-task`, { method: 'POST', token, body: { title: 'Follow-up task', project_id: project, assigned_to: authorizedEngineer.id, version: created.version, ...b } });

  assert.equal((await convert({ project_id: otherProject })).status, 400);
  assert.equal((await convert({ assigned_to: manager.id })).status, 400); // must be an engineer
  assert.equal((await convert({}, otherEngineer.token)).status, 403); // not the author and not a manager
  // An engineer converting may only assign the task to themselves.
  assert.equal((await convert({ assigned_to: otherEngineer.id }, authorizedEngineer.token)).status, 400);

  const result = await convert({});
  assert.equal(result.status, 201);
  assert.equal(result.data.recommendation.status, 'implemented');
  assert.ok(result.data.task_id);
  const task = await h.db.prepare('SELECT project_id, assigned_to, status FROM tasks WHERE id = ?').get(result.data.task_id);
  assert.equal(task.project_id, project);
  assert.equal(task.assigned_to, authorizedEngineer.id);
});

test('listing supports pagination and status filtering, and rejects invalid filters', async () => {
  assert.equal((await h.api(`${base(customer)}?page=0`, { token: manager.token })).status, 400);
  assert.equal((await h.api(`${base(customer)}?status=not_a_status`, { token: manager.token })).status, 400);
  const list = await h.api(`${base(customer)}?page=1`, { token: manager.token });
  assert.equal(list.status, 200);
  assert.equal(list.data.page, 1);
  assert.equal(list.data.page_size, 25);
  assert.ok(Array.isArray(list.data.rows));
  assert.ok(list.data.rows.every(row => 'can_edit' in row));
});
