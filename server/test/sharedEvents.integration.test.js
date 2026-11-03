const { test, assert, api, db, ids } = require('./lib/activityFixture');
const notifications = require('../notifications');

const posts = [];
async function shareTo(notifyOn = {}) {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('integrations',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value")
    .run(JSON.stringify({ webex: { enabled: true, bot_token: 'shared-token', mode: 'space', space_id: 'team-space' }, notify_on: notifyOn }));
}
// Shared posts are fire-and-forget; give them a moment to land.
async function settle(count) {
  for (let i = 0; i < 50 && posts.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20));
  await require('../notifications').settled(); // and nothing more is on its way
}

test.beforeEach(() => {
  posts.length = 0;
  notifications._setTransport(async (url, data) => { posts.push(JSON.parse(data)); return { status: 200, body: '{}', headers: {} }; });
});
test.after(() => notifications._setTransport());

test('shared events respect each switch and its default', async () => {
  await shareTo();
  const base = { customer_id: ids.customer, activity_date: '2026-10-01', category_id: ids.category, title: 'Firewall check' };
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: base })).status, 200);
  await settle(1);
  assert.equal(posts.length, 0, 'a logged activity is off by default');

  await shareTo({ activity_logged: true });
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { ...base, title: 'Switch upgrade' } })).status, 200);
  await settle(1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].roomId, 'team-space');
  assert.match(posts[0].markdown, /Switch upgrade/);

  posts.length = 0;
  const path = `/api/customers/${ids.customer}/recommendations`;
  const recommendation = { finding: 'Unsupported firmware', recommendation: 'Upgrade the firmware', owner_id: ids.manager, due_date: '2026-11-01' };
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'low' } })).status, 201);
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'critical' } })).status, 201);
  await settle(1);
  assert.equal(posts.length, 1, 'only high and critical recommendations are posted');
  assert.match(posts[0].markdown, /Critical-risk recommendation/);

  posts.length = 0;
  await shareTo({ recommendation_created: false });
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'high' } })).status, 201);
  await settle(1);
  assert.equal(posts.length, 0, 'a switched-off event is not posted');
});

test('scheduled shared events are posted once per occasion and never throw', async () => {
  await shareTo();
  const msg = { title: 'Report due', body: 'The September report is due.' };
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:due' }), true);
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:due' }), false);
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:overdue' }), true);
  assert.equal(posts.length, 2);
  assert.equal(await notifications.notifyShared('not_an_event', msg), false);
  notifications._setTransport(async () => { throw new Error('network down'); });
  assert.equal(await notifications.notifyShared('backup_failed', msg), false);
});

test('ticket sync alerts managers on their bell when a customer starts failing and when it recovers, never on Webex or Teams', async () => {
  // The Webex bot can post to the space and message people directly, and the manager has
  // Webex messages on: still, nothing about ticket sync goes to Webex.
  await db.prepare("INSERT INTO settings (key,value) VALUES ('integrations',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value")
    .run(JSON.stringify({ webex: { enabled: true, bot_token: 'shared-token', mode: 'both', space_id: 'team-space' }, notify_on: {} }));
  await db.prepare('UPDATE users SET notify_external_enabled=1 WHERE id=?').run(ids.manager);
  await db.prepare("INSERT INTO settings (key,value) VALUES ('ticketing_rt',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled: true, base_url: 'https://rt.example.test/rt', sync_interval_minutes: 5 }));
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Sync alert customer')).lastInsertRowid;
  await db.prepare(`INSERT INTO customer_ticketing_configurations (customer_id,provider_type,external_queue_id,external_queue_name,enabled,include_in_reporting)
    VALUES (?,'request_tracker','77','Alert queue',1,1)`).run(customer);
  const { syncCustomer } = require('../ticketSync');
  const broken = { getTickets: async () => { throw Object.assign(new Error('RT unreachable'), { status: 502 }); } };
  const count = async () => Number((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='ticket_sync_failed'").get(ids.manager)).n);
  // Bell entries are written in the background too; wait for the expected number.
  const bell = async expected => { for (let i = 0; i < 100 && await count() < expected; i++) await new Promise(resolve => setTimeout(resolve, 20)); return count(); };
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  assert.equal(await bell(1), 1, 'managers get it on their bell');
  await settle(1);
  assert.equal(posts.length, 0, 'not in the Webex space, not as a Webex message');
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  await settle(1);
  assert.equal(await count(), 1, 'retries while still failing stay quiet');
  await syncCustomer(customer, { provider: { getTickets: async () => [] } });
  assert.equal(await bell(2), 2, 'recovery is on the bell too');
  await settle(1);
  assert.equal(posts.length, 0);
});

test('people can choose the new alerts for their own channels', async () => {
  const { eventPreferences } = require('../notifications');
  const manager = Object.keys(eventPreferences(null, 'manager'));
  const engineer = Object.keys(eventPreferences(null, 'engineer'));
  for (const key of ['project_closure', 'managed_report_review', 'recommendation_assigned', 'visit_report_approved', 'ticket_sync_failed']) assert.ok(manager.includes(key), key);
  assert.ok(!engineer.includes('ticket_sync_failed'));
  // Ticket sync is offered by email only, never Webex or Teams, even if chosen before.
  assert.deepEqual(eventPreferences(null, 'manager').ticket_sync_failed, { email: true });
  assert.deepEqual(eventPreferences(JSON.stringify({ ticket_sync_failed: { webex: true, teams: true } }), 'manager').ticket_sync_failed, { email: true });
  // A high-risk recommendation assigned to someone else reaches them.
  await shareTo({ recommendation_created: false });
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='recommendation_assigned'").get(ids.engineerEnabled)).n;
  assert.equal((await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'Expired certificate', recommendation: 'Renew it', owner_id: ids.engineerEnabled, risk_level: 'high', due_date: '2026-11-01' } })).status, 201);
  await require('../notifications').settled();
  const after = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='recommendation_assigned'").get(ids.engineerEnabled)).n;
  assert.equal(Number(after), Number(before) + 1);
});

