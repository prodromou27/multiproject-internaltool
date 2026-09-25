const { test, assert, api, db, ids, createActivity, bcrypt, signJwt,  } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');

test('service activities validate follow-up dates, times, IDs, text and boolean inputs', async () => {
  const base = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: 'Validation review' };
  for (const invalid of [{ follow_up_date: '2026-02-30' }, { follow_up_date: {} }, { start_time: '25:00' },
    { end_time: '12:99' }, { category_id: {} }, { related_project_id: [] }, { change_reason: {} },
    { follow_up_required: 'false' }, { rollback_available: 'false' }]) {
    assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { ...base, ...invalid } })).status, 400, JSON.stringify(invalid));
  }
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { ...base, start_time: '09:00', end_time: '10:00', follow_up_required: true, follow_up_date: '2026-12-01' } });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { follow_up_date: 'not-a-date' } })).status, 400);
});

test('tracking blocks planners even in enabled teams and keeps PM activity access separate from task creation', async () => {
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Tracking ${role}`, `tracking-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, user);
    const token = signJwt({ id: user });
    const body = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: `Tracking ${role}` };
    assert.equal((await api('/api/service-activities/meta', { token })).status, role === 'planner' ? 403 : 200);
    const created = await api('/api/service-activities', { method: 'POST', token, body });
    assert.equal(created.status, role === 'planner' ? 403 : 200);
    if (role === 'pm') {
      assert.equal((await api(`/api/service-activities/${created.data.id}`, { token })).status, 200);
      assert.equal((await api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token })).status, 403);
      const other = await db.prepare('SELECT id FROM service_activities WHERE engineer_id=? LIMIT 1').get(ids.engineerEnabled);
      assert.equal((await api(`/api/service-activities/${other.id}`, { token })).status, 403);
    }
  }
});

test('tracking metadata exposes customer requirements only for authorized customers', async () => {
  await db.prepare('UPDATE customers SET require_ticket_reference=1 WHERE id=?').run(ids.customer);
  try {
    const meta = await api('/api/service-activities/meta', { token: ids.tokenEnabled });
    assert.equal(meta.status, 200);
    assert.equal(meta.data.customers.find(c => c.id === ids.customer).require_ticket_reference, 1);
    assert.ok(!meta.data.customers.some(c => c.id === ids.customerUnassigned));
  } finally { await db.prepare('UPDATE customers SET require_ticket_reference=0 WHERE id=?').run(ids.customer); }
});

test('the activity detail used for editing preserves notes, category and technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Edit detail technology')).lastInsertRowid;
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10),
    title: 'Full edit detail', description: 'Preserve these notes', technology_ids: [technology], ticket_reference: 'CASE-123',
  } });
  assert.equal(created.status, 200);
  const detail = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.customer_id, ids.customer);
  assert.equal(detail.data.category_id, ids.category);
  assert.equal(detail.data.description, 'Preserve these notes');
  assert.deepEqual(detail.data.technologies.map(t => t.id), [technology]);
  const edited = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { ...detail.data, title: 'Edited title', technology_ids: detail.data.technologies.map(t => t.id) } });
  assert.equal(edited.status, 200);
  const saved = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(saved.data.description, 'Preserve these notes');
  assert.equal(saved.data.ticket_reference, 'CASE-123');
  assert.deepEqual(saved.data.technologies.map(t => t.id), [technology]);
});

