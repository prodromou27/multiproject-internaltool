/* Route-level tests for two routes that had none: the Service Activity
   settings/retention endpoints (which can delete data) and the iCal feed
   (which is authenticated only by an opaque URL token). */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const harness = require('./lib/harness');

let h, manager, engineer, otherEngineer, team, customer, category;

// The feed's visit query is a 3-table join that crashes pg-mem itself (an internal
// error, not a SQL one), so the feed tests run on real PostgreSQL only.
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem crashes on the iCal visit join)' };

const token = raw => crypto.createHash('sha256').update(raw).digest('hex');

test.before(async () => {
  h = await harness.start({
    '/api/service-activity-settings': require('../routes/serviceActivitySettings'),
    '/api/calendar/ical': require('../routes/ical'),
  });
  manager = await h.makeUser('Settings Manager', 'manager');
  engineer = await h.makeUser('Feed Engineer', 'engineer');
  otherEngineer = await h.makeUser('Other Feed Engineer', 'engineer');
  team = (await h.db.prepare("INSERT INTO teams (name) VALUES ('Feed team')").run()).lastInsertRowid;
  customer = (await h.db.prepare("INSERT INTO customers (name) VALUES ('Feed, Co; Ltd')").run()).lastInsertRowid;
  category = (await h.db.prepare("INSERT INTO activity_categories (name) VALUES ('Feed category')").run()).lastInsertRowid;
});
test.after(() => h.stop());

/* ── service activity settings ──────────────────────────── */
test('activity settings: readable by anyone signed in, writable and validated for managers only', async () => {
  const base = '/api/service-activity-settings';
  assert.equal((await h.api(base)).status, 401);
  const defaults = await h.api(base, { token: engineer.token });
  assert.deepEqual(defaults.data, { retention_days: null, allow_attachments: true, allow_follow_up_task_creation: true });

  assert.equal((await h.api(base, { method: 'PUT', token: engineer.token, body: { retention_days: 30 } })).status, 403);
  for (const bad of [0, -5, 1.5, '30']) {
    assert.equal((await h.api(base, { method: 'PUT', token: manager.token, body: { retention_days: bad } })).status, 400, String(bad));
  }
  const saved = await h.api(base, { method: 'PUT', token: manager.token, body: { retention_days: 365, allow_attachments: false } });
  assert.equal(saved.status, 200);
  const after = await h.api(base, { token: engineer.token });
  assert.deepEqual(after.data, { retention_days: 365, allow_attachments: false, allow_follow_up_task_creation: true });
  const audit = await h.db.prepare("SELECT detail FROM audit_log WHERE entity_type='service_activity_settings' AND action='settings_updated' ORDER BY id DESC LIMIT 1").get();
  assert.match(audit.detail, /"retention_days":365/);
});

