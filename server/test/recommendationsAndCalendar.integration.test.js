const { test, assert, api, db, ids, bcrypt, signJwt,  } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');

test('customer recommendations validate references, preserve history and reject stale edits', async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Recommendation customer')).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Recommendation source', customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const foreign = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Foreign source', ids.customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const path = `/api/customers/${customer}/recommendations`;
  const body = { finding: 'Obsolete equipment', recommendation: 'Replace equipment', source_visit_id: visit, owner_id: ids.engineerEnabled, risk_level: 'high', due_date: '2026-10-01' };
  assert.equal((await api(path, { token:ids.tokenDisabled })).status,403);
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit,ids.engineerEnabled);
  assert.equal((await api(path,{ token:ids.tokenEnabled })).status,200);
  const engineerCreated=await api(path,{ method:'POST',token:ids.tokenEnabled,body:{ ...body,owner_id:ids.manager,finding:'Engineer finding' } });
  assert.equal(engineerCreated.status,201);
  assert.equal(engineerCreated.data.owner_id,ids.engineerEnabled);
  let plannerToken,plannerCreated;
  for (const role of ['planner','pm']) {
    const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Recommendation ${role}`, `recommendation-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api(path, { token })).status,role==='planner' ? 200 : 403);
    const response=await api(path,{ method:'POST',token,body:{ ...body,finding:`${role} finding` } });
    assert.equal(response.status,role==='planner' ? 201 : 403);
    if(role==='planner'){plannerToken=token;plannerCreated=response.data;}
    assert.equal((await api(`${path}/999/convert-to-project`, { method: 'POST', token, body: { version: 1, title: 'Denied conversion' } })).status, 403);
  }
  for (const query of ['page=0','page=1&page=2','page[x]=1','status=unknown','status=open&status=closed']) assert.equal((await api(`${path}?${query}`, { token: ids.tokenManager })).status, 400);
  for (const extra of [{ finding: '' }, { recommendation: 1 }, { finding: 'x'.repeat(10001) }, { due_date: '2026-02-29' }, { owner_id: true }, { source_visit_id: foreign }, { owner_id: 99999999 }, { status: 'converted_to_project' }, { risk_level: 'invalid' }]) assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...body, ...extra } })).status, 400);
  const created = await api(path, { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 201);
  assert.equal(created.data.version, 1);
  assert.equal(created.data.status, 'open');
  const id = created.data.id;
  const updated = await api(`${path}/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 1, status: 'accepted', follow_up_notes: 'Customer accepted the proposal' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.version, 2);
  assert.equal(updated.data.finding, body.finding);
  const stale = await api(`${path}/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 1, status: 'rejected' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'RECOMMENDATION_CONFLICT');
  assert.equal((await api(`/api/customers/${ids.customer}/recommendations/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 2, status: 'closed' } })).status, 404);
  assert.deepEqual((await db.prepare('SELECT action,status,version FROM recommendation_history WHERE recommendation_id=? ORDER BY id').all(id)), [{ action: 'created', status: 'open', version: 1 }, { action: 'updated', status: 'accepted', version: 2 }]);
  const converted = await api(`${path}/${id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 2, title: 'Equipment replacement' } });
  assert.equal(converted.status, 201);
  assert.equal(converted.data.status, 'converted_to_project');
  const project = await db.prepare('SELECT customer_id,deadline,description FROM projects WHERE id=?').get(converted.data.related_project_id);
  assert.equal(project.customer_id, customer);
  assert.equal(project.deadline, body.due_date);
  assert.ok(project.description.includes(body.finding) && project.description.includes(body.recommendation));
  assert.ok(await db.prepare('SELECT user_id FROM project_assignments WHERE project_id=? AND user_id=?').get(converted.data.related_project_id, ids.engineerEnabled));
  const taskProject=(await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run('Recommendation task project',customer,ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(taskProject,ids.engineerEnabled);
  const taskConversion=await api(`${path}/${plannerCreated.id}/convert-to-task`,{ method:'POST',token:plannerToken,body:{ version:1,title:'Replace equipment task',project_id:taskProject,assigned_to:ids.engineerEnabled,priority:'high',deadline:'2026-10-01' } });
  assert.equal(taskConversion.status,201);
  const task=await db.prepare('SELECT project_id,assigned_to,title FROM tasks WHERE id=?').get(taskConversion.data.task_id);
  assert.deepEqual(task,{ project_id:taskProject,assigned_to:ids.engineerEnabled,title:'Replace equipment task' });
  const engineerTask=await api(`${path}/${engineerCreated.data.id}/convert-to-task`,{ method:'POST',token:ids.tokenEnabled,body:{ version:1,title:'Engineer remediation',project_id:taskProject,assigned_to:ids.engineerEnabled } });
  assert.equal(engineerTask.status,201);
  assert.equal((await api(`${path}/${engineerCreated.data.id}/convert-to-task`,{ method:'POST',token:plannerToken,body:{ version:2,title:'Unauthorized',project_id:taskProject,assigned_to:ids.engineerEnabled } })).status,403);
  assert.equal((await api(`/api/projects/${taskProject}`,{ method:'PUT',token:ids.tokenManager,body:{ customer_id:ids.customer } })).status,409);
  assert.equal((await api(`${path}/${id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 3, title: 'Duplicate conversion' } })).status, 409);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE customer_id=?').get(customer)).total), 2);
});

test('recommendation conversion rolls back its project and version if history fails on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager, body: { finding: 'Atomic conversion fixture', recommendation: 'History must persist' } });
  assert.equal(created.status, 201);
  const originalTransaction = db.transaction;
  try {
    db.transaction = callback => originalTransaction(tx => callback({ ...tx, prepare(sql) {
      if (sql.startsWith('INSERT INTO recommendation_history')) throw new Error('Simulated recommendation history failure');
      return tx.prepare(sql);
    } }));
    const response = await api(`/api/customers/${ids.customer}/recommendations/${created.data.id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 1, title: 'Atomic conversion should roll back' } });
    assert.equal(response.status, 500);
  } finally { db.transaction = originalTransaction; }
  const stored = await db.prepare('SELECT version,status,related_project_id FROM customer_recommendations WHERE id=?').get(created.data.id);
  assert.deepEqual(stored, { version: 1, status: 'open', related_project_id: null });
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE title=?').get('Atomic conversion should roll back')).total), 0);
});

test('recommendations enforce customer links and concurrent conversions on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Concurrent recommendation customer')).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Retained recommendation source', customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const path = `/api/customers/${customer}/recommendations`;
  const created = await api(path, { method: 'POST', token: ids.tokenManager, body: { finding: 'Concurrent finding', recommendation: 'One project', source_visit_id: visit } });
  assert.equal(created.status, 201);
  const responses = await Promise.all([1,2].map(i => api(`${path}/${created.data.id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 1, title: `Concurrent conversion ${i}` } })));
  assert.deepEqual(responses.map(row => row.status).sort(), [201,409]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE customer_id=?').get(customer)).total), 1);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customer } })).status, 409);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { method: 'DELETE', token: ids.tokenManager })).status, 409);
  const converted = responses.find(row => row.status === 201).data;
  assert.equal((await api(`/api/projects/${converted.related_project_id}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customer } })).status, 409);
  assert.equal((await api(`/api/customers/${customer}`, { method: 'DELETE', token: ids.tokenManager })).status, 409);
  const list = await api(`${path}?status=converted_to_project`, { token: ids.tokenManager });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.rows[0].source_visit_title, 'Retained recommendation source');
  assert.equal((await api(`${path}?page=0`, { token: ids.tokenManager })).status, 400);
  const overview = await api(`/api/customers/${customer}/overview`, { token: ids.tokenManager });
  assert.equal(overview.data.timeline.filter(row => row.kind === 'recommendation').length, 2);
});