test('attachment upload failures clean files and attachment reads enforce activity ownership', async t => {
  const fs = require('fs');
  const path = require('path');
  const { uploadDir } = require('../uploadUtils');
  const activity = (await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10), title: 'Attachment regression',
  } })).data.id;
  const endpoint = `/api/service-activities/${activity}/attachments`;
  const uploadPdf = async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nTest document'], { type: 'application/pdf' }), 'test.pdf');
    const response = await fetch(`${fixture.baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenEnabled}` }, body: form });
    return { status: response.status, data: await response.json() };
  };
  const before = (await fs.promises.readdir(uploadDir)).sort();
  const originalPrepare = db.prepare;
  const failure = t.mock.method(db, 'prepare', function(sql) {
    if (/INSERT INTO attachments/i.test(sql)) return { run: async () => { throw new Error('Simulated attachment database failure'); } };
    return originalPrepare.call(this, sql);
  });
  try {
    assert.equal((await uploadPdf()).status, 500);
    assert.deepEqual((await fs.promises.readdir(uploadDir)).sort(), before);
  } finally { failure.mock.restore(); }
  const uploaded = await uploadPdf();
  assert.equal(uploaded.status, 200);
  const attachment = await db.prepare('SELECT stored_name FROM attachments WHERE id=?').get(uploaded.data.id);
  const storedPath = path.join(uploadDir, attachment.stored_name);
  try {
    assert.equal((await api(endpoint, { token: ids.tokenDisabled })).status, 403);
    const ownerList=await api(endpoint,{ token:ids.tokenEnabled });
    assert.equal(ownerList.status,200);assert.equal(ownerList.data[0].stored_name,undefined);assert.equal(ownerList.data[0].enc_iv,undefined);assert.equal(ownerList.data[0].enc_tag,undefined);
    assert.equal((await api(`${endpoint}/not-an-id/download`,{ token:ids.tokenEnabled })).status,400);
    const download = await fetch(`${fixture.baseUrl}${endpoint}/${uploaded.data.id}/download`, { headers: { Authorization: `Bearer ${ids.tokenDisabled}` } });
    assert.equal(download.status, 403);
    const ownerDownload=await fetch(`${fixture.baseUrl}${endpoint}/${uploaded.data.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenEnabled}` } });
    assert.equal(ownerDownload.status,200);assert.equal(ownerDownload.headers.get('cache-control'),'private, no-store');assert.equal(ownerDownload.headers.get('x-content-type-options'),'nosniff');
    const original = db.prepare;
    const deletionFailure = t.mock.method(db, 'prepare', function(sql) {
      if (/DELETE FROM attachments WHERE id/i.test(sql)) return { run: async () => { throw new Error('Simulated delete failure'); } };
      return original.call(this, sql);
    });
    try {
      assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 500);
      assert.equal(fs.existsSync(storedPath), true);
    } finally { deletionFailure.mock.restore(); }
    assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 200);
    assert.equal(fs.existsSync(storedPath), false);
  } finally {
    await fs.promises.unlink(storedPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});


test('activity edits reject stale versions without changing fields or technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Concurrent edit technology')).lastInsertRowid;
  const created = await createActivity({ title: 'Concurrent editing', description: 'Original', technology_ids: [technology] });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenManager });
  const options = { method: 'PUT', token: ids.tokenManager };
  const first = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Winning edit' } });
  assert.equal(first.status, 200);
  const stale = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Lost edit', technology_ids: [] } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'ACTIVITY_CONFLICT');
  const saved = await api(path, { token: ids.tokenManager });
  assert.equal(saved.data.description, 'Winning edit');
  assert.deepEqual(saved.data.technologies.map(item => item.id), [technology]);
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.equal((await api(path, { ...options, useCurrentVersion: false, body: { title: 'Missing version' } })).status, 428);
  assert.equal((await api(path, { ...options, body: { version: '1' } })).status, 400);
  assert.equal((await api(path, { ...options, body: { version: saved.data.version, description: 'Fresh edit' } })).status, 200);
});

test('list and export reject the same malformed filters', async () => {
  for (const query of ['customer_id=1x', 'category_id=-1', 'technology_id=0', 'from=2026-02-30', 'to=bad', 'from=2026-09-17&to=2026-09-01', 'page=1.5', 'page_size=201', 'page=9007199254740991', 'search=a&search=b', 'status[x]=planned']) {
    for (const route of ['/api/service-activities', '/api/service-activities/export']) {
      const result = await api(`${route}?${query}`, { token: ids.tokenManager });
      assert.equal(result.status, 400, `${route}?${query}`);
    }
  }
});

// pg-mem cannot execute the correlated technology predicate over these joins.
test('Excel export matches all list filters and exports the entire matching set', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Export consistency technology')).lastInsertRowid;
  for (let i = 0; i < 2; i++) await createActivity({ title: `Export consistency ${i}`, technology_ids: [technology], billable_classification: 'billable' });
  await createActivity({ title: 'Export consistency excluded', billable_classification: 'non_billable' });
  const query = new URLSearchParams({ customer_id: ids.customer, category_id: ids.category, technology_id: technology, status: 'planned', billable_classification: 'billable', search: 'Export consistency', from: '2026-01-01', to: '2026-01-31', page_size: 1 });
  const list = await api(`/api/service-activities?${query}`, { token: ids.tokenManager });
  assert.equal(list.status, 200);
  assert.equal(Number(list.data.total), 2);
  assert.equal(list.data.rows.length, 1);
  const response = await fetch(`${fixture.baseUrl}/api/service-activities/export?${query}`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(response.status, 200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], list.data.rows[0].activity_reference);
  assert.ok(rows.every(row => row[5].startsWith('Export consistency') && row[8] === 'billable'));
});


