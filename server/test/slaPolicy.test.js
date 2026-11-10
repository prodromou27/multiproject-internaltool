const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, engineer, customer;
const hoursFromNow = hours => new Date(Date.now() + hours * 3600000).toISOString();

test.before(async () => {
  h = await harness.start({ '/api/sla': require('../routes/sla') });
  manager = await h.makeUser('SLA Policy Manager', 'manager');
  engineer = await h.makeUser('SLA Policy Engineer', 'engineer');
  customer = (await h.db.prepare("INSERT INTO customers (name, active) VALUES ('SLA Ticket Co', 1)").run()).lastInsertRowid;
});
test.after(() => h.stop());

// The overview's visit block uses a correlated subquery pg-mem cannot run.
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem lacks correlated subqueries)' };

test('managers set each SLA on or off and its limit', async () => {
  assert.equal((await h.api('/api/sla/policy', { token: engineer.token })).status, 403);
  const initial = await h.api('/api/sla/policy', { token: manager.token });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.policy.visit_report, { enabled: true, limit: 7 });
  assert.ok(initial.data.slas.some(sla => sla.key === 'tickets'));
  for (const bad of [{ nope: { enabled: true, limit: 1 } }, { visit_report: { enabled: 'yes', limit: 5 } }, { visit_report: { enabled: true, limit: 0 } }, []])
    assert.equal((await h.api('/api/sla/policy', { method: 'PUT', token: manager.token, body: bad })).status, 400, JSON.stringify(bad));
  const saved = await h.api('/api/sla/policy', { method: 'PUT', token: manager.token, body: { visit_report: { enabled: true, limit: 5 }, task_response: { enabled: false, limit: 1 }, tickets: { enabled: true, limit: 12 } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.policy.visit_report, { enabled: true, limit: 5 });
  assert.equal(saved.data.policy.task_response.enabled, false);
  assert.deepEqual(saved.data.policy.project_update, { enabled: true, limit: 7 }, 'unsent ones keep their defaults');
});

test('the overview uses the limits, leaves switched-off SLAs empty and checks tickets against their due dates', realDb, async () => {
  const ticket = (n, group, due, resolved = null) => h.db.prepare(`INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group, sla_due_at, resolved_at_external)
    VALUES (?, 'request_tracker', 'q', 'Queue', ?, ?, ?, ?, ?, ?, ?, ?)`).run(customer, `sla-${n}`, String(n), `Ticket ${n}`, group, group === 'open' ? 'Open' : 'Resolved', group, due, resolved);
  await ticket(1, 'open', hoursFromNow(-2));                    // past due
  await ticket(2, 'open', hoursFromNow(6));                     // due within the 12-hour warning
  await ticket(3, 'open', hoursFromNow(48));                    // fine
  await ticket(4, 'closed', hoursFromNow(-30), hoursFromNow(-20)); // resolved late
  await ticket(5, 'closed', hoursFromNow(-30), hoursFromNow(-40)); // resolved on time
  await h.db.prepare("INSERT INTO tasks (title, status, priority, created_by, created_at) VALUES ('Urgent', 'open', 'high', ?, '2026-01-01 09:00:00')").run(manager.id);

  const res = await h.api('/api/sla/overview', { token: manager.token });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.mv.sla_days, 5);
  assert.equal(res.data.high_priority_tasks.enabled, false);
  assert.equal(res.data.high_priority_tasks.total, 0, 'switched off');
  const t = res.data.tickets;
  assert.deepEqual([t.enabled, t.breached, t.at_risk, t.late_complete, t.on_time], [true, 1, 1, 1, 1]);
  assert.equal(t.items.find(item => item.ticket_number === '1').customer_name, 'SLA Ticket Co');
  assert.equal(res.data.service_activities, undefined, 'the activity SLA is gone');
  assert.ok(res.data.forecast.escalation_recommended.some(e => e.type === 'ticket'));
  assert.equal((await h.api('/api/sla/overview', { token: engineer.token })).status, 403);
});
