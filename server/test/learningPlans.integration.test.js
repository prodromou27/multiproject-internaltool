// Engineer learning plans (enhancement E08).
const { test, assert, api, db, ids, bcrypt, signJwt } = require('./lib/activityFixture');

let tech, mentor, mentorToken, plan;
const create = (body, token = ids.tokenManager) => api('/api/skills/plans', { method: 'POST', token, body });

test('a skill gap becomes a plan with a mentor, a target and evidence steps; the engineer and mentor are told', async () => {
  tech = (await db.prepare("INSERT INTO technologies (name) VALUES ('Plan Tech') RETURNING id").get()).id;
  mentor = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Mona Mentor', 'mona.mentor@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  mentorToken = signJwt({ id: mentor });
  await db.prepare('INSERT INTO engineer_skills (user_id, technology_id, level) VALUES (?, ?, 4)').run(mentor, tech);

  const body = { user_id: ids.engineerEnabled, technology_id: tech, target_level: 3, target_date: '2027-03-31', mentor_id: mentor, steps: ['Shadow two upgrades', 'Lead one upgrade'] };
  assert.equal((await create(body, ids.tokenEnabled)).status, 403, 'engineers cannot set up plans');
  assert.equal((await create({ ...body, target_level: 7 })).status, 400);
  assert.equal((await create({ ...body, target_date: '2027-02-30' })).status, 400);
  assert.equal((await create({ ...body, mentor_id: ids.engineerEnabled })).status, 400, 'not their own mentor');
  const made = await create(body);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  plan = made.data;
  assert.deepEqual([plan.engineer_name, plan.technology_name, plan.mentor_name, plan.target_level, plan.status], ['Engineer Enabled', 'Plan Tech', 'Mona Mentor', 3, 'active']);
  assert.deepEqual(plan.steps.map(s => [s.title, s.done_at]), [['Shadow two upgrades', null], ['Lead one upgrade', null]]);
  assert.equal((await create(body)).status, 409, 'one active plan per engineer and technology');

  await require('../notifications').settled();
  assert.ok(await db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'A learning plan for Plan Tech was set up with you'").get(ids.engineerEnabled));
  assert.ok(await db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'You are mentoring Engineer Enabled on Plan Tech'").get(mentor));

  const list = await api('/api/skills/plans', { token: ids.tokenManager });
  assert.ok(list.data.plans.some(p => p.id === plan.id));
  assert.ok(list.data.mentors.some(m => m.id === mentor && m.technology_id === tech && m.level === 4), 'Senior-or-better engineers, as mentor suggestions');
});

test('the engineer sees and ticks off their own steps; nobody else may', async () => {
  const mine = await api('/api/skills/plans/mine', { token: ids.tokenEnabled });
  assert.deepEqual(mine.data.plans.map(p => p.id), [plan.id]);
  assert.deepEqual((await api('/api/skills/plans/mine', { token: mentorToken })).data.plans.map(p => p.id), [plan.id], 'and the mentor');
  assert.equal((await api('/api/skills/plans', { token: ids.tokenEnabled })).status, 403, 'not the whole list');

  const tick = (token, done = true, step = plan.steps[0].id) => api(`/api/skills/plans/${plan.id}/steps/${step}`, { method: 'PUT', token, body: { done } });
  assert.equal((await tick(mentorToken)).status, 403, 'the mentor guides but does not tick for them');
  const ticked = await tick(ids.tokenEnabled);
  assert.equal(ticked.status, 200, JSON.stringify(ticked.data));
  assert.ok(ticked.data.steps[0].done_at);
  assert.equal((await tick(ids.tokenEnabled, true, 999999)).status, 404);
});

test('managers review progress and close the plan; the skill rating is never changed by it', async () => {
  const review = await api(`/api/skills/plans/${plan.id}/reviews`, { method: 'POST', token: ids.tokenManager, body: { note: 'Good progress on the first upgrade.' } });
  assert.equal(review.status, 201);
  assert.equal(review.data.reviews[0].note, 'Good progress on the first upgrade.');
  assert.equal((await api(`/api/skills/plans/${plan.id}/reviews`, { method: 'POST', token: ids.tokenEnabled, body: { note: 'x' } })).status, 403);

  const done = await api(`/api/skills/plans/${plan.id}`, { method: 'PUT', token: ids.tokenManager, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  assert.equal(done.data.status, 'completed');
  assert.equal(await db.prepare('SELECT level FROM engineer_skills WHERE user_id = ? AND technology_id = ?').get(ids.engineerEnabled, tech), undefined, 'no rating appears by itself');
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'learning_plan' AND action = 'plan_completed' AND entity_id = ?").get(plan.id));
  assert.deepEqual((await api('/api/skills/plans/mine', { token: ids.tokenEnabled })).data.plans, [], 'only active plans in My Work');
  assert.equal((await create({ user_id: ids.engineerEnabled, technology_id: tech, target_level: 4, target_date: '2027-09-30' })).status, 201, 'a new plan once the last is closed');
});