test('while notifications are paused nothing is posted or emailed (the bell still is), until a manager resumes them', async () => {
  await shareTo({ task_assigned: true });
  const pause = paused => api('/api/settings/notifications-pause', { method: 'PUT', token: ids.tokenManager, body: { paused } });
  assert.equal((await api('/api/settings/notifications-pause', { method: 'PUT', token: ids.tokenEnabled, body: { paused: true } })).status, 403, 'managers only');
  assert.equal((await api('/api/settings/notifications-pause', { method: 'PUT', token: ids.tokenManager, body: { paused: 'yes' } })).status, 400);
  const on = await pause(true);
  assert.equal(on.status, 200);
  assert.deepEqual([on.data.paused, on.data.by], [true, 'Manager One']);
  assert.equal((await api('/api/settings/notifications-pause', { token: ids.tokenManager })).data.paused, true);

  const bellBefore = Number((await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(ids.engineerEnabled)).n);
  const made = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Batch task 1', assigned_to: ids.engineerEnabled } });
  assert.equal(made.status, 200);
  notifications.notifyShared('task_assigned', { title: 'Shared while paused', body: 'x' }, { dedupeKey: 'paused-1' });
  await settle(1);
  assert.equal(posts.length, 0, 'nothing posted while paused');
  assert.ok(Number((await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(ids.engineerEnabled)).n) > bellBefore, 'the bell still gets it');

  assert.equal((await pause(false)).data.paused, false);
  notifications.notifyShared('task_assigned', { title: 'After resuming', body: 'x' }, { dedupeKey: 'paused-1' });
  await settle(1);
  assert.equal(posts.length, 1, 'posted once resumed (the paused one was not recorded as sent)');
});

test('a team with its own Webex space gets its unassigned tasks, recurring team tasks and team reminders there, once each', async () => {
  await shareTo({ task_assigned: true });
  const setSpace = webex_space_id => api(`/api/teams/${ids.teamEnabled}`, { method: 'PUT', token: ids.tokenManager, body: { webex_space_id } });
  assert.equal((await setSpace('not a space id!')).status, 400);
  assert.equal((await setSpace('Y2lzY29zcGFyazovL3VzL1JPT00vdGVhbS1zZWN1cml0eQ')).status, 200);
  const roomOf = post => post.roomId;
  try {
    // A team task: one post, in the team's space (not one per member in the shared space).
    posts.length = 0;
    const made = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Rotate VPN certificates', team_id: ids.teamEnabled } });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    await settle(1);
    assert.deepEqual(posts.filter(p => p.roomId).map(roomOf), ['Y2lzY29zcGFyazovL3VzL1JPT00vdGVhbS1zZWN1cml0eQ']);
    assert.match(posts.find(p => p.roomId).markdown, /New team task: Rotate VPN certificates/);

    // A recurring team task, even when the template does not ask to notify.
    posts.length = 0;
    const today = require('../appTime').today();
    const template = (await db.prepare(`INSERT INTO recurring_tasks (customer_id, title, priority, frequency, start_date, lead_days, next_due, created_by, team_id, notify)
      VALUES (?, ?, 'medium', 'monthly', ?, 7, ?, ?, ?, 0)`).run(ids.customer, 'Monthly patching', today, today, ids.manager, ids.teamEnabled)).lastInsertRowid;
    await require('../recurringTasks').createDueTasks({ templateId: template });
    await settle(1);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].roomId, 'Y2lzY29zcGFyazovL3VzL1JPT00vdGVhbS1zZWN1cml0eQ');
    assert.match(posts[0].markdown, /Team task: Monthly patching/);

    // A team reminder.
    posts.length = 0;
    const due = new Date(Date.now() - 60 * 1000).toISOString();
    await db.prepare(`INSERT INTO reminders (user_id, title, due_at, scheduled_at, time_zone, status, shared, team_id, notify_personal, post_shared)
      VALUES (?, ?, ?, ?, 'UTC', 'active', 1, ?, 0, 0)`).run(ids.manager, 'Renew the firewall support', due, due, ids.teamEnabled);
    await require('../reminders').sendTeamReminders();
    await settle(1);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].roomId, 'Y2lzY29zcGFyazovL3VzL1JPT00vdGVhbS1zZWN1cml0eQ');
    assert.match(posts[0].markdown, /Renew the firewall support/);

    // Without a team space, a team task falls back to the shared space, once.
    assert.equal((await setSpace('')).status, 200);
    posts.length = 0;
    await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Check backups', team_id: ids.teamEnabled } });
    await settle(1);
    assert.deepEqual(posts.filter(p => p.roomId).map(roomOf), ['team-space']);
  } finally { await setSpace(''); }
});
