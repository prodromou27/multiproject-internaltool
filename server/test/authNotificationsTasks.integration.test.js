const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');

test('notify() delivers to each recipient\'s own personal Teams webhook, honoring per-person opt-in', async () => {
  const notifications = require('../notifications');
  const hash = bcrypt.hashSync('pw', 4);
  const mk = async (name, role, extra = {}) => (await db.prepare('INSERT INTO users (name, email, password, role, notify_teams_enabled, notify_teams_webhook_url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, `${name.toLowerCase().replace(/\W/g, '')}@test.local`, hash, role, extra.on ? 1 : 0, extra.url || null)).lastInsertRowid;
  const optedIn = await mk('Notify Manager In', 'manager', { on: true, url: 'https://93.184.216.34/manager-in' });
  await mk('Notify Manager Off', 'manager', { on: false, url: 'https://93.184.216.34/manager-off' });
  const engineer = await mk('Notify Engineer', 'engineer', { on: true, url: 'https://93.184.216.34/engineer' });
  await db.prepare("INSERT INTO settings (key, value) VALUES ('integrations', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
    .run(JSON.stringify({ teams: { enabled: false }, webex: { enabled: false }, notify_on: {} }));
  const posted = [];
  notifications._setTransport(async (u) => { posted.push(u.pathname); return { status: 200, body: '', headers: {} }; });
  try {
    const settle = () => new Promise(resolve => setTimeout(resolve, 300)); // notify() is fire-and-forget via setImmediate
    notifications.notify('report.submitted', { visit_title: 'V', customer_name: 'C', engineer_name: 'E' });
    await settle();
    // Every opted-in manager is reached; managers who haven't opted in aren't.
    assert.equal(posted.includes('/manager-in'), true);
    assert.equal(posted.includes('/manager-off'), false);
    assert.equal(posted.includes('/engineer'), false); // not a manager, not the recipient of this event
    posted.length = 0;
    notifications.notify('task.assigned', { engineer_id: engineer, engineer_name: 'Notify Engineer', task_title: 'T' });
    await settle();
    assert.deepEqual(posted, ['/engineer']); // single-recipient event: only that engineer's own webhook
  } finally { notifications._setTransport(); }
  assert.ok(optedIn);
});

test('notification preferences default correctly, validate their input, and persist without re-issuing a session', async () => {
  const passwordHash = bcrypt.hashSync('pw', 4);
  const target = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Notification prefs user', 'notify-prefs@test.local', passwordHash, 'engineer')).lastInsertRowid;
  const token = signJwt({ id: target });
  const initial = await api('/api/auth/me', { token });
  // Webex DM is an opt-out of something that already existed — on by default.
  // Personal Teams/email are brand-new channels nobody has opted into — off by default.
  assert.equal(initial.data.notify_external_enabled, 1);
  assert.equal(initial.data.notify_teams_enabled, 0);
  assert.equal(initial.data.notify_teams_webhook_set, false);
  assert.equal('notify_teams_webhook_url' in initial.data, false); // the URL itself is never sent to the browser
  assert.equal(typeof initial.data.email_delivery_available, 'boolean');
  assert.equal(initial.data.notify_email_enabled, 0);
  // An empty body is a valid no-op (partial-update design: send only what you're changing).
  const noop = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: {} });
  assert.equal(noop.status, 200);
  assert.deepEqual(noop.data, { notify_external_enabled: true, notify_teams_enabled: false, notify_email_enabled: false, notify_teams_webhook_set: false, email_delivery_available: noop.data.email_delivery_available });
  for (const bad of [{ notify_external_enabled: 'yes' }, { notify_external_enabled: 1 }, { notify_external_enabled: null },
    { notify_teams_enabled: 'yes' }, { notify_email_enabled: 'yes' }, { notify_teams_webhook_url: 123 }]) {
    assert.equal((await api('/api/auth/notification-preferences', { method: 'PUT', token, body: bad })).status, 400);
  }
  // Can't enable the personal Teams channel with no URL set — same "enabled needs a destination" rule as the admin integration.
  assert.equal((await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_enabled: true } })).status, 400);
  // The webhook URL is validated the same way the admin's org-wide one is (SSRF protection) — a private-network target is rejected.
  assert.equal((await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_webhook_url: 'http://127.0.0.1/hook' } })).status, 400);
  const withUrl = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_webhook_url: 'https://93.184.216.34/hook' } });
  assert.equal(withUrl.status, 200);
  assert.equal(withUrl.data.notify_teams_webhook_set, true);
  assert.equal(JSON.stringify(withUrl.data).includes('93.184.216.34'), false); // never echoed back, even to its owner
  // Now that a URL is on file, enabling it in the same request (or a later one) works.
  const teamsOn = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_enabled: true } });
  assert.equal(teamsOn.status, 200);
  assert.equal(teamsOn.data.notify_teams_enabled, true);
  const emailOn = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_email_enabled: true } });
  assert.equal(emailOn.status, 200);
  assert.equal(emailOn.data.notify_email_enabled, true);
  const off = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_external_enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.notify_external_enabled, false);
  assert.equal(off.data.notify_teams_enabled, true);
  assert.equal(off.data.notify_teams_webhook_set, true);
  assert.equal(off.data.notify_email_enabled, true);
  assert.equal((await db.prepare('SELECT notify_external_enabled FROM users WHERE id=?').get(target)).notify_external_enabled, 0);
  // Unlike PUT /profile, this doesn't touch token_version or issue a new token — the same token keeps working.
  assert.equal((await api('/api/auth/me', { token })).status, 200);
  // Clearing the URL also turns the toggle back off server-side — an empty destination can't stay "enabled".
  const cleared = await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_webhook_url: '' } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.notify_teams_webhook_set, false);
  assert.equal(cleared.data.notify_teams_enabled, false);
  // Personal test buttons: reject bad channels, and report a real, specific error instead of pretending success.
  assert.equal((await api('/api/auth/notification-preferences/test', { method: 'POST', token, body: { channel: 'sms' } })).status, 400);
  const noUrl = await api('/api/auth/notification-preferences/test', { method: 'POST', token, body: { channel: 'teams' } });
  assert.equal(noUrl.status, 400);
  assert.match(noUrl.data.error, /Save a Teams webhook URL first/);
  const notifications = require('../notifications');
  await api('/api/auth/notification-preferences', { method: 'PUT', token, body: { notify_teams_webhook_url: 'https://93.184.216.34/mine' } });
  const posted = [];
  notifications._setTransport(async (u) => { posted.push(u.pathname); return { status: 200, body: '', headers: {} }; });
  try {
    const ok = await api('/api/auth/notification-preferences/test', { method: 'POST', token, body: { channel: 'teams' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(posted, ['/mine']);
  } finally { notifications._setTransport(); }
});

test('2FA partial tokens do not grant cookie-based access', async () => {
  const partial = signJwt({ id: ids.manager, partial: true }, { expiresIn: '5m' });
  const result = await api('/api/auth/me', { cookie: `solutionshub_session=${partial}` });
  assert.equal(result.status, 401);
  assert.match(result.data.error, /scope/);
});

test('password endpoints reject malformed and bcrypt-truncated passwords', async () => {
  for (const new_password of [null, {}, [], 'short', 'x'.repeat(73), 'é'.repeat(37)]) {
    for (const path of ['/change-password', '/change-password-first', '/reset-password']) {
      const result = await api(`/api/auth${path}`, { method: 'POST', token: ids.tokenManager,
        body: { new_password, current_password: 'pw', token: 'reset-token' } });
      assert.equal(result.status, 400, `${path}: ${JSON.stringify(new_password)}`);
    }
  }
  assert.equal((await api('/api/auth/forgot-password', { method: 'POST', body: { email: {} } })).status, 400);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body: { token: {}, new_password: 'valid-password-123' } })).status, 400);
});

