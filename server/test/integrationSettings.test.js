const test = require('node:test');
const assert = require('node:assert/strict');
const { safeSettings,mergeSettings } = require('../integrationSettings');
test('integration credentials are write-only, retained by default and explicitly removable', () => {
  const stored = { teams: { enabled: true,webhook_url: 'https://example.com/private-webhook' },webex: { enabled: true,bot_token: 'private-token',mode: 'both' },notify_on: { task_assigned: true } };
  const safe = safeSettings(stored);
  assert.equal(JSON.stringify(safe).includes('private-'),false);
  assert.equal(safe.teams.webhook_url_set,true);
  assert.equal(safe.webex.bot_token_set,true);
  const retained = mergeSettings(stored,safe);
  assert.equal(retained.teams.webhook_url,stored.teams.webhook_url);
  assert.equal(retained.webex.bot_token,stored.webex.bot_token);
  assert.equal(mergeSettings(stored,{ webex: { bot_token: 'replacement' } }).webex.bot_token,'replacement');
  const cleared = mergeSettings(stored,{ teams: { clear_webhook_url: true },webex: { clear_bot_token: true } });
  assert.equal(cleared.teams.webhook_url,'');
  assert.equal(cleared.webex.bot_token,'');
  for (const value of [[],{ webex: [] },{ teams: { enabled: 'false' } },{ webex: { bot_token: {} } },{ webex: { mode: 'sql' } }]) assert.throws(() => mergeSettings(stored,value),error => error.status===400);
});
