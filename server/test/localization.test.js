const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, engineer, planner;

test.before(async () => {
  h = await harness.start({ '/api/settings': require('../routes/settings') });
  manager = await h.makeUser('Locale Manager', 'manager');
  engineer = await h.makeUser('Locale Engineer', 'engineer');
  planner = await h.makeUser('Locale Planner', 'planner');
});
test.after(() => h.stop());

test('every authenticated role can read localization settings, but only managers can change them', async () => {
  for (const user of [manager, engineer, planner]) {
    const res = await h.api('/api/settings/localization', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.timezone, 'Asia/Nicosia'); // default, before any save
  }
  assert.equal((await h.api('/api/settings/localization')).status, 401);

  const body = { default_language: 'el', supported_languages: ['en', 'el'], date_format: 'YYYY-MM-DD', time_format: '12h', number_format: '1.000,00', timezone: 'Europe/Athens' };
  assert.equal((await h.api('/api/settings/localization', { method: 'PUT', token: engineer.token, body })).status, 403);
  assert.equal((await h.api('/api/settings/localization', { method: 'PUT', token: planner.token, body })).status, 403);
  assert.equal((await h.api('/api/settings/localization', { method: 'PUT', token: manager.token, body })).status, 200);

  // The change is visible to every role, immediately.
  for (const user of [manager, engineer, planner]) {
    const after = await h.api('/api/settings/localization', { token: user.token });
    assert.equal(after.data.timezone, 'Europe/Athens');
    assert.equal(after.data.date_format, 'YYYY-MM-DD');
  }
});

// Regression: the server's allow-lists previously only covered a subset of what
// client/src/pages/admin/LocalizationTab.jsx actually offers — picking one of the
// missing options silently saved the default instead of the chosen value.
test('every date and number format the client offers is accepted, not silently dropped', async () => {
  for (const date_format of ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY', 'MMM D, YYYY']) {
    const saved = await h.api('/api/settings/localization', { method: 'PUT', token: manager.token, body: { date_format } });
    assert.equal(saved.status, 200);
    assert.equal((await h.api('/api/settings/localization', { token: manager.token })).data.date_format, date_format);
  }
  for (const number_format of ['1,000.00', '1.000,00', '1 000.00', '1000.00']) {
    await h.api('/api/settings/localization', { method: 'PUT', token: manager.token, body: { number_format } });
    assert.equal((await h.api('/api/settings/localization', { token: manager.token })).data.number_format, number_format);
  }
  // An unrecognized value still falls back to the default rather than being stored verbatim.
  await h.api('/api/settings/localization', { method: 'PUT', token: manager.token, body: { date_format: 'not-a-real-format' } });
  assert.equal((await h.api('/api/settings/localization', { token: manager.token })).data.date_format, 'DD/MM/YYYY');
});