test('reset tokens are single-use and revoke previous sessions', async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Reset user', 'reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, hash, new Date(Date.now() + 3600000).toISOString());
  const session = signJwt({ id: user, token_version: 0 });
  const body = { token, new_password: 'new-reset-password-123' };
  const first = await api('/api/auth/reset-password', { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body })).status, 400);
  assert.equal((await api('/api/auth/me', { token: session })).status, 401);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(body.new_password, stored.password), true);
  assert.equal(stored.token_version, 1);
});

test('concurrent reset requests consume a token only once on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Concurrent reset user', 'concurrent-reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600000).toISOString());
  const results = await Promise.all([0, 1].map(i => api('/api/auth/reset-password', {
    method: 'POST', body: { token, new_password: `concurrent-password-${i}` },
  })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const winner = results.findIndex(r => r.status === 200);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(`concurrent-password-${winner}`, stored.password), true);
  assert.equal(stored.token_version, 1);
});

test('task edits can clear assignments and validate fields and relationships', async () => {
  const created = await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: '  Assignment test  ', assigned_to: ids.engineerEnabled, deadline: '2026-10-15' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/tasks/${created.data.id}`;
  assert.equal((await db.prepare('SELECT title FROM tasks WHERE id=?').get(created.data.id)).title, 'Assignment test');
  for (const body of [{ title: {} }, { title: '' }, { title: 'x'.repeat(501) }, { description: [] },
    { deadline: '2026-02-30' }, { priority: '' }, { assigned_to: ids.manager }, { assigned_to: 99999999 }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { assigned_to: null, deadline: null } })).status, 200);
  const task = await db.prepare('SELECT assigned_to, deadline FROM tasks WHERE id=?').get(created.data.id);
  assert.equal(task.assigned_to, null);
  assert.equal(task.deadline, null);
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Missing project', project_id: 99999999 } })).status, 400);
});

test('bulk task edits respect role boundaries and clear waiting notes', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Bulk project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title, project_id, assigned_to, created_by, status, pending_from_customer) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Bulk task', project, ids.engineerEnabled, ids.manager, 'waiting_customer', 'Old waiting note')).lastInsertRowid;
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Bulk ${role}`, `bulk-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: signJwt({ id: user }),
      body: { ids: [task], action: 'status', status: 'completed' } })).status, 403);
  }
  const body = { ids: [task], action: 'status', status: 'in_progress' };
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenDisabled, body })).data.affected, 0);
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body })).data.affected, 1);
  const stored = await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.pending_from_customer, null);
});

test('bulk waiting updates validate reasons, count unique owned tasks and preserve legacy notes', async () => {
  const taskIds = [];
  for (const owner of [ids.engineerEnabled, ids.engineerEnabled, ids.engineerDisabled]) {
    taskIds.push((await db.prepare('INSERT INTO tasks (title, assigned_to, created_by, pending_from_customer) VALUES (?, ?, ?, ?)')
      .run('Bulk waiting validation', owner, ids.manager, 'Existing note')).lastInsertRowid);
  }
  const body = { ids: [...taskIds, taskIds[0]], action: 'status', status: 'waiting_vendor', pending_from_customer: '  Awaiting credentials  ' };
  for (const reason of [null, 123, '', '   ', 'x'.repeat(10001)]) {
    assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...body, pending_from_customer: reason } })).status, 400);
  }
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...body, ids: [Number.MAX_SAFE_INTEGER + 1] } })).status, 400);
  const response = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(response.status, 200);
  assert.equal(response.data.affected, 2);
  for (const task of taskIds.slice(0, 2)) {
    assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'waiting_vendor', pending_from_customer: 'Awaiting credentials' });
  }
  assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(taskIds[2]),
    { status: 'open', pending_from_customer: 'Existing note' });
  const legacy = { ids: taskIds.slice(0, 2), action: 'status', status: 'waiting_customer' };
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: legacy })).data.affected, 2);
  assert.equal((await db.prepare('SELECT pending_from_customer FROM tasks WHERE id=?').get(taskIds[0])).pending_from_customer, 'Awaiting credentials');
  await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...legacy, status: 'in_progress' } });
  assert.equal((await db.prepare('SELECT pending_from_customer FROM tasks WHERE id=?').get(taskIds[0])).pending_from_customer, null);
});

test('bulk edits recheck engineer ownership when the update executes', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Reassigned during bulk save', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const originalPrepare = db.prepare;
  let signalReached, release;
  const reached = new Promise(resolve => { signalReached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let request;
  try {
    db.prepare = function (sql) {
      const statement = originalPrepare.call(db, sql);
      if (/^UPDATE tasks SET status=\?/.test(sql)) return { ...statement, async run(...params) {
        signalReached();
        await gate;
        return statement.run(...params);
      } };
      return statement;
    };
    request = api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled,
      body: { ids: [task], action: 'status', status: 'waiting_vendor', pending_from_customer: 'Private reason' } });
    await reached;
    await originalPrepare.call(db, 'UPDATE tasks SET assigned_to=? WHERE id=?').run(ids.engineerDisabled, task);
    release();
    const response = await request;
    assert.equal(response.status, 200);
    assert.equal(response.data.affected, 0);
    assert.deepEqual(await originalPrepare.call(db, 'SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'open', pending_from_customer: null });
  } finally {
    release();
    if (request) await request;
    db.prepare = originalPrepare;
  }
});

test('bulk task updates roll back every row if PostgreSQL rejects a row', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const taskIds = [];
  for (let i = 0; i < 2; i++) taskIds.push((await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Atomic bulk failure', ids.engineerEnabled, ids.manager)).lastInsertRowid);
  try {
    await db.exec(`CREATE FUNCTION test_reject_bulk_task() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = ${taskIds[1]} THEN RAISE EXCEPTION 'Simulated row failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject_bulk_task BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION test_reject_bulk_task();`);
    const response = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled,
      body: { ids: taskIds, action: 'status', status: 'waiting_vendor', pending_from_customer: 'Must save together' } });
    assert.equal(response.status, 500);
    for (const task of taskIds) assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'open', pending_from_customer: null });
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS test_reject_bulk_task ON tasks; DROP FUNCTION IF EXISTS test_reject_bulk_task();');
  }
});

