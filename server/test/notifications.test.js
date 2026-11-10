const test = require('node:test');
const assert = require('node:assert/strict');
const notifications = require('../notifications');
const { safeSettings, mergeSettings } = require('../integrationSettings');

const { teamsPayload, isLegacyTeamsUrl, webexMarkdown, messageCard, webexMessage, emailHtml, postJSON, sendTest, _setTransport } = notifications;
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
  assert.deepEqual(facts, [{ title: 'Task', value: 'X' }], 'empty facts are left out');
});

test('one card design for Teams and Webex: coloured title, facts, and a button to the page', () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = 'https://teamhub.example.com/';
  try {
    const card = messageCard({ title: '⚠️ Contract expired', body: 'Not renewed.', facts: [1, 2, 3, 4, 5, 6].map(n => ({ name: `F${n}`, value: n })), link: '/customers/4' });
    assert.equal(card.body[0].text, 'Contract expired', 'the emoji gives way to the colour');
    assert.equal(card.body[0].color, 'Attention');
    assert.equal(card.body.find(b => b.type === 'FactSet').facts.length, 5, 'at most five facts');
    assert.deepEqual(card.actions, [{ type: 'Action.OpenUrl', title: 'Open in TeamHub', url: 'https://teamhub.example.com/customers/4' }]);
    assert.equal(messageCard({ title: '✅ Project closed' }).body[0].color, 'Good');
    assert.equal(messageCard({ title: '📑 Contract ending soon' }).body[0].color, 'Warning');
    assert.equal(messageCard({ title: '📋 New Task Assigned' }).body[0].color, 'Accent');
    const legacy = teamsPayload('https://contoso.webhook.office.com/x', { title: 'T', link: '/tasks' });
    assert.equal(legacy.potentialAction[0].targets[0].uri, 'https://teamhub.example.com/tasks');
    const webex = webexMessage({ roomId: 'r1' }, { title: '🔔 Visit tomorrow', body: 'B', facts: [{ name: 'Visit', value: 'V' }], link: '/maintenance-visits' });
    assert.equal(webex.roomId, 'r1');
    assert.equal(webex.attachments[0].content.type, 'AdaptiveCard');
    assert.match(webex.markdown, /^\*\*Visit tomorrow\*\* {2}\nB/);
    assert.match(webex.markdown, /Visit: \*\*V\*\*/);
    assert.match(webex.markdown, /\[Open in TeamHub\]\(https:\/\/teamhub\.example\.com\/maintenance-visits\)/);
  } finally { if (saved === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved; }
  assert.equal(messageCard({ title: 'T', link: '/x' }).actions, undefined, 'no button without APP_URL');
});

test('Webex markdown lists every fact', () => {
  const text = webexMarkdown(msg);
  assert.match(text, /^\*\*T\*\* {2}\nB/);
  assert.match(text, /Task: \*\*X\*\*/);
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

test('every shared-channel event is exposed with its default, grouped for the settings page, and validated', () => {
  const { SHARED_EVENTS } = require('../sharedEvents');
  const safe = safeSettings({});
  assert.ok(SHARED_EVENTS.length >= 16);
  assert.deepEqual(Object.keys(safe.notify_on).sort(), SHARED_EVENTS.map(event => event.key).sort());
  for (const event of SHARED_EVENTS) assert.equal(safe.notify_on[event.key], event.default, event.key);
  assert.ok(safe.events.every(event => event.key && event.group && event.label));
  assert.equal(safeSettings({ notify_on: { activity_logged: true, task_assigned: false } }).notify_on.activity_logged, true);
  assert.equal(safeSettings({ notify_on: { task_assigned: false } }).notify_on.task_assigned, false);
  assert.equal(mergeSettings({}, { notify_on: { report_submitted: false } }).notify_on.report_submitted, false);
  assert.throws(() => mergeSettings({}, { notify_on: { bogus: true } }), e => e.status === 400);
});

test('personal email shows **bold** as bold, without letting a name inject HTML', () => {
  const html = emailHtml({ title: 'T', body: '**Maria Security** has been assigned a task.' });
  assert.match(html, /<strong>Maria Security<\/strong> has been assigned/);
  assert.doesNotMatch(html, /\*\*/);
  const hostile = emailHtml({ title: 'T', body: '**<img src=x onerror=alert(1)>** was assigned.' });
  assert.doesNotMatch(hostile, /<img/);
  assert.match(hostile, /<strong>&lt;img/);
});