test('customer overview rejects unauthorized roles and malformed inputs', async () => {
  for (const user of [ids.engineerEnabled, ids.engineerDisabled]) assert.equal((await api(`/api/customers/${ids.customer}/overview`, { token: signJwt({ id: user }) })).status, 403);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Overview ${role}`, `customer-overview-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    assert.equal((await api(`/api/customers/${ids.customer}/overview`, { token: signJwt({ id: user }) })).status, 403);
  }
  for (const id of ['0', '-1', '1abc', '9007199254740992']) assert.equal((await api(`/api/customers/${id}/overview`, { token: ids.tokenManager })).status, 400);
  for (const query of ['page=0', 'page=1.5', 'page=1&page=2', 'page[x]=1', 'page=9007199254740991']) assert.equal((await api(`/api/customers/${ids.customer}/overview?${query}`, { token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/customers/99999999/overview', { token: ids.tokenManager })).status, 404);
});

test('customer overview bounds sections, isolates customers and pages recorded events on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Customer 360 fixture')).lastInsertRowid;
  const projectIds = [];
  for (let i = 0; i < 27; i++) projectIds.push((await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run(`Customer project ${i}`, customer, ids.manager)).lastInsertRowid);
  const foreign = (await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run('Foreign customer project', ids.customer, ids.manager)).lastInsertRowid;
  for (const project of [projectIds[0], foreign]) await db.prepare('INSERT INTO tasks (title,project_id,created_by) VALUES (?,?,?)').run(`Customer task ${project}`, project, ids.manager);
  await db.prepare('INSERT INTO attachments (project_id,original_name,stored_name,uploaded_by) VALUES (?,?,?,?)').run(projectIds[0], 'Customer document.pdf', 'private-storage-name', ids.manager);
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by,report_sent,report_sent_at) VALUES (?,?,?,?,?,?)').run('Customer visit', customer, '2026-09-18', ids.manager, 1, '2026-09-18 10:00:00')).lastInsertRowid;
  await db.prepare('INSERT INTO project_activity (project_id,user_id,action,detail) VALUES (?,?,?,?)').run(projectIds[0], ids.manager, 'closure_requested', 'Recorded review');
  const response = await api(`/api/customers/${customer}/overview`, { token: ids.tokenManager });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.counts, { projects: 27, tasks: 1, visits: 1, documents: 1, assets: 0 });
  assert.equal(response.data.projects.length, 25);
  assert.equal(response.data.projects.some(row => row.id === foreign), false);
  assert.equal(response.data.documents[0].stored_name, undefined);
  assert.equal(JSON.stringify(response.data).includes('private-storage-name'), false);
  assert.equal(response.data.total, 32);
  const second = await api(`/api/customers/${customer}/overview?page=2`, { token: ids.tokenManager });
  const events = [...response.data.timeline, ...second.data.timeline];
  assert.equal(events.length, 32);
  assert.equal(new Set(events.map(row => `${row.kind}:${row.entity_id}`)).size, 32);
  assert.ok(events.some(row => row.kind === 'visit_report' && row.entity_id === visit && row.event_at === '2026-09-18 10:00:00'));
  assert.ok(events.some(row => row.kind === 'project_event' && row.action === 'closure_requested'));
});