test('time logs enforce task visibility, ownership and private summaries', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Time log task', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const body = { task_id: task, hours: 1.5, description: 'Work performed' };
  assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenDisabled, body })).status, 403);
  const created = await api('/api/time-logs', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/time-logs?task_id=${task}`, { token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`/api/time-logs/${created.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 403);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Time ${role}`, `time-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api(`/api/time-logs?task_id=${task}`, { token })).status, 403);
    assert.equal((await api('/api/time-logs', { method: 'POST', token, body })).status, 403);
    const summary = await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token });
    assert.equal(summary.status, 200);
    assert.equal(Number(summary.data.total), 0);
  }
  assert.equal(Number((await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token: ids.tokenManager })).data.total), 1.5);
});

test('time log input validation rejects malformed targets, hours and dates', async () => {
  for (const body of [{ task_id: -1, hours: 1 }, { task_id: {}, hours: 1 }, { task_id: 1, hours: true },
    { task_id: 1, hours: [1] }, { task_id: 1, hours: 'Infinity' }, { task_id: 1, hours: 25 },
    { task_id: 1, hours: 1, description: {} }, { task_id: 1, visit_id: 1, hours: 1 }]) {
    assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  for (const path of ['/api/time-logs?task_id=abc', '/api/time-logs/mine?from=2026-02-30&to=2026-03-01',
    '/api/time-logs/summary?month=2026-13', '/api/time-logs/summary?user_id=abc']) {
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400, path);
  }
});

