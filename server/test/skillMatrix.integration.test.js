const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const rate = (userId, technologyId, body, token = ids.tokenManager) =>
  api(`/api/skills/ratings/${userId}/${technologyId}`, { method: 'PUT', token, body });

test('only people allowed to see the skill matrix can open it; engineers cannot', async () => {
  assert.equal((await api('/api/skills', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api('/api/skills', { token: ids.tokenPlanner })).status, 403, 'planners need the permission granted');
  const res = await api('/api/skills', { token: ids.tokenManager });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.levels.map(l => l.label), ['Junior', 'Intermediate', 'Senior', 'Expert']);
  assert.ok(res.data.engineers.some(e => e.id === ids.engineerEnabled));
  assert.ok(!res.data.engineers.some(e => e.id === ids.manager), 'only engineers are rated');
  assert.equal(res.data.can_manage, true);
});

test('managers rate engineers, and coverage shows gaps and single points of knowledge', async () => {
  const tech = (await api('/api/technologies', { method: 'POST', token: ids.tokenManager, body: { name: 'Skill Matrix Firewalls' } })).data.id;
  const other = (await api('/api/technologies', { method: 'POST', token: ids.tokenManager, body: { name: 'Skill Matrix Backup' } })).data.id;
  const coverageOf = async id => (await api('/api/skills', { token: ids.tokenManager })).data.coverage.find(c => c.technology_id === id);

  assert.equal((await coverageOf(tech)).status, 'gap');
  assert.equal((await rate(ids.engineerEnabled, tech, { level: 4, note: 'NSE 7' })).status, 200);
  let c = await coverageOf(tech);
  assert.deepEqual([c.status, c.skilled, c.single_point, c.by_level[4]], ['at_risk', 1, true, 1]);

  assert.equal((await rate(ids.engineerDisabled, tech, { level: 3 })).status, 200);
  c = await coverageOf(tech);
  assert.deepEqual([c.status, c.skilled, c.single_point], ['covered', 2, false]);

  // A higher target makes it at risk again; a re-rating replaces the old one.
  assert.equal((await api(`/api/skills/technologies/${tech}/target`, { method: 'PUT', token: ids.tokenManager, body: { target: 3 } })).status, 200);
  assert.equal((await coverageOf(tech)).status, 'at_risk');
  assert.equal((await rate(ids.engineerDisabled, tech, { level: 2 })).status, 200);
  c = await coverageOf(tech);
  assert.deepEqual([c.skilled, c.rated, c.by_level[2]], [1, 2, 1]);

  const page = (await api('/api/skills', { token: ids.tokenManager })).data;
  const mine = page.ratings.find(r => r.user_id === ids.engineerEnabled && r.technology_id === tech);
  assert.deepEqual([mine.level, mine.note, mine.rated_by_name], [4, 'NSE 7', 'Manager One']);

  // Removing a rating; junior-only technologies are still gaps.
  assert.equal((await rate(ids.engineerDisabled, tech, { level: null })).status, 200);
  assert.equal((await coverageOf(tech)).rated, 1);
  assert.equal((await rate(ids.engineerEnabled, other, { level: 1 })).status, 200);
  assert.equal((await coverageOf(other)).status, 'gap');

  const audit = await db.prepare("SELECT action, detail FROM audit_log WHERE entity_type='engineer_skill' ORDER BY id").all();
  assert.ok(audit.some(a => a.detail === 'Rated Expert'));
  assert.ok(audit.some(a => a.action === 'deleted'));
});

test('bad ratings are refused, and engineers cannot rate', async () => {
  const tech = ids.technology;
  assert.equal((await rate(ids.engineerEnabled, tech, { level: 5 })).status, 400);
  assert.equal((await rate(ids.engineerEnabled, tech, { level: '3' })).status, 400);
  assert.equal((await rate(ids.engineerEnabled, tech, { level: 2, note: 'x'.repeat(501) })).status, 400);
  assert.equal((await rate(ids.manager, tech, { level: 2 })).status, 404, 'only engineers are rated');
  assert.equal((await rate(ids.engineerEnabled, 999999, { level: 2 })).status, 404);
  assert.equal((await rate(ids.engineerEnabled, tech, { level: 2 }, ids.tokenEnabled)).status, 403);
  assert.equal((await api(`/api/skills/technologies/${tech}/target`, { method: 'PUT', token: ids.tokenManager, body: { target: 0 } })).status, 400);
});

test('logged activities show as evidence, and customer devices show demand', async () => {
  const tech = (await api('/api/technologies', { method: 'POST', token: ids.tokenManager, body: { name: 'Skill Matrix Evidence' } })).data.id;
  const today = appTime.today();
  for (const [ref, date, status] of [['SKILL-1', today, 'completed'], ['SKILL-2', today, 'completed'], ['SKILL-3', today, 'cancelled'], ['SKILL-OLD', appTime.addDays(today, -400), 'completed']]) {
    const id = (await db.prepare('INSERT INTO service_activities (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,created_by,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(ref, ids.customer, ids.teamEnabled, ids.engineerEnabled, date, ids.category, ref, ids.manager, status)).lastInsertRowid;
    await db.exec(`INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (${Number(id)}, ${Number(tech)})`);
  }
  await db.prepare("INSERT INTO customer_assets (customer_id, technology_id, name, asset_type, created_by) VALUES (?, ?, 'FW-1', 'firewall', ?)").run(ids.customer, tech, ids.manager);
  const page = (await api('/api/skills', { token: ids.tokenManager })).data;
  const evidence = page.activity.find(a => a.user_id === ids.engineerEnabled && a.technology_id === tech);
  assert.deepEqual([evidence.activities, evidence.last_date], [2, today], 'cancelled and older than a year are left out');
  const t = page.technologies.find(x => x.id === tech);
  assert.deepEqual([t.devices, t.customers, t.skill_target], [1, 1, 2]);
});