test('maintenance list and export reject malformed filters consistently', async () => {
  for (const query of ['month=', 'month=2026-13', 'month=1899-12', 'month=2026-01&month=2026-02', 'engineer_id=0', 'engineer_id=1.5', 'customer_id=9007199254740992', 'customer_id[x]=1', 'pending_report=true', 'review_pending=', 'not_completed=2', 'overview=1&overview=0', 'filter=unknown', 'filter=all&filter=past', 'as_of=2026-02-29', 'search[x]=bad', `search=${'x'.repeat(501)}`]) {
    for (const route of ['maintenance-visits', 'maintenance-visits/export']) {
      assert.equal((await api(`/api/${route}?${query}`, { token: ids.tokenManager })).status, 400, `${route}: ${query}`);
    }
  }
  for (const token of [ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api('/api/maintenance-visits/export', { token })).status, 403);
    assert.equal((await api(`/api/maintenance-visits/export?token=${signJwt({ id: token === ids.tokenEnabled ? ids.engineerEnabled : ids.engineerDisabled, download: true })}`)).status, 403);
  }
});

test('maintenance workbook and list share filters, literal decrypted search and assignment scope on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const previousKey = process.env.CUSTOMER_FIELD_KEY;
  process.env.CUSTOMER_FIELD_KEY = 'a'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.CUSTOMER_FIELD_KEY;
    else process.env.CUSTOMER_FIELD_KEY = previousKey;
  });
  const { encrypt, isEncrypted } = require('../fieldCipher');
  const encryptedName = encrypt('Filter customer %_\\');
  assert.equal(isEncrypted(encryptedName), true);
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run(encryptedName)).lastInsertRowid;
  const fixture = [];
  for (const [status, date, sent, forwarded, owner] of [
    ['scheduled', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['scheduled', '2043-12-30', 0, 0, ids.engineerEnabled],
    ['completed', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['in_progress', '2043-12-31', 1, 0, ids.engineerEnabled],
    ['completed', '2043-12-31', 1, 1, ids.engineerEnabled],
    ['cancelled', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['completed', '2044-01-01', 0, 0, ids.engineerDisabled],
  ]) {
    const title = `Visit export fixture ${fixture.length}`;
    const id = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,status,scheduled_date,report_sent,report_sent_to_customer,created_by) VALUES (?,?,?,?,?,?,?)')
      .run(title, customer, status, date, sent, forwarded, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(id, owner);
    fixture.push({ id, title });
  }
  const planner = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)')
    .run('Export planner', 'export-planner@test.local', bcrypt.hashSync('pw', 4), 'planner')).lastInsertRowid;
  for (const extra of ['filter=all', 'filter=upcoming', 'filter=past', 'filter=report_pending', 'filter=awaiting_review', 'filter=cancelled', 'month=2043-12', 'month=2044-01', 'pending_report=0', 'pending_report=1', 'review_pending=1', 'not_completed=1', `engineer_id=${ids.engineerDisabled}&pending_report=1`, 'search=%25_', 'search=no-match', 'search=Visit%20export%20fixture%202']) {
    const query = `customer_id=${customer}&as_of=2043-12-31&${extra}`;
    for (const user of [ids.manager, planner]) {
      const list = await api(`/api/maintenance-visits?${query}`, { token: signJwt({ id: user }) });
      assert.equal(list.status, 200);
      const response = await fetch(`${fixture.baseUrl}/api/maintenance-visits/export?${query}&token=${signJwt({ id: user, download: true })}`);
      assert.equal(response.status, 200);
      const workbook = new (require('exceljs').Workbook)();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const titles = [];
      workbook.worksheets[0].eachRow((row, index) => { if (index > 1) { titles.push(row.getCell(1).value); assert.equal(row.getCell(2).value, 'Filter customer %_\\'); } });
      assert.deepEqual(titles, list.data.map(row => row.title), extra);
    }
  }
  const read = async extra => (await api(`/api/maintenance-visits?customer_id=${customer}&as_of=2043-12-31&${extra}`, { token: ids.tokenManager })).data.map(row => row.id);
  assert.deepEqual(await read('filter=upcoming'), [fixture[0].id]);
  assert.deepEqual(await read('filter=report_pending'), [fixture[2].id, fixture[6].id]);
  assert.deepEqual(await read('filter=awaiting_review'), [fixture[3].id]);
  assert.equal((await read('pending_report=0&review_pending=0&not_completed=0&overview=0')).length, 7);
  assert.equal((await read('search=%25_')).length, 7, 'encrypted customer search treats wildcards literally');
  const own = await api(`/api/maintenance-visits?customer_id=${customer}&engineer_id=${ids.engineerDisabled}&pending_report=1`, { token: ids.tokenEnabled });
  assert.deepEqual(own.data.map(row => row.id), [fixture[2].id], 'engineer filter cannot replace ownership');
});

