const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const localization = { default_language: 'en', supported_languages: ['en'], date_format: 'DD/MM/YYYY', time_format: '24h', number_format: '1,000.00' };

test('managers set the time zone and NTP server; bad values are refused and the clock is visible', async () => {
  const save = (body, token = ids.tokenManager) => api('/api/settings/localization', { method: 'PUT', token, body: { ...localization, ...body } });
  assert.equal((await save({ timezone: 'Mars/Olympus' })).status, 400);
  assert.equal((await save({ timezone: 'Asia/Nicosia', ntp_server: 'http://evil' })).status, 400);
  assert.equal((await save({ timezone: 'Asia/Nicosia', ntp_check_enabled: 'yes' })).status, 400);
  assert.equal((await save({ timezone: 'Europe/Athens' }, ids.tokenEnabled)).status, 403);

  assert.equal((await save({ timezone: 'Europe/Athens', ntp_server: 'time.example.com', ntp_check_enabled: false })).status, 200);
  const stored = (await api('/api/settings/localization', { token: ids.tokenEnabled })).data;
  assert.deepEqual([stored.timezone, stored.ntp_server, stored.ntp_check_enabled], ['Europe/Athens', 'time.example.com', false]);
  assert.equal(appTime.timeZone(), 'Europe/Athens', 'the server picks the new zone up straight away');

  const clock = await api('/api/settings/clock', { token: ids.tokenManager });
  assert.equal(clock.status, 200);
  assert.equal(clock.data.timezone, 'Europe/Athens');
  assert.equal(clock.data.today, appTime.today());
  assert.equal((await api('/api/settings/clock', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api('/api/settings/clock/check', { method: 'POST', token: ids.tokenManager, body: { server: 'not a host' } })).status, 400);

  // On PostgreSQL the database's "today" follows the setting too.
  if (process.env.TEST_DATABASE_URL) {
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      assert.equal((await save({ timezone: zone })).status, 200);
      const { today } = await db.prepare('SELECT app_today() AS today').get();
      assert.equal(today, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), zone);
    }
  }
  assert.equal((await save({ timezone: 'Asia/Nicosia', ntp_server: '', ntp_check_enabled: true })).status, 200);
  assert.equal(appTime.timeZone(), 'Asia/Nicosia');
});
