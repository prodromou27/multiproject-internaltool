const { afterSeed, test, assert, api, db, ids, createActivity, seedCustomerWork, bcrypt, signJwt } = require('./lib/activityFixture');

afterSeed(seedCustomerWork);

test('operational overview scopes work and aggregates more than one activity page', async () => {
  const engineer = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Overview Engineer', 'overview-engineer@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, engineer);
  const token = signJwt({ id: engineer });
  const ownProject = (await db.prepare('INSERT INTO projects (title, deadline, updated_at, created_by) VALUES (?, ?, ?, ?)').run('Overview own project', '2026-09-18', '2026-09-01 00:00:00', ids.manager)).lastInsertRowid;
  const privateProject = (await db.prepare('INSERT INTO projects (title, deadline, created_by) VALUES (?, ?, ?)').run('Overview private project', '2026-09-15', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(ownProject, engineer);
  for (const [title, assigned, deadline] of [['Own overdue', engineer, '2026-09-16'], ['Own today', engineer, '2026-09-17'], ['Private overdue', ids.engineerEnabled, '2026-09-01']]) {
    await db.prepare('INSERT INTO tasks (title, assigned_to, deadline, created_by) VALUES (?, ?, ?, ?)').run(title, assigned, deadline, ids.manager);
  }
  const resolved = (await db.prepare("INSERT INTO tasks (title, status, assigned_to, created_by) VALUES (?, 'completed', ?, ?)").run('Resolved follow-up', engineer, ids.manager)).lastInsertRowid;
  for (const [title, assigned, status, date] of [['Own report', engineer, 'completed', '2026-09-16'], ['Own upcoming', engineer, 'scheduled', '2026-09-20'], ['Private report', ids.engineerEnabled, 'completed', '2026-09-15']]) {
    const visit = (await db.prepare('INSERT INTO maintenance_visits (title, customer_id, status, scheduled_date, created_by) VALUES (?, ?, ?, ?, ?)').run(title, ids.customer, status, date, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, assigned);
  }
  await db.transaction(async tx => {
    for (let i = 0; i < 102; i++) await tx.prepare(`INSERT INTO service_activities
      (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, duration_minutes,
       status, follow_up_required, follow_up_date, follow_up_task_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`ACT-2026-${800000 + i}`, ids.customer, ids.teamEnabled, engineer, i === 101 ? '2026-08-01' : '2026-09-17', ids.category,
        `Overview activity ${i}`, 60, i === 3 ? 'cancelled' : 'completed', i < 4 || i === 101 ? 1 : 0,
        i === 2 ? '2026-09-18' : '2026-09-16', i === 1 ? resolved : null, engineer);
  });
  const result = await api(`/api/operations/overview?as_of=2026-09-17&engineer_id=${ids.engineerEnabled}&team_id=${ids.teamDisabled}`, { token });
  assert.equal(result.status, 200);
  const overview = result.data;
  assert.equal(overview.scope, 'personal');
  assert.equal(overview.tasks.open, 2);
  assert.equal(overview.tasks.overdue, 1);
  assert.equal(overview.tasks.due_today, 1);
  assert.ok(overview.tasks.attention.every(task => !task.title.includes('Private')));
  assert.equal(overview.projects.active, 1);
  assert.equal(overview.projects.stale, 1);
  assert.ok(overview.projects.commitments.every(project => project.id === ownProject));
  assert.equal(overview.visits.reports_pending, 1);
  assert.equal(overview.visits.upcoming, 1);
  assert.deepEqual(overview.visits.reports.map(visit => visit.title), ['Own report']);
  assert.equal(overview.service.enabled, true);
  assert.equal(overview.service.today, 101);
  assert.equal(overview.service.week, 101);
  assert.equal(overview.service.hours, 101);
  assert.equal(overview.service.customers, 1);
  assert.equal(overview.service.pending, 3, 'completed activities may still need follow-up; completed tasks and cancelled activities do not');
  assert.equal(overview.service.due, 2, 'include due follow-ups from outside the current week');
  assert.equal(overview.service.follow_ups.length, 2);
  assert.equal(overview.service.recent.length, 5);
  assert.equal(overview.week_from, '2026-09-14');
  assert.equal(overview.week_to, '2026-09-20');
  for (const section of [overview.tasks.attention, overview.projects.commitments, overview.visits.reports, overview.visits.upcoming_items, overview.service.follow_ups]) assert.ok(section.length <= 5);
  const queuedReport=(await db.prepare(`INSERT INTO managed_report_history
    (customer_id,period_start,period_end,output_format,report_version,status,workflow_status,original_name,stored_name,mime_type,size,sections,generated_by,enc_iv,enc_tag)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(ids.customer,'2026-09-01','2026-09-15','pdf',1,'generated','draft','report.pdf','stored-report.pdf','application/pdf',1,'[]',ids.manager,'iv','tag'));
  await db.prepare("UPDATE managed_report_history SET workflow_status='in_review',submitted_at='2026-09-15 10:00:00' WHERE id=?").run(queuedReport.id);
  const management = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenManager });
  assert.equal(management.status, 200);
  assert.equal(management.data.scope, 'management');
  assert.ok(management.data.projects.active > overview.projects.active);
  assert.ok(management.data.tasks.overdue > overview.tasks.overdue);
  assert.equal(management.data.approvals.managed_reports,1);
  assert.equal(management.data.approvals.reports[0].customer_name,'Acme Corp');
  assert.deepEqual(overview.approvals,{ managed_reports:0,reports:[] });
  await db.prepare("UPDATE managed_report_history SET workflow_status='draft',submitted_at=NULL WHERE id=?").run(queuedReport.id);
});

test('customer operational summary is bounded and respects customer scope',async () => {
  const path=`/api/customers/${ids.customer}/operations/summary`;
  assert.equal((await api(path)).status,401);
  for (const invalid of ['0','bad','9007199254740992']) assert.equal((await api(`/api/customers/${invalid}/operations/summary`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api('/api/customers/99999999/operations/summary',{ token:ids.tokenManager })).status,404);
  const manager=await api(path,{ token:ids.tokenManager });
  assert.equal(manager.status,200);assert.equal(typeof manager.data.projects.active,'number');assert.equal(typeof manager.data.tasks.open,'number');
  assert.equal(manager.data.managed.visible,true);assert.equal(Array.isArray(manager.data.activities.recent),true);assert.equal(manager.data.activities.recent.length<=6,true);
  const engineer=await api(path,{ token:ids.tokenEnabled });
  assert.equal(engineer.status,200);assert.deepEqual(engineer.data.managed,{ visible:false,state:'unavailable' });
  assert.equal(engineer.data.activities.recent.every(row => row.engineer_id===ids.engineerEnabled),true);
  const planner=await api(path,{ token:ids.tokenPlanner });
  assert.equal(planner.status,200);assert.deepEqual(planner.data.tasks,{ open:0,overdue:0,in_progress:0,recently_completed:0,visible:false });
  const privateCustomer=(await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Private operations customer')).lastInsertRowid;
  assert.equal((await api(`/api/customers/${privateCustomer}/operations/summary`,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`/api/customers/${privateCustomer}`,{ token:ids.tokenEnabled })).status,403);
});

test('customer service summary includes a zero-filled 6-month trend for the Customer 360 chart', { skip: !process.env.TEST_DATABASE_URL ? 'needs TEST_DATABASE_URL (pg-mem lacks the ROUND()-with-precision overload used by /service-summary)' : false }, async () => {
  // A dedicated customer, isolated from the shared ids.customer fixture (which
  // accumulates unrelated service activity from many other tests in this file
  // dated within the current month, making its totals non-deterministic here).
  const today=new Date().toISOString().slice(0,10);
  const customer=(await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Trend chart fixture')).lastInsertRowid;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customer, ids.teamEnabled);
  await db.prepare('INSERT INTO service_activities (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,created_by,duration_minutes) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('TREND-CURRENT-MONTH',customer,ids.teamEnabled,ids.engineerEnabled,today,ids.category,'Trend fixture',ids.manager,120);
  const result=await api(`/api/customers/${customer}/service-summary`,{ token:ids.tokenManager });
  assert.equal(result.status,200);
  assert.equal(Array.isArray(result.data.monthly),true);
  assert.equal(result.data.monthly.length,6);
  const currentMonth=result.data.monthly[5];
  assert.equal(currentMonth.month,today.slice(0,7));
  assert.equal(currentMonth.hours,2); // exactly the 120-minute fixture activity on this isolated customer
  assert.equal(currentMonth.count,1);
  for (const row of result.data.monthly) { assert.equal(typeof row.label,'string');assert.equal(typeof row.hours,'number');assert.equal(typeof row.count,'number'); }
  assert.deepEqual(result.data.monthly.slice(0,5).map(row => row.hours),[0,0,0,0,0]); // the other 5 months are zero-filled, not omitted
  // an engineer scoped to this customer's team sees the same single activity, since it's their own
  const engineerResult=await api(`/api/customers/${customer}/service-summary`,{ token:ids.tokenEnabled });
  assert.equal(engineerResult.status,200);
  assert.equal(engineerResult.data.monthly.length,6);
  assert.equal(engineerResult.data.monthly[5].hours,2);
});

test('a managed customer is complete with just a responsible team — ticketing is optional', async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Optional ticketing fixture')).lastInsertRowid;
  const state = async () => (await api(`/api/customers/${customer}/operations/summary`, { token: ids.tokenManager })).data.managed;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customer, ids.teamEnabled);
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled, version, updated_by) VALUES (?,1,1,?)').run(customer, ids.manager);
  assert.equal((await state()).state, 'setup_required'); // enabled but no team yet
  await db.prepare('UPDATE managed_customer_configurations SET responsible_team_id=? WHERE customer_id=?').run(ids.teamEnabled, customer);
  const done = await state();
  assert.equal(done.state, 'active'); // no ticketing configured, and that's fine
  assert.equal('open_tickets' in done, false);
});

test('customer ticket trend is manager-only and returns 8 zero-filled weekly buckets', async () => {
  const path = `/api/customers/${ids.customer}/operations/ticket-trend`;
  assert.equal((await api(path)).status, 401);
  assert.equal((await api(path, { token: ids.tokenEnabled })).status, 403);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO external_tickets (customer_id,provider_type,external_queue_id,external_queue_name,external_ticket_id,ticket_number,subject,external_status,normalized_status,status_group,created_at_external,closed_at_external) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(ids.customer, 'request_tracker', '77', 'Trend queue', 'trend-1', '9001', 'Trend ticket', 'resolved', 'Closed', 'closed', now, now);
  const result = await api(path, { token: ids.tokenManager });
  assert.equal(result.status, 200);
  assert.equal(result.data.weeks.length, 8);
  const last = result.data.weeks[7];
  assert.ok(last.opened >= 1 && last.closed >= 1); // this week's ticket, opened and closed
  assert.equal(result.data.weeks[0].opened >= 0, true);
});

test('customer activity views reject malformed filters and missing customers consistently',async () => {
  const root=`/api/customers/${ids.customer}`;
  for (const query of ['page=0','page_size=201','page=1&page=2','from=bad','from=2026-09-20&to=2026-09-01','engineer_id=nope']) {
    assert.equal((await api(`${root}/service-activities?${query}`,{ token:ids.tokenManager })).status,400);
  }
  for (const query of ['from=bad','from=2026-09-20&to=2026-09-01','from=2026-09-01&from=2026-09-02']) {
    assert.equal((await api(`${root}/service-summary?${query}`,{ token:ids.tokenManager })).status,400);
  }
  assert.equal((await api('/api/customers/99999999/service-activities',{ token:ids.tokenManager })).status,404);
  assert.equal((await api('/api/customers/99999999/service-summary',{ token:ids.tokenManager })).status,404);
});

test('customer operational work lists paginate, filter, and enforce role scope',async () => {
  const root=`/api/customers/${ids.customer}/operations`;
  for (const resource of ['projects','tasks','visits']) {
    const manager=await api(`${root}/${resource}?page=1&page_size=5`,{ token:ids.tokenManager });
    assert.equal(manager.status,200);assert.equal(manager.data.page,1);assert.equal(manager.data.page_size,5);assert.ok(manager.data.rows.length<=5);
    assert.equal(manager.data.rows.every(row => row.customer_id===ids.customer),true);
    assert.equal((await api(`${root}/${resource}?page=0`,{ token:ids.tokenManager })).status,400);
    assert.equal((await api(`${root}/${resource}?filter=not-real`,{ token:ids.tokenManager })).status,400);
  }
  const projects=await api(`${root}/projects`,{ token:ids.tokenEnabled });
  assert.equal(projects.status,200);
  for (const project of projects.data.rows) assert.ok(await db.prepare('SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?').get(project.id,ids.engineerEnabled));
  const tasks=await api(`${root}/tasks`,{ token:ids.tokenEnabled });
  assert.equal(tasks.status,200);assert.equal(tasks.data.rows.every(row => row.assigned_to===ids.engineerEnabled),true);
  const visits=await api(`${root}/visits`,{ token:ids.tokenEnabled });
  assert.equal(visits.status,200);
  for (const visit of visits.data.rows) assert.ok(await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id=? AND user_id=?').get(visit.id,ids.engineerEnabled));
  assert.equal((await api(`${root}/tasks`,{ token:ids.tokenPlanner })).status,403);
  const privateCustomer=(await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Private work-list customer')).lastInsertRowid;
  for (const resource of ['projects','tasks','visits']) assert.equal((await api(`/api/customers/${privateCustomer}/operations/${resource}`,{ token:ids.tokenEnabled })).status,403);
});

test('customer timeline is paginated and filters restricted work for engineers',async () => {
  const path=`/api/customers/${ids.customer}/operations/timeline`;
  const manager=await api(`${path}?page=1&page_size=5`,{ token:ids.tokenManager });
  assert.equal(manager.status,200);assert.ok(manager.data.rows.length<=5);assert.equal(manager.data.page_size,5);
  assert.equal((await api(`${path}?page=0`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(path,{ token:ids.tokenPlanner })).status,200);
  const engineer=await api(`${path}?page_size=100`,{ token:ids.tokenEnabled });
  assert.equal(engineer.status,200);
  for (const event of engineer.data.rows) {
    if (event.kind==='project') assert.ok(await db.prepare('SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?').get(event.entity_id,ids.engineerEnabled));
    if (event.kind==='task') assert.ok(await db.prepare('SELECT 1 FROM tasks WHERE id=? AND assigned_to=?').get(event.entity_id,ids.engineerEnabled));
    if (['visit','visit_report'].includes(event.kind)) assert.ok(await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id=? AND user_id=?').get(event.entity_id,ids.engineerEnabled));
    if (event.kind==='activity') assert.ok(await db.prepare('SELECT 1 FROM service_activities WHERE id=? AND engineer_id=?').get(event.entity_id,ids.engineerEnabled));
    assert.notEqual(event.kind,'asset');
  }
  const privateCustomer=(await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Private timeline customer')).lastInsertRowid;
  assert.equal((await api(`/api/customers/${privateCustomer}/operations/timeline`,{ token:ids.tokenEnabled })).status,403);
});

test('operational overview validates dates, honors disabled teams and rejects unauthorized roles', async () => {
  assert.equal((await api('/api/operations/overview')).status, 401);
  for (const asOf of ['bad', '2026-02-30', '2026-13-01', '1800-01-01', '9999-01-01', '2026-09-17&as_of=2026-09-18']) {
    assert.equal((await api(`/api/operations/overview?as_of=${asOf}`, { token: ids.tokenManager })).status, 400);
  }
  const disabled = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
  assert.equal(disabled.status, 200);
  assert.deepEqual(disabled.data.service, { enabled: false });
  for (const role of ['planner', 'pm']) {
    const user = { id: (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(`Approval ${role}`, `approval-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid };
    assert.equal((await api('/api/operations/overview', { token: signJwt({ id: user.id }) })).status, 403);
  }
  const boundary = await api('/api/operations/overview?as_of=2027-01-01', { token: ids.tokenDisabled });
  assert.equal(boundary.status, 200);
  assert.equal(boundary.data.week_from, '2026-12-28');
  assert.equal(boundary.data.week_to, '2027-01-03');
});


test('operational priorities honor configured terminal task statuses', async () => {
  const before = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
  const setting = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  const config = JSON.parse(setting.value);
  config.task.push({ value: 'overview_archived', label: 'Archived', is_terminal: true });
  const task = (await db.prepare('INSERT INTO tasks (title, status, assigned_to, deadline, created_by) VALUES (?, ?, ?, ?, ?)').run('Archived operational work', 'overview_archived', ids.engineerDisabled, '2026-09-01', ids.manager)).lastInsertRowid;
  try {
    await db.prepare("UPDATE settings SET value=? WHERE key='status_config'").run(JSON.stringify(config));
    const after = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
    assert.equal(after.status, 200);
    assert.equal(after.data.tasks.open, before.data.tasks.open);
    assert.equal(after.data.tasks.overdue, before.data.tasks.overdue);
    assert.ok(after.data.tasks.attention.every(item => item.id !== task));
    const calendar = await api('/api/calendar?month=2026-09', { token: ids.tokenDisabled });
    assert.equal(calendar.status, 200);
    assert.ok(calendar.data.tasks.every(item => item.id !== task), 'calendar excludes configured terminal tasks');
  } finally { await db.prepare("UPDATE settings SET value=? WHERE key='status_config'").run(setting.value); }
});

test('completing an activity attempts RT ticket write-back only when the customer opted in and a matching synced ticket exists', async () => {
  await db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(ids.customer);
  await db.prepare('DELETE FROM external_tickets WHERE customer_id = ?').run(ids.customer);

  // 1. No write-back configured at all: completing does nothing extra, no audit entries.
  const noConfig = await createActivity({ title: 'Writeback not configured', ticket_reference: 'RT#4001' });
  await api(`/api/service-activities/${noConfig.data.id}/complete`, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(noConfig.data.id)).n, 0);

  // 2. Write-back configured, but no synced ticket matches the reference: still nothing.
  await db.prepare(`
    INSERT INTO customer_ticketing_configurations (customer_id, provider_type, external_queue_id, external_queue_name, enabled, write_back_enabled, write_back_status)
    VALUES (?, 'request_tracker', '7', 'Support', 1, 1, 'resolved')
  `).run(ids.customer);
  const noMatch = await createActivity({ title: 'No matching ticket', ticket_reference: 'RT#4002' });
  await api(`/api/service-activities/${noMatch.data.id}/complete`, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(noMatch.data.id)).n, 0);

  // 3. Write-back configured and a synced ticket matches: attempted (and, since the RT
  // integration itself isn't configured in this test environment, recorded as failed —
  // exercising the same "RT unreachable never fails the completion" path production hits).
  await db.prepare(`
    INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group)
    VALUES (?, 'request_tracker', '7', 'Support', '4003', '4003', 'Matched ticket', 'open', 'Open', 'open')
  `).run(ids.customer);
  const matched = await createActivity({ title: 'Matched ticket', ticket_reference: 'RT#4003' });
  const completion = await api(`/api/service-activities/${matched.data.id}/complete`, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal(completion.status, 200, 'a failed RT write-back must not fail the activity completion');
  const entry = await db.prepare("SELECT * FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(matched.data.id);
  assert.equal(entry.action, 'ticket_writeback_failed');
  assert.match(entry.detail, /ticket_id=4003/);

  await db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(ids.customer);
  await db.prepare('DELETE FROM external_tickets WHERE customer_id = ?').run(ids.customer);
});

test('a direct PUT that transitions status into Completed also triggers write-back, same as the dedicated endpoint', async () => {
  await db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(ids.customer);
  await db.prepare('DELETE FROM external_tickets WHERE customer_id = ?').run(ids.customer);
  await db.prepare(`
    INSERT INTO customer_ticketing_configurations (customer_id, provider_type, external_queue_id, external_queue_name, enabled, write_back_enabled, write_back_status)
    VALUES (?, 'request_tracker', '7', 'Support', 1, 1, 'resolved')
  `).run(ids.customer);
  await db.prepare(`
    INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group)
    VALUES (?, 'request_tracker', '7', 'Support', '4004', '4004', 'Matched via PUT', 'open', 'Open', 'open')
  `).run(ids.customer);

  const created = await createActivity({ title: 'Completed via PUT', ticket_reference: 'RT#4004' });
  const completedValue = (JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='status_config'").get()).value).service_activity
    .find(s => s.is_terminal && /complet/i.test(s.value))).value;
  await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: completedValue } });
  const entry = await db.prepare("SELECT * FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(created.data.id);
  assert.equal(entry.action, 'ticket_writeback_failed'); // RT itself isn't configured in this test env
  assert.match(entry.detail, /ticket_id=4004/);

  // A subsequent, unrelated edit (already-completed) must NOT re-attempt write-back.
  const before = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(created.data.id);
  const stored = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { version: stored.data.version, description: 'unrelated edit' } });
  const after = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action LIKE 'ticket_writeback%'").get(created.data.id);
  assert.equal(after.n, before.n);

  await db.prepare('DELETE FROM customer_ticketing_configurations WHERE customer_id = ?').run(ids.customer);
  await db.prepare('DELETE FROM external_tickets WHERE customer_id = ?').run(ids.customer);
});