test('task list and export consistently reject malformed filters', async () => {
  for (const query of ['filter=unknown', 'filter=', 'filter=open&filter=done', 'project_id=abc', 'assigned_to=0', 'priority=urgent', 'search[x]=bad', 'as_of=2035-02-29', 'as_of=', 'adhoc=true', 'sort=__proto__', 'direction=DROP', 'page=0', 'page=-1', 'page=1.5', 'page=1&page=2', 'page_size=101', 'page_size=', 'page=9007199254740991&page_size=100', `search=${'a'.repeat(501)}`]) {
    for (const route of ['tasks', 'tasks/export']) assert.equal((await api(`/api/${route}?${query}`, { token: ids.tokenManager })).status, 400);
  }
});

test('project detail and timeline reject malformed IDs before querying', async () => {
  for (const id of ['invalid', '0', '-1', '1.2', '9007199254740992']) {
    for (const suffix of ['', '/activity']) assert.equal((await api(`/api/projects/${id}${suffix}`, { token: ids.tokenManager })).status, 400);
  }
  assert.equal((await api('/api/projects/99999999', { token: ids.tokenManager })).status, 404);
});

test('task relationships protect dependency details, mentions and comment deletion after reassignment', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by) VALUES (?,?,?)').run('Task relationship privacy fixture', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const hidden = (await db.prepare('INSERT INTO tasks (title,assigned_to,deadline,created_by) VALUES (?,?,?,?)').run('Confidential other task', ids.engineerDisabled, '2036-06-17', ids.manager)).lastInsertRowid;
  const path = `/api/tasks/${task}`;
  assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: hidden } })).status, 200);
  const deps = await api(`${path}/dependencies`, { token: ids.tokenEnabled });
  assert.equal(deps.status, 200);
  assert.deepEqual(deps.data, [{ id: hidden, title: 'Restricted task', restricted: true, is_blocking: true }]);
  const management = await api(`${path}/dependencies`, { token: ids.tokenManager });
  assert.equal(management.data[0].title, 'Confidential other task');
  assert.equal(management.data[0].deadline, '2036-06-17');
  await db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(hidden);
  assert.equal((await api(`${path}/dependencies`, { token: ids.tokenEnabled })).data[0].is_blocking, false);
  assert.equal((await api(`/api/tasks/${hidden}/dependencies`, { token: ids.tokenEnabled })).status, 403);
  const tokens = [];
  for (const [role, name] of [['planner', 'GuardPlanner'], ['pm', 'GuardPM']]) {
    const id = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(name, `${name}@test.local`, 'not-used', role)).lastInsertRowid;
    tokens.push(signJwt({ id }));
  }
  const comment = await api(`${path}/comments`, { method: 'POST', token: ids.tokenManager, body: { message: '@EngineerEnabled @EngineerDisabled @GuardPlanner @GuardPM confidential handover' } });
  assert.equal(comment.status, 200);
  const recipients = await db.prepare("SELECT user_id,link FROM notifications WHERE type='mention' AND body LIKE ?").all('%Task relationship privacy fixture%');
  assert.deepEqual(recipients, [{ user_id: ids.engineerEnabled, link: '/tasks' }]);
  assert.equal((await api(`${path}/comments/${comment.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403);
  const ownComment = await api(`${path}/comments`, { method: 'POST', token: ids.tokenEnabled, body: { message: 'My comment before reassignment' } });
  assert.equal(ownComment.status, 200);
  await db.prepare('UPDATE tasks SET assigned_to=? WHERE id=?').run(ids.engineerDisabled, task);
  assert.equal((await api(`${path}/comments/${ownComment.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403);
  assert.ok(await db.prepare('SELECT id FROM task_comments WHERE id=?').get(ownComment.data.id));
  assert.equal((await api(`${path}/comments/${ownComment.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  for (const token of tokens) {
    for (const route of ['comments', 'dependencies']) assert.equal((await api(`${path}/${route}`, { token })).status, 403);
    assert.equal((await api(`${path}/comments/${comment.data.id}`, { method: 'DELETE', token })).status, 403);
  }
  for (const id of ['invalid', '0', '-1', '1.2', '9007199254740992']) {
    assert.equal((await api(`/api/tasks/${id}/comments`, { token: ids.tokenManager })).status, 400);
    assert.equal((await api(`/api/tasks/${id}/dependencies`, { token: ids.tokenManager })).status, 400);
    assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: id } })).status, 400);
  }
  assert.equal((await api(`${path}/comments/invalid`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`${path}/dependencies/invalid`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: 99999999 } })).status, 404);
  assert.equal((await api(`/api/tasks/99999999/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: task } })).status, 404);
  assert.equal((await api(`/api/tasks/${hidden}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: task } })).status, 400, 'cycle guard remains effective');
});

test('calendar validates real month boundaries and matches module role visibility', async () => {
  const mkUser = async role => (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Calendar ${role}`, `calendar-${role}@test.local`, 'not-used', role)).lastInsertRowid;
  const planner = await mkUser('planner');
  const pm = await mkUser('pm');
  const project = (await db.prepare('INSERT INTO projects (title, deadline, created_by) VALUES (?,?,?)').run('Calendar unassigned project', '2038-12-31', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title, deadline, assigned_to, created_by) VALUES (?,?,?,?)').run('Calendar own task', '2038-12-31', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const hiddenTask = (await db.prepare('INSERT INTO tasks (title, deadline, assigned_to, created_by) VALUES (?,?,?,?)').run('Calendar legacy PM task', '2038-12-30', pm, ids.manager)).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id,title,scheduled_date,created_by) VALUES (?,?,?,?)').run(ids.customer, 'Calendar visit', '2038-12-31', ids.manager)).lastInsertRowid;
  const next = (await db.prepare('INSERT INTO projects (title,deadline,created_by) VALUES (?,?,?)').run('Next year boundary', '2039-01-01', ids.manager)).lastInsertRowid;
  const get = token => api('/api/calendar?month=2038-12', { token });
  const own = await get(ids.tokenEnabled);
  assert.equal(own.status, 200);
  assert.ok(own.data.tasks.some(row => row.id === task));
  assert.ok(!own.data.tasks.some(row => row.id === hiddenTask));
  assert.ok(!own.data.projects.some(row => row.id === project));
  assert.ok(!own.data.visits.some(row => row.id === visit));
  const planning = await get(signJwt({ id: planner }));
  assert.deepEqual(planning.data.tasks, []);
  assert.deepEqual(planning.data.projects, []);
  assert.ok(planning.data.visits.some(row => row.id === visit));
  const readOnly = await get(signJwt({ id: pm }));
  assert.deepEqual(readOnly.data.tasks, []);
  assert.ok(readOnly.data.projects.some(row => row.id === project));
  assert.ok(readOnly.data.visits.some(row => row.id === visit));
  assert.equal((await api(`/api/maintenance-visits/${visit}/report-sent`, { method: 'POST', token: signJwt({ id: pm }) })).status, 403);
  const management = await get(ids.tokenManager);
  assert.ok(management.data.projects.some(row => row.id === project));
  assert.ok(!management.data.projects.some(row => row.id === next));
  await db.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(project, ids.engineerEnabled);
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit, ids.engineerEnabled);
  const assigned = await get(ids.tokenEnabled);
  assert.ok(assigned.data.projects.some(row => row.id === project));
  assert.ok(assigned.data.visits.some(row => row.id === visit));
  for (const query of ['', 'month=2038-00', 'month=2038-13', 'month=1899-12', 'month=9999-01', 'month=2038-1', 'month=2038-12&month=2039-01', 'month[x]=2038-12']) {
    assert.equal((await api(`/api/calendar?${query}`, { token: ids.tokenManager })).status, 400);
  }
});

