// Contextual customer responses (enhancement E07).
const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');
// The email module after the fixture (it sets up the test database first).
const email = require('../email');
const sent = [];
let smtpOn = true;
email.getSmtpSettings = async () => (smtpOn ? { host: 'smtp.test.local' } : null);
email.sendEmail = async mail => { sent.push(mail); return { messageId: '<1@test>' }; };
const { fill } = require('../responseComposer');

let template, customer, task, visit, outsiderToken;
const compose = (context, token = ids.tokenManager, id = template) => api(`/api/customer-responses/${id}/compose`, { method: 'POST', token, body: { context } });
const send = (body, token = ids.tokenManager) => api(`/api/customer-responses/${template}/send`, { method: 'POST', token, body });

test('placeholders are filled only from known names; unknown text is left alone', () => {
  assert.deepEqual(fill('Hi {{contact_name}}, {{ visit_date }} {{nope}} {{task_title}}', { contact_name: 'Dana', visit_date: '2026-10-20' }),
    { text: 'Hi Dana, 2026-10-20 {{nope}} {{task_title}}', missing: ['task_title'] });
});

test('a response is filled from a visit the person may open, with the customer contact as the only recipient', async () => {
  customer = (await db.prepare('INSERT INTO customers (name, active, contact_email, primary_contact) VALUES (?, 1, ?, ?)').run('Compose Ltd', 'ops@compose.example', 'Dana Ops')).lastInsertRowid;
  template = (await api('/api/customer-responses', { method: 'POST', token: ids.tokenManager, body: { title: 'Visit on {{visit_date}}', body: 'Dear {{contact_name}},\nwe will visit {{customer_name}} on {{visit_date}} at {{visit_time}} ({{visit_engineers}}).\nTask: {{task_title}}\n{{my_name}}' } })).data.id;
  visit = (await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, start_time, status, created_by) VALUES (?, 'Firewall check', '2026-10-20', '09:30', 'scheduled', ?)").run(customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);

  const res = await compose({ type: 'visit', id: visit });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.subject, 'Visit on 2026-10-20');
  assert.match(res.data.body, /^Dear Dana Ops,\nwe will visit Compose Ltd on 2026-10-20 at 09:30 \(Engineer Enabled\)\./);
  assert.deepEqual(res.data.missing, [{ name: 'task_title', label: 'Task title' }], 'a visit has no task: shown, not guessed');
  assert.deepEqual(res.data.recipients, ['ops@compose.example']);
  assert.equal(res.data.email_available, false, 'emails to customers are off by default (turned on below)');

  assert.equal((await compose({ type: 'visit', id: visit }, ids.tokenEnabled)).status, 200, 'the engineer on the visit');
});

test('emails to customers are off until a manager turns them on: copy only, and sending is refused', async () => {
  const setting = (body, token = ids.tokenManager) => api('/api/report-settings/customer-email', { method: body ? 'PUT' : 'GET', token, body });
  assert.deepEqual((await setting()).data, { enabled: false }, 'off by default');
  const res = await compose({ type: 'visit', id: visit });
  assert.equal(res.status, 200);
  assert.deepEqual([res.data.email_available, res.data.customer_email_off], [false, true]);
  const refused = await send({ context: { type: 'visit', id: visit }, to: 'ops@compose.example', subject: 'Visit on 2026-10-20', body: 'Dear Dana Ops, see you then.' });
  assert.deepEqual([refused.status, refused.data.code], [403, 'CUSTOMER_EMAIL_OFF']);
  assert.equal(sent.length, 0);
  assert.equal((await setting({ enabled: true }, ids.tokenEnabled)).status, 403, 'managers only');
  assert.equal((await setting({ enabled: 'yes' })).status, 400);
  assert.deepEqual((await setting({ enabled: true })).data, { enabled: true });
  const audit = await db.prepare("SELECT detail FROM audit_log WHERE action = 'customer_email_updated' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.detail, 'on');
});

test('records the person may not open are not found, and nothing of them is shown', async () => {
  const outsider = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Outside Engineer', 'outside@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  outsiderToken = signJwt({ id: outsider });
  task = (await db.prepare("INSERT INTO tasks (title, customer_id, assigned_to, status, created_by) VALUES ('Rotate keys', ?, ?, 'not_started', ?)").run(customer, ids.engineerEnabled, ids.manager)).lastInsertRowid;
  for (const context of [{ type: 'visit', id: visit }, { type: 'task', id: task }, { type: 'customer', id: customer }]) {
    const res = await compose(context, outsiderToken);
    assert.equal(res.status, 404, `${context.type}: ${JSON.stringify(res.data)}`);
    assert.doesNotMatch(JSON.stringify(res.data), /Compose Ltd|Dana/);
  }
  assert.equal((await compose({ type: 'task', id: task }, ids.tokenEnabled)).status, 200, 'the assigned engineer');
  assert.equal((await compose({ type: 'invoice', id: 1 })).status, 404);
  assert.equal((await compose({ type: 'visit', id: visit }, ids.tokenManager, 'no-such-template')).status, 404);
});

test('sending is explicit, only to the contact on record, with nothing left unfilled, and audited', async () => {
  const context = { type: 'visit', id: visit };
  const base = { context, to: 'ops@compose.example', subject: 'Visit on 2026-10-20', body: 'Dear Dana Ops, see you then.' };
  assert.equal((await send({ ...base, to: 'someone@else.example' })).status, 400, 'no other addresses');
  assert.equal((await send({ ...base, body: 'Task: {{task_title}}' })).status, 400, 'placeholders left');
  assert.equal((await send({ ...base, subject: 'Two\nlines' })).status, 400);
  assert.equal((await send(base, outsiderToken)).status, 404);
  assert.equal(sent.length, 0);
  const ok = await send(base);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(sent, [{ to: 'ops@compose.example', subject: 'Visit on 2026-10-20', text: 'Dear Dana Ops, see you then.' }]);
  const audit = await db.prepare("SELECT entity_id, detail FROM audit_log WHERE entity_type = 'customer_response' AND action = 'sent' ORDER BY id DESC LIMIT 1").get();
  assert.deepEqual([Number(audit.entity_id), audit.detail], [customer, `visit ${visit} to ops@compose.example`]);

  smtpOn = false;
  assert.equal((await compose(context)).data.email_available, false, 'no email set up: copy only');
});