test('customer contracts validate merged dates and allow clearing optional fields', async () => {
  const created = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: {
    name: 'Contract edit customer', customer_code: 'EDIT', contract_type: 'MSP',
    contract_start_date: '2026-01-01', contract_end_date: '2026-12-31', included_hours: 20,
  } });
  assert.equal(created.status, 200);
  const endpoint = `/api/customers/${created.data.id}`;
  for (const body of [{ name: {} }, { included_hours: -1 }, { included_hours: 'Infinity' },
    { included_hours: [] }, { contract_start_date: '2026-02-30' }, { contract_end_date: '2025-12-31' }, { notes: {} }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { notes: 'Updated notes' } })).status, 200);
  let stored = await db.prepare('SELECT contract_start_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.equal(stored.contract_start_date, '2026-01-01');
  assert.equal(Number(stored.included_hours), 20);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { customer_code: '', contract_type: null, contract_start_date: '', contract_end_date: null, included_hours: '' } })).status, 200);
  stored = await db.prepare('SELECT customer_code, contract_type, contract_start_date, contract_end_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.ok(Object.values(stored).every(value => value === null));
  if (process.env.TEST_DATABASE_URL) {
    const page=await api('/api/customers?paged=1&page=1&page_size=1&search=Contract%20edit&view=all',{ token:ids.tokenManager });
    assert.equal(page.status,200);assert.equal(page.data.rows.length,1);assert.ok(page.data.total>=1);assert.ok(page.data.counts.all>=1);
    assert.equal((await api('/api/customers?paged=1&page=0',{ token:ids.tokenManager })).status,400);
  }
  assert.equal((await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: [] } })).status, 400);
});

