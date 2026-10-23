const { test, assert, api, db, ids, createActivity, bcrypt, signJwt,  } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');



test('invalid dates, durations, text and technology IDs return 400 instead of reaching storage', async () => {
  for (const body of [
    { activity_date: '2026-02-30' }, { duration_minutes: 'abc' },
    { duration_minutes: 1.5 }, { duration_minutes: 1441 }, { title: 123 },
    { technology_ids: [999999] }, { technology_ids: [1, 1] },
    { asset_ids: [999999] }, { asset_ids: [1, 1] }, { asset_ids: ['1'] },
  ]) {
    const result = await createActivity(body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('partial edits preserve required fields and reject attempts to clear them', async () => {
  await db.prepare('UPDATE customers SET require_duration=1, require_ticket_reference=1, require_notes=1 WHERE id=?').run(ids.customer);
  try {
    const created = await createActivity({ duration_minutes: 60, ticket_reference: 'CASE-1', description: 'Work notes' });
    assert.equal(created.status, 200);
    const update = body => api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body,
    });
    assert.equal((await update({ title: 'Updated title' })).status, 200);
    for (const body of [{ duration_minutes: null }, { ticket_reference: '' }, { description: '' }, { category_id: null }, { activity_date: null }]) {
      assert.equal((await update(body)).status, 400, JSON.stringify(body));
    }
    const stored = await db.prepare('SELECT duration_minutes, ticket_reference, description FROM service_activities WHERE id=?').get(created.data.id);
    assert.equal(stored.duration_minutes, 60);
    assert.equal(stored.ticket_reference, 'CASE-1');
    assert.equal(stored.description, 'Work notes');
  } finally {
    await db.prepare('UPDATE customers SET require_duration=0, require_ticket_reference=0, require_notes=0 WHERE id=?').run(ids.customer);
  }
});

test('changing customers revalidates retained related project links', async () => {
  const project = await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Customer-specific project', ids.customer, ids.manager);
  const created = await createActivity({ related_project_id: project.lastInsertRowid });
  assert.equal(created.status, 200);
  const result = await api(`/api/service-activities/${created.data.id}`, {
    method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned },
  });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /project.*customer/i);
});

test('revoked customer access prevents editing an existing owned activity', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  await db.prepare('DELETE FROM customer_teams WHERE customer_id=? AND team_id=?').run(ids.customer, ids.teamEnabled);
  try {
    const result = await api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body: { title: 'After access revoked' },
    });
    assert.equal(result.status, 403);
    for (const action of ['complete', 'duplicate', 'follow-up-task', 'attachments']) {
      const denied = await api(`/api/service-activities/${created.data.id}/${action}`, { method: 'POST', token: ids.tokenEnabled, body: {} });
      assert.equal(denied.status, 403, action);
    }
  } finally {
    await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);
  }
});

test('concurrent activity creation allocates unique references without reusing deleted numbers', async () => {
  const created = await Promise.all(Array.from({ length: 10 }, (_, i) => createActivity({ title: `Concurrent work ${i}` })));
  created.forEach(result => assert.equal(result.status, 200, result.data.error));
  const references = created.map(result => result.data.activity_reference);
  assert.equal(new Set(references).size, 10);
  const latest = created.reduce((a, b) => a.data.activity_reference > b.data.activity_reference ? a : b);
  await db.prepare('DELETE FROM service_activities WHERE id=?').run(latest.data.id);
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.ok(next.data.activity_reference > latest.data.activity_reference);
});

test('reference counters initialize from existing activity references on upgrade', async () => {
  const previous = await createActivity();
  assert.equal(previous.status, 200);
  await db.prepare('DELETE FROM service_activity_sequences WHERE year=?').run(new Date().getFullYear());
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.equal(Number(next.data.activity_reference.slice(-6)), Number(previous.data.activity_reference.slice(-6)) + 1);
});

test('follow-up creation is idempotent and ad-hoc follow-ups do not prevent later activity edits', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  const path = `/api/service-activities/${created.data.id}/follow-up-task`;
  const first = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  const again = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(first.data.created, true);
  assert.equal(again.data.created, false);
  assert.equal(first.data.id, again.data.id);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { title: 'Edited after follow-up creation' } });
  assert.equal(updated.status, 200, updated.data.error);
  const activity = await db.prepare('SELECT related_task_id, follow_up_task_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(activity.related_task_id, null);
  assert.equal(activity.follow_up_task_id, first.data.id);
});

test('PostgreSQL locks prevent concurrent duplicate follow-up tasks', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity();
  const results = await Promise.all(Array.from({ length: 5 }, () => api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token: ids.tokenEnabled, body: {} })));
  results.forEach(result => assert.equal(result.status, 200));
  assert.equal(new Set(results.map(result => result.data.id)).size, 1);
  assert.equal(results.filter(result => result.data.created).length, 1);
});

test('customer changes choose an eligible team for the new customer', async () => {
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customerUnassigned, ids.teamDisabled);
  const created = await createActivity();
  assert.equal(created.status, 200);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned } });
  assert.equal(updated.status, 200);
  const stored = await db.prepare('SELECT customer_id, team_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(stored.customer_id, ids.customerUnassigned);
  assert.equal(stored.team_id, ids.teamDisabled);
});

