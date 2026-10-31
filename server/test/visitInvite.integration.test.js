const { test, assert, db, ids } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');

const download = (visitId, token) => fetch(`${fixture.baseUrl}/api/maintenance-visits/${visitId}/calendar.ics`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('assigned engineers and managers download the calendar invitation; others cannot', async () => {
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, created_by) VALUES (?, ?, ?, ?)').run(ids.customer, 'Quarterly firewall check', '2026-10-12', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  const mine = await download(visit, ids.tokenEnabled);
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('content-type'), /^text\/calendar/);
  assert.match(mine.headers.get('content-disposition'), /attachment; filename="visit-2026-10-12-quarterly-firewall-check\.ics"/);
  const body = (await mine.text()).replace(/\r\n /g, '');
  assert.match(body, /BEGIN:VCALENDAR[\s\S]*UID:visit-\d+@solutionshub[\s\S]*Engineers: Engineer Enabled/);
  assert.equal((await download(visit, ids.tokenManager)).status, 200);
  assert.equal((await download(visit, ids.tokenDisabled)).status, 403, 'an engineer not on the visit');
  assert.equal((await download(visit)).status, 401);
  assert.equal((await download(999999, ids.tokenManager)).status, 404);
  assert.equal((await download('abc', ids.tokenManager)).status, 400);
});