test('simultaneous edits allow exactly one write on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity({ title: 'Simultaneous edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenEnabled });
  const results = await Promise.all(['First writer', 'Second writer'].map(description => api(path, {
    method: 'PUT', token: ids.tokenEnabled, body: { version: snapshot.data.version, description },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await api(path, { token: ids.tokenEnabled });
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.ok(['First writer', 'Second writer'].includes(saved.data.description));
});

test('completion and follow-up creation invalidate older editing snapshots', async () => {
  const created = await createActivity({ title: 'Other mutations invalidate edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const token = ids.tokenEnabled;
  const before = (await api(path, { token })).data;
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  const completed = (await api(path, { token })).data;
  assert.equal(completed.version, before.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: before.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, completed.version);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  const linked = (await api(path, { token })).data;
  assert.equal(linked.version, completed.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: completed.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, linked.version);
});


test('management activity report export rejects non-managers including scoped download tokens', async () => {
  for (const role of ['planner', 'pm', 'engineer']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Report guard ${role}`, `report-guard-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/reports/service-activity/export', { token })).status, 403);
    const downloadToken = signJwt({ id: user, download: true });
    assert.equal((await api(`/api/reports/service-activity/export?token=${downloadToken}`)).status, 403);
  }
  for (const suffix of ['', `?token=${signJwt({ id: ids.manager, download: true })}`]) {
    const response = await fetch(`${fixture.baseUrl}/api/reports/service-activity/export${suffix}`, {
      headers: suffix ? {} : { Authorization: `Bearer ${ids.tokenManager}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    await response.arrayBuffer();
  }
});


test('task list and workbook export match filters and preserve ownership on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Dispatch project', ids.manager)).lastInsertRowid;
  const rows = [];
  for (const [title, status, priority, deadline, owner] of [
    ['Dispatch 100%_special', 'pending_approval', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch today', 'open', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch waiting', 'waiting_vendor', 'low', '2035-12-30', ids.engineerEnabled],
    ['Dispatch completed', 'completed', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch last day', 'open', 'high', '2036-01-06', ids.engineerEnabled],
    ['Dispatch outside', 'open', 'high', '2036-01-07', ids.engineerEnabled],
    ['Dispatch private', 'open', 'high', '2035-12-31', ids.engineerDisabled],
  ]) rows.push((await db.prepare('INSERT INTO tasks (title,status,priority,deadline,assigned_to,project_id,created_by) VALUES (?,?,?,?,?,?,?)').run(title, status, priority, deadline, owner, project, ids.manager)).lastInsertRowid);
  const cases = [
    [{ filter: 'pending_approval' }, [rows[0]]],
    [{ filter: 'due_today' }, [rows[0], rows[1]]],
    [{ filter: 'overdue' }, [rows[2]]],
    [{ filter: 'waiting_customer' }, [rows[2]]],
    [{ filter: 'due_week' }, [rows[0], rows[1], rows[4]]],
    [{ priority: 'low', search: '  dispatch  ' }, [rows[2]]],
    [{ search: '100%_special' }, [rows[0]]],
  ];
  for (const [extra, expected] of cases) {
    const query = new URLSearchParams({ project_id: String(project), as_of: '2035-12-31', sort: 'deadline', ...extra });
    const list = await api(`/api/tasks?${query}`, { token: ids.tokenEnabled });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.map(row => row.id), expected);
    const response = await fetch(`${fixture.baseUrl}/api/tasks/export?${query}`, { headers: { Authorization: `Bearer ${ids.tokenEnabled}` } });
    assert.equal(response.status, 200);
    const workbook = new (require('exceljs').Workbook)();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const titles = [];
    workbook.worksheets[0].eachRow((row, number) => { if (number > 1) titles.push(row.getCell(1).value); });
    assert.deepEqual(titles, list.data.map(row => row.title));
  }
  const spoof = await api(`/api/tasks?project_id=${project}&assigned_to=${ids.engineerDisabled}`, { token: ids.tokenEnabled });
  assert.ok(spoof.data.every(row => row.assigned_to === ids.engineerEnabled));
  const own = await api(`/api/tasks?project_id=${project}&assigned_to=${ids.engineerEnabled}`, { token: ids.tokenManager });
  assert.equal(own.data.length, 6);

});

test('task pages retain full totals, stable ordering, enrichment and unpaged exports on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Paged task fixture', ids.manager)).lastInsertRowid;
  const rows = [];
  for (let i = 0; i < 62; i++) rows.push((await db.prepare('INSERT INTO tasks (title,project_id,deadline,assigned_to,created_by) VALUES (?,?,?,?,?)').run(`Paged item ${i}`, project, '2042-03-01', i === 61 ? ids.engineerDisabled : ids.engineerEnabled, ids.manager)).lastInsertRowid);
  await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_id) VALUES (?,?)').run(rows[0], rows[60]);
  for (const hours of [0.35, 0.4]) await db.prepare('INSERT INTO time_logs (task_id,user_id,hours,logged_at) VALUES (?,?,?,?)').run(rows[25], ids.engineerEnabled, hours, '2042-03-01');
  const base = `project_id=${project}&sort=deadline&filter=open`;
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const response = await api(`/api/tasks?${base}&page=${page}&page_size=25`, { token: ids.tokenEnabled });
    assert.equal(response.status, 200);
    assert.equal(response.data.total, 61);
    assert.equal(response.data.counts.all, 61);
    assert.equal(response.data.counts.open, 61);
    assert.equal(response.data.rows.length, page === 3 ? 11 : 25);
    if (page === 1) assert.equal(response.data.rows[0].is_blocked, true);
    if (page === 2) assert.equal(response.data.rows[0].logged_hours, 0.8);
    found.push(...response.data.rows.map(row => row.id));
  }
  assert.deepEqual(found, rows.slice(0, 61));
  const legacy = await api(`/api/tasks?${base}`, { token: ids.tokenEnabled });
  assert.ok(Array.isArray(legacy.data));
  assert.equal(legacy.data.length, 61);
  const outside = await api(`/api/tasks?${base}&page=999`, { token: ids.tokenEnabled });
  assert.deepEqual(outside.data.rows, []);
  assert.equal(outside.data.total, 61);
  const narrowed = await api(`/api/tasks?${base}&page=1&search=Paged%20item%2060`, { token: ids.tokenEnabled });
  assert.equal(narrowed.data.total, 1);
  assert.equal(narrowed.data.counts.all, 1);
  const download = signJwt({ id: ids.engineerEnabled, download: true });
  const response = await fetch(`${fixture.baseUrl}/api/tasks/export?${base}&page=2&page_size=25&token=${download}`);
  assert.equal(response.status, 200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount, 62, 'header plus every matching task, independent of page');
});

test('saved custom reports protect private definitions, ownership and edit versions', async () => {
  const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Report peer manager','report-peer-manager@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
  const token = signJwt({ id: user });
  const body = { name: 'Private delivery report',visibility: 'private',definition: { source: 'tasks',fields: ['id','title'] } };
  const created = await api('/api/reports/custom/saved',{ method: 'POST',token: ids.tokenManager,body });
  assert.equal(created.status,201);
  const path = `/api/reports/custom/saved/${created.data.id}`;
  assert.equal((await api(path,{ token })).status,404);
  assert.equal((await api(`${path}/preview`,{ method: 'POST',token })).status,404);
  assert.equal((await api('/api/reports/custom/saved',{ token })).data.total,0);
  for (const roleToken of [ids.tokenEnabled,ids.tokenDisabled]) {
    assert.equal((await api(path,{ token: roleToken })).status,403);
    assert.equal((await api('/api/reports/custom/saved',{ method: 'POST',token: roleToken,body })).status,403);
  }
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: { ...body,visibility: 'shared',shared_user_ids: [ids.engineerEnabled],shared_team_ids: [],version: 1 } })).status,400);
  const direct = { ...body,visibility: 'shared',shared_user_ids: [user],shared_team_ids: [],version: 1 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: direct })).data.version,2);
  assert.deepEqual((await api(path,{ token: ids.tokenManager })).data.shared_user_ids,[user]);
  assert.deepEqual((await api(path,{ token })).data.shared_user_ids,[],'share membership is visible only to the owner');
  await db.prepare('INSERT INTO team_members (team_id,user_id) VALUES (?,?)').run(ids.teamEnabled,user);
  const teamShared = { ...body,visibility: 'shared',shared_user_ids: [],shared_team_ids: [ids.teamEnabled],version: 2 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: teamShared })).data.version,3);
  assert.equal((await api(path,{ token })).status,200,'manager team membership grants access');
  await db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(ids.teamEnabled,user);
  assert.equal((await api(path,{ token })).status,404,'team access is rechecked after membership removal');
  const shared = { ...body,visibility: 'management',version: 3 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: shared })).data.version,4);
  const other = await api(path,{ token });
  assert.equal(other.status,200);
  assert.equal(other.data.can_edit,false);
  assert.deepEqual(other.data.definition,body.definition);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...shared,version: 4 } })).status,403);
  assert.equal((await api(path,{ method: 'DELETE',token,body: { version: 4 } })).status,403);
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: shared })).status,409);
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: { ...body,version: 4 } })).data.version,5);
  assert.equal((await api(`${path}/preview`,{ method: 'POST',token })).status,404,'visibility is checked again on each run');
  assert.equal((await api(path,{ method: 'DELETE',token: ids.tokenManager,body: { version: 4 } })).status,409);
  assert.equal((await api(path,{ method: 'DELETE',token: ids.tokenManager,body: { version: 5 } })).status,200);
  assert.equal((await api(path,{ token: ids.tokenManager })).status,404);
});

test('malformed password expiry values cannot silently disable the policy', async () => {
  const save = value => api('/api/settings/security',{ method: 'PUT',token: ids.tokenManager,body: { password_expiry_days: value } });
  assert.equal((await save(90)).status,200);
  for (const value of ['', '0', '90days',false,null,-1,1.5,3651,{},[]]) assert.equal((await save(value)).status,400);
  assert.equal((await api('/api/settings/security',{ token: ids.tokenManager })).data.password_expiry_days,90);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='password_expiry_days'").get()).value,'90');
  assert.equal((await api('/api/settings/security',{ method: 'PUT',token: ids.tokenEnabled,body: { password_expiry_days: 0 } })).status,403);
  assert.equal((await save(0)).status,200,'explicit numeric zero remains supported');
  assert.equal((await api('/api/settings/security',{ token: ids.tokenManager })).data.password_expiry_days,0);
  assert.equal((await save(90)).status,200);
});

test('integration settings redact stored tokens and webhooks, preserve edits and validate requests', async () => {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('integrations',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ teams: { enabled: false,webhook_url: 'https://secret.example/webhook' },webex: { enabled: true,bot_token: 'retained-webex-token',mode: 'both' } }));
  const read = await api('/api/settings/integrations',{ token: ids.tokenManager });
  assert.equal(read.status,200);
  assert.equal(read.data.teams.webhook_url,'');
  assert.equal(read.data.teams.webhook_url_set,true);
  assert.equal(read.data.webex.bot_token,'');
  assert.equal(read.data.webex.bot_token_set,true);
  assert.equal(JSON.stringify(read.data).includes('retained-webex-token'),false);
  assert.equal((await api('/api/settings/integrations',{ token: ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body: { teams: { clear_webhook_url: true },webex: { mode: 'space',bot_token: '' } } })).status,200);
  let stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='integrations'").get()).value);
  assert.equal(stored.webex.bot_token,'retained-webex-token');
  assert.equal(stored.webex.mode,'space');
  assert.equal(stored.teams.webhook_url,'');
  assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body: { webex: { clear_bot_token: true } } })).status,200);
  stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='integrations'").get()).value);
  assert.equal(stored.webex.bot_token,'');
  for (const body of [[],{ teams: { enabled: 'false' } },{ teams: { webhook_url: 'https://127.0.0.1/private' } }]) assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body })).status,400);
});

test('Request Tracker settings are manager-only and never return or store a plaintext token',async () => {
  assert.equal((await api('/api/ticketing/settings',{ token:ids.tokenEnabled })).status,403);
  const previous=process.env.CUSTOMER_FIELD_KEY;process.env.CUSTOMER_FIELD_KEY='ef'.repeat(32);
  try {
    const saved=await api('/api/ticketing/settings',{ method:'PUT',token:ids.tokenManager,body:{ enabled:true,base_url:'https://8.8.8.8/rt/',api_token:'integration-secret',sync_interval_minutes:30 } });
    assert.equal(saved.status,200);assert.equal(saved.data.api_token,'');assert.equal(saved.data.api_token_set,true);assert.equal(saved.data.base_url,'https://8.8.8.8/rt');
    const stored=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='ticketing_rt'").get()).value);
    assert.match(stored.api_token,/^enc:/);assert.equal(JSON.stringify(stored).includes('integration-secret'),false);
    const read=await api('/api/ticketing/settings',{ token:ids.tokenManager });assert.equal(JSON.stringify(read.data).includes('integration-secret'),false);
    assert.equal((await api('/api/ticketing/settings',{ method:'PUT',token:ids.tokenManager,body:{ sync_interval_minutes:5 } })).status,400);
  } finally { if (previous===undefined) delete process.env.CUSTOMER_FIELD_KEY;else process.env.CUSTOMER_FIELD_KEY=previous; }
});
