// Approval aging and delegation (enhancement E04).
const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');
const approvals = require('../approvalAging');
const calendar = require('../businessCalendar');

const weekdays = { working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2027-03-25', name: 'Holiday' }] };

test('the due target counts working days on the business calendar', () => {
  // Monday 22 March 2027, 3 working days, Thursday 25th is a holiday → Friday 26th.
  assert.equal(approvals.addWorkingDays('2027-03-22', 3, weekdays), '2027-03-26');
  assert.deepEqual(approvals.aging('2027-03-22 10:00:00', 'closure', weekdays, '2027-03-26'), { waiting_days: 3, due_on: '2027-03-26', overdue: false, target_days: 3 });
  assert.equal(approvals.aging('2027-03-22 10:00:00', 'closure', weekdays, '2027-03-29').overdue, true, 'overdue the next day');
  assert.equal(approvals.addWorkingDays('2027-03-26', 2, weekdays), '2027-03-30', 'over the weekend');
  assert.ok(calendar.isWorkingDay('2027-03-26', weekdays));
});

let project, second, secondToken;
test('the closure queue shows age, evidence, who has it and a suggested reviewer', async () => {
  second = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Bea Reviewer', 'bea.reviewer@test.local', bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid;
  secondToken = signJwt({ id: second });
  project = (await db.prepare("INSERT INTO projects (title, status, created_by, closure_requested_by, closure_requested_at, closure_request_version) VALUES ('Aging project', 'pending_approval', ?, ?, '2020-01-06 09:00:00', 1)").run(ids.manager, ids.manager)).lastInsertRowid;
  await db.prepare("INSERT INTO tasks (title, project_id, status, created_by) VALUES ('Leftover', ?, 'in_progress', ?)").run(project, ids.manager);
  await db.prepare("INSERT INTO project_milestones (project_id, title, created_by) VALUES (?, 'Handover', ?)").run(project, ids.manager);

  const queue = await api('/api/projects/approvals', { token: ids.tokenManager });
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const row = queue.data.rows.find(r => r.id === project);
  assert.equal(row.overdue, true);
  assert.equal(row.target_days, 3);
  assert.ok(row.waiting_days > 3);
  assert.deepEqual([row.open_tasks, row.open_milestones], [1, 1], 'what is still open, for the reviewer to weigh');
  assert.equal(row.assigned_to, null);
  assert.notEqual(row.suggested_delegate.id, ids.manager, 'never the person who asked');
  assert.ok(queue.data.reviewers.some(r => r.id === second));
});

test('delegation goes only to someone who may decide, never to the requester; it is audited and notified', async () => {
  const delegate = (user_id, token = ids.tokenManager) => api(`/api/projects/${project}/closure-delegate`, { method: 'POST', token, body: { user_id } });
  assert.equal((await delegate(second, ids.tokenEnabled)).status, 403, 'engineers cannot delegate');
  assert.equal((await delegate(ids.engineerEnabled)).status, 400, 'an engineer cannot approve closures');
  assert.equal((await delegate(ids.manager)).status, 400, 'the requester cannot review their own request');
  assert.equal((await delegate(second)).status, 200);
  const row = (await api('/api/projects/approvals', { token: ids.tokenManager })).data.rows.find(r => r.id === project);
  assert.deepEqual([row.assigned_to, row.assigned_to_name], [second, 'Bea Reviewer']);
  await require('../notifications').settled();
  assert.ok(await db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title LIKE '%asked you to review: Aging project%'").get(second));
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'closure_delegated' AND entity_id = ? AND detail = 'to Bea Reviewer'").get(project));
  assert.equal((await delegate(null)).status, 200, 'back to every reviewer');
  assert.equal((await delegate(second)).status, 200);
});

test('an overdue request reminds its reviewer once a day and decides nothing', async () => {
  const today = '2020-02-03';
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Overdue for review:%'").get(second)).n;
  assert.ok(await approvals.remindOverdue({ today }) >= 1);
  await approvals.remindOverdue({ today });
  const after = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Overdue for review: Aging project%'").get(second)).n;
  assert.equal(Number(after) - Number(before), 1, 'once for that day');
  assert.equal((await db.prepare('SELECT status FROM projects WHERE id = ?').get(project)).status, 'pending_approval', 'still waiting for a person');
  await approvals.remindOverdue({ today: '2020-02-04' });
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Overdue for review: Aging project%'").get(second)).n), Number(after) + 1, 'again the next day');
});

