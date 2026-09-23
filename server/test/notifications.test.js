const test = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../notifications');
const { safeSettings, mergeSettings } = require('../integrationSettings');

const { teamsPayload, isLegacyTeamsUrl, webexMarkdown, emailHtml, postJSON, sendTest, _setTransport } = notifications;
const msg = { title: 'T', subtitle: 'S', body: 'B', facts: [{ name: 'Task', value: 'X' }, { name: 'Empty', value: null }] };

test.afterEach(() => _setTransport());

test('Teams payload matches the webhook flavour', () => {
  assert.equal(isLegacyTeamsUrl('https://contoso.webhook.office.com/webhookb2/abc'), true);
  assert.equal(isLegacyTeamsUrl('https://prod-01.westeurope.logic.azure.com/workflows/abc'), false);
  assert.equal(isLegacyTeamsUrl('not a url'), false);
  assert.equal(teamsPayload('https://contoso.webhook.office.com/x', msg)['@type'], 'MessageCard');
  const card = teamsPayload('https://prod-01.westeurope.logic.azure.com/workflows/abc', msg);
  assert.equal(card.type, 'message');
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const facts = card.attachments[0].content.body.find(b => b.type === 'FactSet').facts;
  assert.deepEqual(facts[1], { title: 'Empty', value: '' });
});

test('Webex markdown lists every fact', () => {
  const text = webexMarkdown(msg);
  assert.match(text, /^## T\nB/);
  assert.match(text, /\*\*Task:\*\* X/);
});

test('personal email HTML escapes stored content and omits empty facts', () => {
  const html = emailHtml(msg);
  assert.match(html, /<h2[^>]*>T<\/h2>/);
  assert.match(html, /<p[^>]*>S<\/p>/);
  assert.match(html, />Task</); // fact name rendered
  assert.doesNotMatch(html, />Empty</); // null-valued fact dropped, matching the Teams/Webex behavior
  const hostile = { title: '<img src=x onerror=alert(1)>', body: 'B', facts: [{ name: 'X', value: '<script>1</script>' }] };
  const escaped = emailHtml(hostile);
  assert.doesNotMatch(escaped, /<img|<script/);
  assert.match(escaped, /&lt;img/);
});

test('non-2xx responses reject with the status and body instead of passing silently', async () => {
  _setTransport(async () => ({ status: 400, body: 'Bad   webhook\n', headers: {} }));
  await assert.rejects(postJSON('https://93.184.216.34/hook', {}), /HTTP 400: Bad webhook/);
});

test('5xx responses are retried once, then succeed', async () => {
  let calls = 0;
  _setTransport(async () => (++calls === 1 ? { status: 503, body: '', headers: { 'retry-after': '1' } } : { status: 200, body: 'ok', headers: {} }));
  const res = await postJSON('https://93.184.216.34/hook', {});
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('private targets are refused before any request is made', async () => {
  let called = false;
  _setTransport(async () => { called = true; return { status: 200, body: '', headers: {} }; });
  await assert.rejects(postJSON('https://127.0.0.1/hook', {}));
  await assert.rejects(postJSON('https://169.254.169.254/latest', {}));
  assert.equal(called, false);
});

test('the test button reports real delivery failures and missing configuration', async () => {
  await assert.rejects(sendTest('teams', { teams: {} }), /webhook URL/);
  await assert.rejects(sendTest('webex', { webex: {} }), /bot token/);
  await assert.rejects(sendTest('webex', { webex: { bot_token: 't', mode: 'space' } }), /test email|space ID/);
  await assert.rejects(sendTest('sms', {}), /Unknown platform/);

  _setTransport(async () => ({ status: 401, body: 'invalid token', headers: {} }));
  await assert.rejects(
    sendTest('webex', { webex: { bot_token: 't', mode: 'space', space_id: 'room' } }),
    /HTTP 401: invalid token/,
  );

  const seen = [];
  _setTransport(async (u, data, headers) => { seen.push({ host: u.hostname, body: JSON.parse(data), headers }); return { status: 200, body: '', headers: {} }; });
  await sendTest('webex', { webex: { bot_token: 'tok', mode: 'both', space_id: 'room', test_email: 'a@b.co' } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].headers.Authorization, 'Bearer tok');
  assert.ok(seen.some(s => s.body.toPersonEmail === 'a@b.co') && seen.some(s => s.body.roomId === 'room'));
});

test('all five notification events are exposed and validated', () => {
  const keys = Object.keys(safeSettings({}).notify_on);
  assert.deepEqual(keys.sort(), ['project_assigned', 'report_submitted', 'task_assigned', 'visit_assigned', 'visit_reminder']);
  assert.equal(mergeSettings({}, { notify_on: { report_submitted: false } }).notify_on.report_submitted, false);
  assert.throws(() => mergeSettings({}, { notify_on: { bogus: true } }), e => e.status === 400);
});