test('retention purge is manager-only, needs a configured period, and deletes only what is older than it', async () => {
  const base = '/api/service-activity-settings';
  // No period configured: nothing is eligible and a purge is refused rather than deleting everything.
  await h.api(base, { method: 'PUT', token: manager.token, body: { retention_days: null } });
  assert.deepEqual((await h.api(`${base}/retention-status`, { token: manager.token })).data, { retention_days: null, eligible_count: 0 });
  assert.equal((await h.api(`${base}/purge`, { method: 'POST', token: manager.token })).status, 400);

  const insert = (reference, date) => h.db.prepare('INSERT INTO service_activities (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(reference, customer, team, engineer.id, date, category, reference, manager.id);
  const today = new Date().toISOString().slice(0, 10);
  await insert('OLD-1', '2020-01-01');
  await insert('OLD-2', '2020-06-01');
  await insert('NEW-1', today);

  await h.api(base, { method: 'PUT', token: manager.token, body: { retention_days: 365 } });
  assert.equal((await h.api(`${base}/retention-status`, { token: engineer.token })).status, 403);
  assert.equal((await h.api(`${base}/purge`, { method: 'POST', token: engineer.token })).status, 403);
  const status = await h.api(`${base}/retention-status`, { token: manager.token });
  assert.equal(status.data.eligible_count, 2);

  const purged = await h.api(`${base}/purge`, { method: 'POST', token: manager.token });
  assert.equal(purged.data.deleted, 2);
  const left = (await h.db.prepare("SELECT activity_reference FROM service_activities WHERE activity_reference IN ('OLD-1','OLD-2','NEW-1')").all()).map(row => row.activity_reference);
  assert.deepEqual(left, ['NEW-1']);
  const audit = await h.db.prepare("SELECT detail FROM audit_log WHERE action='retention_purge' ORDER BY id DESC LIMIT 1").get();
  assert.match(audit.detail, /deleted=2/); // a purge is always on the record
});

/* ── iCal feed ──────────────────────────────────────────── */
async function feed(raw) {
  const response = await fetch(`${h.baseUrl}/api/calendar/ical?token=${encodeURIComponent(raw)}`);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

test('ical: only a valid token for an active user gets a feed, and it is a calendar not an API session', realDb, async () => {
  const missing = await fetch(`${h.baseUrl}/api/calendar/ical`);
  assert.equal(missing.status, 401);
  assert.equal((await feed('not-a-real-token')).status, 401);

  await h.db.prepare('UPDATE users SET ical_token_hash=? WHERE id=?').run(token('engineer-feed-token'), engineer.id);
  const ok = await feed('engineer-feed-token');
  assert.equal(ok.status, 200);
  assert.match(ok.type, /text\/calendar/);
  assert.match(ok.text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ok.text, /END:VCALENDAR$/);

  // Deactivating the user kills the feed even though the token itself is unchanged.
  await h.db.prepare('UPDATE users SET active=0 WHERE id=?').run(engineer.id);
  assert.equal((await feed('engineer-feed-token')).status, 401);
  await h.db.prepare('UPDATE users SET active=1 WHERE id=?').run(engineer.id);
});

test('ical: an engineer\'s feed contains only their own tasks, with iCal text escaped', realDb, async () => {
  const project = (await h.db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?,?,?)').run('Feed project', customer, manager.id)).lastInsertRowid;
  const mine = (await h.db.prepare('INSERT INTO tasks (title, project_id, created_by, assigned_to, deadline) VALUES (?,?,?,?,?)')
    .run('Patch, reboot; verify', project, manager.id, engineer.id, '2031-03-04')).lastInsertRowid;
  const theirs = (await h.db.prepare('INSERT INTO tasks (title, project_id, created_by, assigned_to, deadline) VALUES (?,?,?,?,?)')
    .run('Someone else\'s task', project, manager.id, otherEngineer.id, '2031-03-05')).lastInsertRowid;
  const done = (await h.db.prepare("INSERT INTO tasks (title, project_id, created_by, assigned_to, deadline, status) VALUES (?,?,?,?,?,'completed')")
    .run('Already done', project, manager.id, engineer.id, '2031-03-06')).lastInsertRowid;

  await h.db.prepare('UPDATE users SET ical_token_hash=? WHERE id=?').run(token('engineer-feed-token'), engineer.id);
  const { text } = await feed('engineer-feed-token');
  assert.match(text, new RegExp(`UID:task-${mine}@solutionshub`));
  assert.doesNotMatch(text, new RegExp(`UID:task-${theirs}@`)); // other engineer's work never leaks
  assert.doesNotMatch(text, new RegExp(`UID:task-${done}@`)); // finished work isn't a calendar entry
  assert.match(text, /SUMMARY:✅ Patch\\, reboot\\; verify/); // commas and semicolons escaped
  assert.match(text, /DTSTART;VALUE=DATE:20310304/);
  assert.match(text, /DTEND;VALUE=DATE:20310305/); // all-day event ends the next day
});

test('ical: a manager\'s feed includes everyone\'s open tasks and no line exceeds the fold limit', realDb, async () => {
  await h.db.prepare('UPDATE users SET ical_token_hash=? WHERE id=?').run(token('manager-feed-token'), manager.id);
  const project = (await h.db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?,?,?)').run('Long project', customer, manager.id)).lastInsertRowid;
  const long = (await h.db.prepare('INSERT INTO tasks (title, project_id, created_by, assigned_to, deadline) VALUES (?,?,?,?,?)')
    .run('X'.repeat(200), project, manager.id, otherEngineer.id, '2031-04-01')).lastInsertRowid;
  const { text } = await feed('manager-feed-token');
  assert.match(text, new RegExp(`UID:task-${long}@solutionshub`)); // manager sees another engineer's task
  for (const line of text.split('\r\n')) assert.ok(line.length <= 75, `line too long (${line.length}): ${line.slice(0, 30)}…`);
});