test('projects validate memberships, calendar dates, status updates and pin access', async () => {
  for (const body of [{ title: 'Invalid members', member_ids: {} }, { title: 'Invalid date', deadline: '2026-02-30' },
    { title: 'Wrong role', member_ids: [ids.manager] }]) {
    assert.equal((await api('/api/projects', { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const created = await api('/api/projects', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Project review', deadline: '2026-12-01', member_ids: [ids.engineerEnabled] } });
  assert.equal(created.status, 200);
  const endpoint = `/api/projects/${created.data.id}`;
  if (process.env.TEST_DATABASE_URL) {
    const page=await api('/api/projects?paged=1&page=1&page_size=1&search=Project%20review&status=open&rag=all',{ token:ids.tokenManager });
    assert.equal(page.status,200);assert.equal(page.data.rows[0].id,created.data.id);assert.equal(page.data.total,1);assert.equal(page.data.counts.open,1);
    assert.equal((await api('/api/projects?paged=1&page_size=101',{ token:ids.tokenManager })).status,400);
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { deadline: null } })).status, 200);
  assert.equal((await db.prepare('SELECT deadline FROM projects WHERE id=?').get(created.data.id)).deadline, null);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  for (const message of [{}, '   ']) {
    assert.equal((await api(`${endpoint}/status-update`, { method: 'POST', token: ids.tokenManager, body: { message } })).status, 400);
  }
  assert.equal((await api('/api/projects/99999999/status-update', { method: 'POST', token: ids.tokenManager, body: { message: 'Missing project' } })).status, 404);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
  const updates = await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(created.data.id);
  assert.equal(updates.length, 2);
});

test('concurrent project closure requests and approvals write one update each on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Concurrent closure', ids.manager)).lastInsertRowid;
  for (const action of ['request-closure', 'approve-closure']) {
    const results = await Promise.all([0, 1, 2].map(() => api(`/api/projects/${project}/${action}`, { method: 'POST', token: ids.tokenManager })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 409].includes(r.status)));
  }
  assert.equal((await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(project)).length, 2);
});

test('maintenance visits validate dates, assignments and engineer notes', async () => {
  const asset=(await api(`/api/customers/${ids.customer}/assets`,{ method:'POST',token:ids.tokenManager,body:{ name:'Visit gateway',asset_tag:'VISIT-GW-1',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' } })).data;
  const other=(await api(`/api/customers/${ids.customerUnassigned}/assets`,{ method:'POST',token:ids.tokenManager,body:{ name:'Other visit gateway',asset_tag:'VISIT-GW-2',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' } })).data;
  const body = { title: 'Reviewed visit', customer_id: ids.customer, scheduled_date: '2026-11-01', engineer_ids: [ids.engineerEnabled],asset_ids:[asset.id] };
  for (const invalid of [{ ...body, scheduled_date: '2026-02-30' }, { ...body, engineer_ids: [ids.manager] }, { ...body, notes: {} }]) {
    assert.equal((await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  assert.equal((await api('/api/maintenance-visits',{ method:'POST',token:ids.tokenManager,body:{ ...body,title:'Wrong asset',asset_ids:[other.id] } })).status,400);
  assert.equal((await api(`/api/maintenance-visits/assets/choices?customer_id=${ids.customer}`,{ token:ids.tokenEnabled })).status,403);
  const choices=await api(`/api/maintenance-visits/assets/choices?customer_id=${ids.customer}`,{ token:ids.tokenManager });
  assert.equal(choices.data.some(row => row.id===asset.id),true);
  const endpoint = `/api/maintenance-visits/${created.data.id}`;
  assert.deepEqual((await api(endpoint,{ token:ids.tokenManager })).data.asset_ids,[asset.id]);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { notes: 'Private' } })).status, 403);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: 'Engineer notes' } })).status, 200);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { title: 'Rescheduled visit', engineer_ids: [ids.engineerDisabled] } })).status, 200);
  const assigned = await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id=?').all(created.data.id);
  assert.deepEqual(assigned, [{ user_id: ids.engineerDisabled }]);
});