test('calendar follow-ups honor ownership, feature enablement and linked task completion', async () => {
  const resolved = (await db.prepare("INSERT INTO tasks (title,status,created_by) VALUES (?,'completed',?)").run('Calendar resolved follow-up', ids.manager)).lastInsertRowid;
  const rows = [];
  for (const [label, owner, status, task, date] of [
    ['Pending completed activity', ids.engineerEnabled, 'completed', null, '2040-02-29'],
    ['Resolved linked task', ids.engineerEnabled, 'completed', resolved, '2040-02-29'],
    ['Cancelled activity', ids.engineerEnabled, 'cancelled', null, '2040-02-29'],
    ['Other owner', ids.engineerDisabled, 'completed', null, '2040-02-29'],
    ['Next month', ids.engineerEnabled, 'completed', null, '2040-03-01'],
  ]) {
    rows.push((await db.prepare(`INSERT INTO service_activities
      (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,status,follow_up_required,follow_up_date,follow_up_task_id,created_by)
      VALUES (?,?,?,?,?,?,?, ?,1,?,?,?)`).run(`ACT-2040-${900000 + rows.length}`, ids.customer, ids.teamEnabled, owner, '2039-01-01', ids.category, label, status, date, task, owner)).lastInsertRowid);
  }
  const path = `/api/calendar?month=2040-02&engineer_id=${ids.engineerDisabled}`;
  const own = await api(path, { token: ids.tokenEnabled });
  assert.equal(own.status, 200);
  assert.equal(own.data.service_enabled, true);
  assert.deepEqual(own.data.followUps.map(row => row.id), [rows[0]]);
  assert.equal(own.data.followUps[0].date, '2040-02-29');
  assert.equal(own.data.followUps[0].reference, 'ACT-2040-900000');
  const disabled = await api(path, { token: ids.tokenDisabled });
  assert.equal(disabled.data.service_enabled, false);
  assert.deepEqual(disabled.data.followUps, []);
  const management = await api(path, { token: ids.tokenManager });
  assert.deepEqual(management.data.followUps.map(row => row.id), [rows[0], rows[3]]);
  const pm = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Follow-up PM', 'follow-up-pm@test.local', 'not-used', 'pm')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id,user_id) VALUES (?,?)').run(ids.teamEnabled, pm);
  await db.prepare('UPDATE service_activities SET engineer_id=? WHERE id=?').run(pm, rows[3]);
  const pmData = await api(path, { token: signJwt({ id: pm }) });
  assert.equal(pmData.data.service_enabled, true);
  assert.deepEqual(pmData.data.followUps.map(row => row.id), [rows[3]]);
});

