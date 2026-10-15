// The server clock 12 hours behind UTC, the organisation 14 hours ahead: their dates always differ.
process.env.TZ = 'Etc/GMT+12';
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

test("'today' is the organisation's date, not the server clock's", async () => {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('localization_config', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ timezone: 'Pacific/Kiritimati' }));
  await appTime.refreshTimeZone();
  const today = appTime.today();
  const serverDate = new Date().toLocaleDateString('en-CA'); // the server clock's own date
  assert.notEqual(today, serverDate, 'the two dates differ in this test');
  const body = date => ({ customer_id: ids.customer, activity_date: date, category_id: ids.category, title: `Logged ${date}` });
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: body(today) })).status, 200, 'work logged today in the organisation is accepted');
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: body(appTime.addDays(today, 1)) })).status, 400, 'tomorrow is still the future');
});
