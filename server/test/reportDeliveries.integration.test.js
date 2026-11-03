// Scheduled report deliveries are kept per recipient: retried, recoverable, never blindly resent (review I05).
const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');
const scheduler = require('../customReportScheduler');

const start = new Date('2040-03-05T10:00:00Z');
const at = minutes => new Date(start.getTime() + minutes * 60_000);
const run = async () => ({ columns: [{ key: 'id', label: 'ID' }], rows: [{ id: 1 }], truncated: false });
let people;

async function person(name) {
  const email = `${name.toLowerCase().replace(/\s+/g, '-')}@deliveries.test`;
  const id = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(name, email, bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid;
  return { id, email, token: signJwt({ id }) };
}

// A shared report for two recipients, due now in its own slot.
let slots = 0;
async function scheduledReport(name) {
  people ||= { owner: await person('Delivery Owner'), ana: await person('Ana Recipient'), ben: await person('Ben Recipient') };
  const { owner, ana, ben } = people;
  const report = (await api('/api/reports/custom/saved', { method: 'POST', token: owner.token, body: { name, visibility: 'shared', shared_user_ids: [ana.id, ben.id], shared_team_ids: [], definition: { source: 'tasks', fields: ['id'] } } })).data;
  const path = `/api/reports/custom/saved/${report.id}/schedule`;
  const saved = await api(path, { method: 'PUT', token: owner.token, body: { frequency: 'weekly', day: 1, hour: 9, minute: 0, enabled: true, recipient_ids: [ana.id, ben.id], version: 0 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  await db.prepare('UPDATE custom_report_schedules SET next_run=? WHERE report_id=?').run(`2040-03-0${++slots}T00:00:00.000Z`, report.id);
  const view = async () => (await api(path, { token: owner.token })).data;
  const retry = token => api(`${path}/retry`, { method: 'POST', token: token || owner.token });
  return { report, view, retry };
}

// A mail server that answers per recipient: a function of (address, attempt).
function mailServer(answer) {
  const sent = [], tries = {};
  const send = async mail => {
    tries[mail.to] = (tries[mail.to] || 0) + 1;
    const failure = answer(mail.to, tries[mail.to]);
    if (failure) throw Object.assign(new Error(failure.message || 'SMTP failure'), failure);
    sent.push(mail.to);
    return { messageId: `<${sent.length}@mail.test>`, response: '250 2.0.0 OK queued' };
  };
  return { send, sent, tries };
}
const byName = rows => Object.fromEntries(rows.map(row => [row.user_name, row]));

test('a temporary failure for one recipient is retried; the one who got it is not sent it again', async () => {
  const { view } = await scheduledReport('Weekly deliveries');
  const { ana, ben } = people;
  const mail = mailServer((to, attempt) => (to === ben.email && attempt === 1 ? { responseCode: 421, response: '421 4.7.0 Try again later' } : null));

  await scheduler.tick({ now: start, run, send: mail.send });
  assert.deepEqual(mail.sent, [ana.email]);
  let state = await view();
  let rows = byName(state.deliveries);
  assert.equal(rows['Ana Recipient'].status, 'sent');
  assert.match(rows['Ana Recipient'].provider_response, /250 2\.0\.0 OK/, 'the provider\'s answer is kept');
  assert.equal(rows['Ben Recipient'].status, 'pending');
  assert.match(rows['Ben Recipient'].last_error, /Retry 1 of 2 is scheduled/);
  assert.equal(rows['Ben Recipient'].provider_response, '421 4.7.0 Try again later');
  assert.equal(state.schedule.last_status, 'retrying');

  await scheduler.tick({ now: at(1), run, send: mail.send });
  assert.equal(mail.tries[ben.email], 1, 'not before the wait is over');
  await scheduler.tick({ now: at(6), run, send: mail.send });
  assert.deepEqual(mail.sent, [ana.email, ben.email], 'Ben now, and Ana not again');
  state = await view();
  rows = byName(state.deliveries);
  assert.equal(rows['Ben Recipient'].status, 'sent');
  assert.equal(rows['Ben Recipient'].attempts, 2);
  assert.equal(state.schedule.last_status, 'sent');
});

test('after three temporary failures it stops, and the owner can retry (audited)', async () => {
  const { report, view, retry } = await scheduledReport('Gives up');
  const { ana, ben } = people;
  let down = true;
  const mail = mailServer(to => (down && to === ben.email ? { code: 'ECONNECTION', message: 'connect ECONNREFUSED' } : null));
  for (const minutes of [0, 6, 40, 80]) await scheduler.tick({ now: at(minutes), run, send: mail.send });
  assert.equal(mail.tries[ben.email], 3);
  let state = await view();
  assert.equal(byName(state.deliveries)['Ben Recipient'].status, 'failed');
  assert.match(byName(state.deliveries)['Ben Recipient'].last_error, /Gave up after 3 attempts/);
  assert.equal(state.schedule.last_status, 'partial');
  assert.match(state.schedule.last_error, /1 of 2 recipients not delivered/);

  assert.equal((await retry(ana.token)).status, 403, 'only the owner manages delivery');
  const retried = await retry();
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert.equal(retried.data.retried, 1);
  const audit = await db.prepare("SELECT detail FROM audit_log WHERE entity_type='custom_report' AND entity_id=? AND action='delivery_retried'").get(report.id);
  assert.match(audit.detail, new RegExp(`1 delivery: user ${ben.id}`));
  down = false;
  await scheduler.tick({ now: at(81), run, send: mail.send });
  assert.deepEqual(mail.sent, [ana.email, ben.email]);
  state = await view();
  assert.equal(state.schedule.last_status, 'sent');
  assert.equal((await retry()).status, 409, 'nothing left to retry');
});

test('a refused recipient fails at once; an interrupted send is uncertain and never resent automatically', async () => {
  const { report, view, retry } = await scheduledReport('Refused and interrupted');
  const { ben } = people;
  const mail = mailServer(to => (to === ben.email ? { responseCode: 550, response: '550 5.1.1 Mailbox unavailable' } : null));
  await scheduler.tick({ now: start, run, send: mail.send });
  let rows = byName((await view()).deliveries);
  assert.equal(rows['Ben Recipient'].status, 'failed');
  assert.match(rows['Ben Recipient'].last_error, /refused this recipient/);

  // The process stopped while sending to Ana: after a while, the row is uncertain.
  await db.prepare("UPDATE custom_report_deliveries SET status='sending',attempted_at=? WHERE report_id=? AND user_id=?").run(at(1).toISOString(), report.id, people.ana.id);
  await scheduler.tick({ now: at(5), run, send: mail.send });
  assert.equal(byName((await view()).deliveries)['Ana Recipient'].status, 'sending', 'still possibly in progress');
  await scheduler.tick({ now: at(20), run, send: mail.send });
  rows = byName((await view()).deliveries);
  assert.equal(rows['Ana Recipient'].status, 'uncertain');
  assert.match(rows['Ana Recipient'].last_error, /may or may not have arrived/);
  assert.equal(mail.sent.length, 1, 'Ana is not sent it again on her own');

  // A dropped connection while handing over the message is uncertain too.
  const dropped = mailServer(() => ({ command: 'DATA', code: 'ETIMEDOUT', message: 'Timeout' }));
  assert.equal((await retry()).data.retried, 2);
  await scheduler.tick({ now: at(21), run, send: dropped.send });
  rows = byName((await view()).deliveries);
  assert.equal(rows['Ana Recipient'].status, 'uncertain');
  assert.match(rows['Ana Recipient'].last_error, /may have arrived/);
});

test('a recipient who lost access blocks the slot; nothing is sent', async () => {
  const { view } = await scheduledReport('Access lost');
  await db.prepare("UPDATE users SET role='engineer' WHERE id=?").run(people.ben.id);
  try {
    const mail = mailServer(() => null);
    await scheduler.tick({ now: start, run, send: mail.send });
    assert.deepEqual(mail.sent, []);
    const state = await view();
    assert.equal(state.schedule.last_status, 'blocked');
    assert.equal(state.schedule.enabled, false);
    assert.ok(state.deliveries.every(row => row.status === 'skipped'));
  } finally {
    await db.prepare("UPDATE users SET role='manager' WHERE id=?").run(people.ben.id);
  }
});