test('maintenance report transitions preserve original attribution and clear downstream flags', async () => {
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(ids.customer, 'Report transitions', '2026-11-01', 'in_progress', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  const endpoint = `/api/maintenance-visits/${visit}`;
  const planner = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Report planner', 'report-planner@test.local', bcrypt.hashSync('pw', 4), 'planner')).lastInsertRowid;
  const plannerToken = signJwt({ id: planner });
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT report_sent_by FROM maintenance_visits WHERE id=?').get(visit)).report_sent_by, ids.engineerEnabled);
  for (const token of [plannerToken, ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api(`${endpoint}/report-unsent`, { method: 'POST', token })).status, 403);
  }
  assert.equal((await db.prepare('SELECT report_sent FROM maintenance_visits WHERE id=?').get(visit)).report_sent, 1);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: plannerToken })).status, 200);
  assert.equal((await api(`${endpoint}/report-customer-unsent`, { method: 'POST', token: plannerToken })).status, 200);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`${endpoint}/report-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  let stored = await db.prepare('SELECT status, report_sent, report_sent_to_customer, report_sent_to_customer_by FROM maintenance_visits WHERE id=?').get(visit);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.report_sent, 0);
  assert.equal(stored.report_sent_to_customer, 0);
  assert.equal(stored.report_sent_to_customer_by, null);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 400);
  await db.prepare("UPDATE maintenance_visits SET status='completed' WHERE id=?").run(visit);
  assert.equal((await api(`${endpoint}/report-customer-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT status FROM maintenance_visits WHERE id=?').get(visit)).status, 'completed');
  await db.prepare("UPDATE maintenance_visits SET status='cancelled' WHERE id=?").run(visit);
  for (const action of ['report-sent', 'report-customer-sent', 'complete']) {
    assert.equal((await api(`${endpoint}/${action}`, { method: 'POST', token: ids.tokenManager })).status, 400);
  }
  assert.equal((await api('/api/maintenance-visits/99999999/report-customer-unsent', { method: 'POST', token: ids.tokenManager })).status, 404);
});