test('calendar pending reports use scoped visit dates and exclude scheduled or sent reports', async () => {
  const pending = [];
  for (const [status, report, owner] of [['completed', 0, ids.engineerEnabled], ['in_progress', 0, ids.engineerEnabled], ['scheduled', 0, ids.engineerEnabled], ['completed', 1, ids.engineerEnabled], ['cancelled', 0, ids.engineerEnabled], ['completed', 0, ids.engineerDisabled]]) {
    const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id,title,scheduled_date,status,report_sent,created_by) VALUES (?,?,?,?,?,?)').run(ids.customer, 'Calendar report fixture', '2041-03-02', status, report, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit, owner);
    if (owner === ids.engineerEnabled && !report && ['completed', 'in_progress'].includes(status)) pending.push(visit);
  }
  const response = await api('/api/calendar?month=2041-03', { token: ids.tokenEnabled });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.reports.map(row => row.id), pending);
  assert.ok(response.data.reports.every(row => row.type === 'report' && row.date === '2041-03-02' && row.engineer_names === 'Engineer Enabled'));
});

test('ordinary project edits cannot bypass closure requests or reviews', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Protected closure', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const edit = body => api(path, { method: 'PUT', token: ids.tokenManager, body });
  assert.equal((await edit({ status: 'pending_approval' })).data.code, 'CLOSURE_REVIEW_REQUIRED');
  assert.equal((await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
  for (const status of ['closed', 'reopened', 'in_progress', 'cancelled']) {
    const result = await edit({ status });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'CLOSURE_REVIEW_REQUIRED');
  }
  assert.equal((await edit({ title: 'Metadata remains editable', status: 'pending_approval' })).status, 200);
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.title, 'Metadata remains editable');
  assert.equal(stored.closure_decision, null);
  assert.equal(stored.closure_requested_by, ids.manager);
});