test('export reaches the workbook route and remains scoped to the owning engineer', async () => {
  const manager = await createActivity({ title: 'Engineer export scope marker' });
  assert.equal(manager.status, 200);
  const response = await fetch(`${suiteFixture.baseUrl}/api/service-activities/export`, { headers: { Authorization: `Bearer ${ids.tokenEnabled}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.ok(rows.length);
  assert.ok(rows.every(row => row[10] === 'Engineer Enabled'));
});

test('task custom fields enforce task ownership and project relationships', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Custom fields project', ids.manager)).lastInsertRowid;
  const otherProject = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Other project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const mkTask = async assignedTo => (await db.prepare('INSERT INTO tasks (project_id, title, assigned_to, created_by) VALUES (?, ?, ?, ?)')
    .run(project, 'Scoped task', assignedTo, ids.manager)).lastInsertRowid;
  const ownTask = await mkTask(ids.engineerEnabled);
  const otherTask = await mkTask(ids.manager);
  const field = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(project, 'Number field', 'number')).lastInsertRowid;
  const otherField = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(otherProject, 'Private field', 'text')).lastInsertRowid;
  const endpoint = task => `/api/projects/${project}/custom-fields/values/${task}`;
  assert.equal((await api(endpoint(otherTask), { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(endpoint(otherTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 403);
  assert.equal((await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 200);
  assert.equal((await api(endpoint(ownTask), { token: ids.tokenEnabled })).data[field], '42');
  const invalid = [{ [otherField]: 'Cross-project write' }, { [field]: 'NaN' }, null, [], { [field]: {} }];
  for (const values of invalid) {
    const result = await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values } });
    assert.equal(result.status, 400, JSON.stringify(values));
  }
  const stored = await db.prepare('SELECT field_id, value FROM task_custom_values WHERE task_id=?').all(ownTask);
  assert.deepEqual(stored, [{ field_id: field, value: '42' }]);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Custom ${role}`, `${role}@custom.test`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api(endpoint(ownTask), { token: signJwt({ id: user }) })).status, 403);
  }
});

test('custom field definitions and typed values reject invalid input', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Typed fields project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (project_id, title, created_by) VALUES (?, ?, ?)').run(project, 'Typed task', ids.manager)).lastInsertRowid;
  const base = `/api/projects/${project}/custom-fields`;
  for (const body of [{ name: 123 }, { name: 'Bad type', field_type: 'script' }, { name: 'Bad options', options: {} }]) {
    assert.equal((await api(base, { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const select = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Environment', field_type: 'select', options: ['Production', 'Test'], required: true } });
  assert.equal(select.status, 200);
  const date = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Renewal', field_type: 'date' } });
  assert.equal(date.status, 200);
  assert.equal((await api(`${base}/${date.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { field_type: 'script' } })).status, 400);
  for (const values of [{ [select.data.id]: 'Unknown' }, { [select.data.id]: '' }, { [date.data.id]: '2026-02-30' }]) {
    assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values } })).status, 400);
  }
  assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values: { [select.data.id]: 'Production', [date.data.id]: '2026-02-28' } } })).status, 200);
});

test('browser cookies enforce CSRF, required password changes, renewal and logout revocation', async () => {
  const email = 'cookie-user@test.local';
  const initialPassword = 'initial-password-123';
  const userId = (await db.prepare('INSERT INTO users (name, email, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)')
    .run('Cookie user', email, bcrypt.hashSync(initialPassword, 4), 'manager')).lastInsertRowid;
  const loggedIn = await api('/api/auth/login', { method: 'POST', body: { email, password: initialPassword } });
  assert.equal(loggedIn.status, 200);
  const setCookie = loggedIn.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api/);
  assert.equal(loggedIn.headers.get('cache-control'), 'no-store');
  const cookie = setCookie.split(';')[0];
  const me = await api('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.id, userId);
  assert.equal(me.data.must_change_password, 1);
  const restricted = await api('/api/service-activities', { cookie });
  assert.equal(restricted.status, 403);
  assert.equal(restricted.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const exportDenied = await fetch(`${suiteFixture.baseUrl}/api/service-activities/export`, { headers: { Cookie: cookie } });
  assert.equal(exportDenied.status, 403);
  const body = { new_password: 'replacement-password-123' };
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, csrf: false, body })).status, 403);
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, origin: 'https://attacker.example', body })).status, 403);
  const changed = await api('/api/auth/change-password-first', { method: 'POST', cookie, body });
  assert.equal(changed.status, 200);
  const renewedCookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie })).status, 401);
  assert.equal((await api('/api/service-activities', { cookie: renewedCookie })).status, 200);
  const profile = await api('/api/auth/profile', { method: 'PUT', cookie: renewedCookie, body: { name: 'Cookie User', email: 'COOKIE-USER@TEST.LOCAL' } });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.email, email);
  const profileCookie = profile.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie: renewedCookie })).status, 401);
  const loggedOut = await api('/api/auth/logout', { method: 'POST', cookie: profileCookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api('/api/auth/me', { cookie: profileCookie })).status, 401);
  assert.equal((await api('/api/auth/me', { token: profile.data.token })).status, 401);
});