test('admin user input validation, duplicate emails and email clearing return predictable results', async () => {
  const body = { name: 'Admin test engineer', email: 'admin-test@test.local', password: 'new-password-123', role: 'engineer' };
  for (const invalid of [{ ...body, name: {} }, { ...body, email: {} }, { ...body, password: {} }, { ...body, password: 'x'.repeat(73) }]) {
    assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body })).status, 409);
  const endpoint = `/api/admin/users/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { name: {} } })).status, 400);
  assert.equal((await api(`${endpoint}/reset-password`, { method: 'POST', token: ids.tokenManager, body: { password: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { email: null } })).status, 200);
  assert.equal((await db.prepare('SELECT email FROM users WHERE id=?').get(created.data.id)).email, null);
  assert.equal((await api(`/api/admin/users/${ids.manager}/toggle-active`, { method: 'POST', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`/api/admin/users/${ids.manager}`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenEnabled, body })).status, 403);
});

test('admin session revocation bumps token_version without deactivating or resetting the password', async () => {
  // A dedicated throwaway user — this test intentionally invalidates its
  // token, so it must not be one of the shared ids.* fixtures other tests
  // in this file continue to rely on.
  const passwordHash = bcrypt.hashSync('pw', 4);
  const target = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Revocation target', 'revocation-target@test.local', passwordHash, 'engineer')).lastInsertRowid;
  const targetToken = signJwt({ id: target });
  const before = (await db.prepare('SELECT token_version, password FROM users WHERE id=?').get(target));
  const forbidden = await api(`/api/admin/users/${target}/revoke-sessions`, { method: 'POST', token: targetToken });
  assert.equal(forbidden.status, 403); // manager-only, same as every other /admin/users route
  const self = await api(`/api/admin/users/${ids.manager}/revoke-sessions`, { method: 'POST', token: ids.tokenManager });
  assert.equal(self.status, 400);
  assert.equal((await api('/api/admin/users/99999999/revoke-sessions', { method: 'POST', token: ids.tokenManager })).status, 404);
  const result = await api(`/api/admin/users/${target}/revoke-sessions`, { method: 'POST', token: ids.tokenManager });
  assert.equal(result.status, 200);
  const after = (await db.prepare('SELECT token_version, password, active FROM users WHERE id=?').get(target));
  assert.equal(after.token_version, before.token_version + 1);
  assert.equal(after.password, before.password); // unchanged — this isn't a password reset
  assert.equal(after.active, 1); // unchanged — this isn't a deactivation
  // The user's existing token is now stale and must be rejected, like any other token_version bump.
  assert.equal((await api('/api/customers', { token: targetToken })).status, 401);
});

test('the final active manager cannot demote themselves', async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Final manager', 'final-manager@test.local', bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid;
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    assert.equal((await api(`/api/admin/users/${user}`, { method: 'PUT', token: signJwt({ id: user }), body: { role: 'engineer' } })).status, 400);
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').get(user)).role, 'manager');
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    await db.prepare('UPDATE users SET active=0 WHERE id=?').run(user);
  }
});

test('concurrent manager self-demotions preserve an active manager on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const managers = [];
  for (const suffix of ['a', 'b']) managers.push((await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(`Concurrent manager ${suffix}`, `concurrent-manager-${suffix}@test.local`, bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid);
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    const results = await Promise.all(managers.map(id => api(`/api/admin/users/${id}`, {
      method: 'PUT', token: signJwt({ id }), body: { role: 'engineer' },
    })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 401].includes(r.status)));
    const remaining = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='manager' AND active=1").get();
    assert.equal(Number(remaining.c), 1);
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    for (const id of managers) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
  }
});

test('personal notes and todos reject malformed values and isolate users', async () => {
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: {} } })).status, 400);
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: 'Private scratchpad' } })).status, 200);
  assert.equal((await api('/api/notes/note', { token: ids.tokenEnabled })).data.content, 'Private scratchpad');
  assert.equal((await api('/api/notes/note', { token: ids.tokenDisabled })).data.content, '');
  assert.equal((await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: {} } })).status, 400);
  const created = await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: 'Private todo' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/notes/todos/${created.data.id}`;
  for (const body of [{ title: {} }, { done: 'false' }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body })).status, 400);
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { done: true } })).status, 404);
  assert.equal((await api(endpoint, { method: 'DELETE', token: ids.tokenDisabled })).status, 200);
  assert.equal((await api('/api/notes/todos', { token: ids.tokenEnabled })).data.length, 1);
});

// pg-mem does not implement the correlated customer-count subqueries used by search.
test('quick and smart search enforce task roles and PM project visibility', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Search review project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO tasks (title, created_by, assigned_to) VALUES (?, ?, ?)').run('Search review private task', ids.manager, ids.engineerEnabled);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Search ${role}`, `search-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    const quick = await api('/api/search?q=Search%20review', { token });
    assert.equal(quick.status, 200);
    assert.deepEqual(quick.data.tasks, []);
    const smart = await api('/api/search/smart?entity=tasks&q=Search%20review', { token });
    assert.equal(smart.status, 200);
    assert.deepEqual(smart.data.tasks, []);
    const projects = await api('/api/search/smart?entity=projects&q=Search%20review', { token });
    assert.equal(projects.status, 200);
    assert.equal(projects.data.projects.some(p => p.id === project), role === 'pm');
    assert.equal(quick.data.projects.some(p => p.id === project), role === 'pm');
  }
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenEnabled })).data.tasks.length, 1);
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenDisabled })).data.tasks.length, 0);
  for (const path of ['/api/search?q[a]=test', '/api/search/smart?q[a]=test', '/api/search/smart?entity=unknown'])
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400);
});