test('an edit started before a closure request cannot overwrite its state', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Concurrent metadata edit', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const originalPrepare = db.prepare;
  let release, read;
  const gate = new Promise(resolve => { release = resolve; });
  const snapshotRead = new Promise(resolve => { read = resolve; });
  let held = false;
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql);
    if (sql !== 'SELECT * FROM projects WHERE id = ?') return statement;
    return { ...statement, get: async (...args) => {
      const snapshot = await statement.get(...args);
      if (!held && Number(args[0]) === project) {
        held = true;
        read();
        await gate;
      }
      return snapshot;
    } };
  };
  let pending;
  try {
    pending = api(path, { method: 'PUT', token: ids.tokenManager, body: { title: 'Stale edit', status: 'in_progress' } });
    await snapshotRead;
    assert.equal((await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
    release();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'PROJECT_CONFLICT');
  } finally {
    release();
    if (pending) await pending;
    db.prepare = originalPrepare;
  }
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.title, 'Concurrent metadata edit');
  assert.equal(stored.closure_request_version, 1);
});

test('project closure rejection records a complete decision and protects newer requests', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Closure revision flow', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(request.status, 200);
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.closure_requested_by, ids.engineerEnabled);
  assert.equal(stored.closure_request_version, request.data.request_version);
  for (const comment of ['', '   ', {}, 'x'.repeat(2001)]) {
    assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment } })).status, 400);
  }
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenEnabled, body: { comment: 'Unauthorized' } })).status, 403);
  const rejection = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Finish the handover documents', request_version: stored.closure_request_version } });
  assert.equal(rejection.status, 200);
  const rejected = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(rejected.status, 'reopened');
  assert.equal(rejected.closure_reviewed_by, ids.manager);
  assert.equal(rejected.closure_decision, 'rejected');
  assert.equal(rejected.closure_review_comment, 'Finish the handover documents');
  assert.ok(rejected.closure_reviewed_at);
  assert.equal(rejected.closed_at, null);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM project_activity WHERE project_id=? AND action='closure_rejected'").get(project)).n), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND entity_type='project' AND action='closure_rejected'").get(project)).n), 1);
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Repeat' } })).status, 409);
  const notification = await db.prepare("SELECT body FROM notifications WHERE user_id=? AND type='project.closure_rejected' AND link=?").get(ids.engineerEnabled, path.replace('/api', ''));
  assert.match(notification.body, /handover documents/);
  const second = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(second.data.request_version, stored.closure_request_version + 1);
  assert.equal((await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: stored.closure_request_version } })).status, 409);
  const approved = await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: second.data.request_version, comment: 'Handover reviewed' } });
  assert.equal(approved.status, 200);
  const detail = await api(path, { token: ids.tokenEnabled });
  assert.equal(detail.data.closure_requested_by_name, 'Engineer Enabled');
  assert.equal(detail.data.closure_reviewed_by_name, 'Manager One');
  assert.equal(detail.data.status, 'closed');
  assert.equal(detail.data.closure_decision, 'approved');
  assert.equal(detail.data.closure_review_comment, 'Handover reviewed');
  assert.equal(detail.data.updates.length, 4);
});

