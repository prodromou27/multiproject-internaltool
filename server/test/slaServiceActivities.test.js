const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, team, customer, category, engineer;

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

async function seedActivity(overrides) {
  const n = seedActivity.n = (seedActivity.n || 0) + 1;
  return h.db.prepare(`
    INSERT INTO service_activities
      (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, status, created_by, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `SLA-TEST-${n}`, customer, team, engineer.id, '2026-01-01', category, `SLA test activity ${n}`,
    overrides.status, engineer.id, overrides.created_at, overrides.completed_at ?? null,
  );
}

test.before(async () => {
  h = await harness.start({
    '/api/sla': require('../routes/sla'),
    '/api/teams': require('../routes/teams'),
  });
  manager = await h.makeUser('SLA Overview Manager', 'manager');
  engineer = await h.makeUser('SLA Overview Engineer', 'engineer');
  team = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('SLA Overview Team')).lastInsertRowid;
  customer = (await h.db.prepare("INSERT INTO customers (name, active, service_activity_enabled) VALUES ('SLA Overview Co', 1, 1)").run()).lastInsertRowid;
  category = (await h.db.prepare('SELECT id FROM activity_categories LIMIT 1').get())?.id
    ?? (await h.db.prepare("INSERT INTO activity_categories (name) VALUES ('SLA Category')").run()).lastInsertRowid;

  await h.api(`/api/teams/${team}/sla`, { method: 'PUT', token: manager.token, body: { response_hours: 4, resolution_hours: 24 } });

  await seedActivity({ status: 'planned', created_at: hoursAgoIso(10) });      // response-breached, not yet resolution-breached
  await seedActivity({ status: 'in_progress', created_at: hoursAgoIso(30) });  // resolution-breached
  await seedActivity({ status: 'in_progress', created_at: hoursAgoIso(22) });  // at risk (90%-100% of 24h)
  await seedActivity({ status: 'completed', created_at: hoursAgoIso(40), completed_at: hoursAgoIso(30) }); // 10h duration: on time
  await seedActivity({ status: 'completed', created_at: hoursAgoIso(50), completed_at: hoursAgoIso(20) }); // 30h duration: late
  await seedActivity({ status: 'cancelled', created_at: hoursAgoIso(1000) }); // excluded entirely
});
test.after(() => h.stop());

// /api/sla/overview's maintenance-visit block uses a correlated subquery (string_agg
// of assigned engineers) that pg-mem cannot execute; these run on the real database
// in CI via TEST_DATABASE_URL (see server/test/notificationsSearch.integration.test.js
// for the same pattern).
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem lacks correlated subqueries)' };

test('service activity SLA is evaluated per team, using its configured targets', realDb, async () => {
  const res = await h.api('/api/sla/overview', { token: manager.token });
  assert.equal(res.status, 200);
  const sa = res.data.service_activities;

  assert.equal(sa.total, 5); // cancelled excluded
  assert.equal(sa.response_breached, 1);
  assert.equal(sa.breached, 1);
  assert.equal(sa.at_risk, 1);
  assert.equal(sa.late_complete, 1);

  const bucket = sa.by_team.find(t => t.team_id === team);
  assert.equal(bucket.response_hours, 4);
  assert.equal(bucket.resolution_hours, 24);
  assert.equal(bucket.total, 5);
  assert.equal(bucket.breached, 1);
  assert.equal(bucket.at_risk, 1);
  assert.equal(bucket.late_complete, 1);
  assert.equal(bucket.response_breached, 1);

  assert.ok(res.data.forecast.current_breaches >= 1);
  assert.ok(res.data.forecast.escalation_recommended.some(e => e.type === 'service_activity'));
});

test('SLA overview is manager-only', async () => {
  assert.equal((await h.api('/api/sla/overview', { token: engineer.token })).status, 403);
  assert.equal((await h.api('/api/sla/overview')).status, 401);
});

test('a team with no configured SLA falls back to the 8h/48h defaults', realDb, async () => {
  const otherTeam = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('SLA Default Team')).lastInsertRowid;
  await h.db.prepare(`
    INSERT INTO service_activities
      (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, status, created_by, created_at)
    VALUES ('SLA-DEFAULT-1', ?, ?, ?, '2026-01-01', ?, 'Default team activity', 'in_progress', ?, ?)
  `).run(customer, otherTeam, engineer.id, category, engineer.id, hoursAgoIso(10));
  const res = await h.api('/api/sla/overview', { token: manager.token });
  const bucket = res.data.service_activities.by_team.find(t => t.team_id === otherTeam);
  assert.equal(bucket.response_hours, 8);
  assert.equal(bucket.resolution_hours, 48);
});
