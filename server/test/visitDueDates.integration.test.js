// A visit's date decides what is due: only a visit whose days are over can be
// "incomplete", and a report is submitted on or after the visit day, not before.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const shift = days => { const d = new Date(`${appTime.today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const visit = async (title, start, end = null) => (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, end_date, status, created_by) VALUES (?,?,?,?,?,?)')
  .run(ids.customer, title, start, end, 'scheduled', ids.manager)).lastInsertRowid;

test('the dashboard\'s incomplete visits are the ones whose days are over, not the ones still ahead', async () => {
  const overdue = await visit('Due-date overdue', shift(-2));
  const ahead = await visit('Due-date ahead', shift(3));
  const underWay = await visit('Due-date under way', shift(-1), shift(1));
  const done = await visit('Due-date done', shift(-5));
  await db.prepare("UPDATE maintenance_visits SET status='completed' WHERE id=?").run(done);
  const { status, data } = await api(`/api/maintenance-visits?not_completed=1`, { token: ids.tokenManager });
  assert.equal(status, 200);
  const listed = new Set(data.map(v => Number(v.id)));
  assert.equal(listed.has(overdue), true);
  for (const id of [ahead, underWay, done]) assert.equal(listed.has(id), false);
});

test('a report cannot be submitted before the visit day', async () => {
  const tomorrow = await visit('Report too early', shift(1));
  const early = await api(`/api/maintenance-visits/${tomorrow}/report-sent`, { method: 'POST', token: ids.tokenManager, body: {} });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /not happened yet/);
  assert.equal(Number((await db.prepare('SELECT report_sent FROM maintenance_visits WHERE id=?').get(tomorrow)).report_sent), 0);

  // Started early: under way before its planned day, so it can be reported on.
  const startedEarly = await visit('Report started early', shift(2));
  await db.prepare("UPDATE maintenance_visits SET status='in_progress' WHERE id=?").run(startedEarly);
  assert.equal((await api(`/api/maintenance-visits/${startedEarly}/report-sent`, { method: 'POST', token: ids.tokenManager, body: {} })).status, 200);

  const today = await visit('Report on the day', shift(0));
  assert.equal((await api(`/api/maintenance-visits/${today}/report-sent`, { method: 'POST', token: ids.tokenManager, body: {} })).status, 200);
  assert.equal(Number((await db.prepare('SELECT report_sent FROM maintenance_visits WHERE id=?').get(today)).report_sent), 1);
});