test('approval backlog and review endpoints are management-only with validated inputs', async () => {
  for (const token of [ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
  }
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(`Approval ${role}`, `approval-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
    assert.equal((await api(`/api/projects/1/reject-closure`, { method: 'POST', token, body: { comment: 'Denied' } })).status, 403);
  }
  for (const query of ['page=0', 'page=1x', 'page_size=101', 'page=9007199254740991', 'page=1&page=2']) {
    assert.equal((await api(`/api/projects/approvals?${query}`, { token: ids.tokenManager })).status, 400);
  }
  const project = (await db.prepare("INSERT INTO projects (title, status, created_by) VALUES (?, 'pending_approval', ?)").run('Legacy approval request', ids.manager)).lastInsertRowid;
  const backlog = await api('/api/projects/approvals?page_size=1', { token: ids.tokenManager });
  assert.equal(backlog.status, 200);
  assert.ok(backlog.data.total >= 1);
  assert.equal(backlog.data.rows.length, 1);
  for (const review of [{ request_version: '0' }, { comment: {} }]) {
    assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: review })).status, 400);
  }
  assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200, 'existing clients may still approve without a version');
});

test('concurrent approval and rejection write exactly one decision on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Opposing closure decisions', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const body = { request_version: request.data.request_version, comment: 'Review decision' };
  const results = await Promise.all(['approve-closure', 'reject-closure'].map(action => api(`${path}/${action}`, { method: 'POST', token: ids.tokenManager, body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM project_status_updates WHERE project_id=?').get(project)).n), 2);
  const stored = await db.prepare('SELECT status, closure_decision FROM projects WHERE id=?').get(project);
  assert.ok((stored.status === 'closed' && stored.closure_decision === 'approved') || (stored.status === 'reopened' && stored.closure_decision === 'rejected'));
});


test('closure review rolls back when its history cannot be recorded on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Closure history rollback', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const originalTransaction = db.transaction;
  try {
    db.transaction = callback => originalTransaction(tx => callback({ ...tx, prepare(sql) {
      if (sql.startsWith('INSERT INTO project_status_updates')) throw new Error('Simulated review history failure');
      return tx.prepare(sql);
    } }));
    const response = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Review must persist', request_version: request.data.request_version } });
    assert.equal(response.status, 500);
  } finally { db.transaction = originalTransaction; }
  const stored = await db.prepare('SELECT status, closure_decision, closure_reviewed_by FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.closure_decision, null);
  assert.equal(stored.closure_reviewed_by, null);
});
