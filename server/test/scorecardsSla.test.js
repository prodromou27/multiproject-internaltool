const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');
const { workingDaysBetween } = require('../workingDays');

test('working days skip weekends, exclude the start day and include the end day', () => {
  assert.equal(workingDaysBetween('2026-09-18', '2026-09-18'), 0);   // same day
  assert.equal(workingDaysBetween('2026-09-19', '2026-09-18'), 0);   // reversed
  assert.equal(workingDaysBetween('2026-09-18', '2026-09-21'), 1);   // Fri -> Mon
  assert.equal(workingDaysBetween('2026-09-14', '2026-09-21'), 5);   // Mon -> next Mon
  assert.equal(workingDaysBetween('2026-09-19', '2026-09-20'), 0);   // Sat -> Sun
  assert.equal(workingDaysBetween('2026-10-24 08:00:00', '2026-10-27T09:00:00Z'), 2); // Sat -> Tue, timestamps, across DST end in Europe
  assert.equal(workingDaysBetween('2026-03-27', '2026-03-31'), 2);   // across DST start in Europe
});

let h, manager, engineer, planner, other, project, project2;

test.before(async () => {
  h = await harness.start({ '/api/scorecards': require('../routes/scorecards') });
  manager = await h.makeUser('Score Manager', 'manager');
  engineer = await h.makeUser('Score Engineer', 'engineer');
  other = await h.makeUser('Score Other', 'engineer');
  planner = await h.makeUser('Score Planner', 'planner');
  const mkProject = async title => (await h.db.prepare("INSERT INTO projects (title, status, created_by) VALUES (?, 'closed', ?)").run(title, manager.id)).lastInsertRowid;
  project = await mkProject('Scored one');
  project2 = await mkProject('Scored two');
});
test.after(() => h.stop());

const ratings = { timeline_rating: 5, delivery_quality: 5, communication_ownership: 5, documentation_quality: 5, customer_feedback: 5 };

test('scorecards are manager-only to write, and computed with the difficulty multiplier', async () => {
  const body = { project_id: project, engineer_id: engineer.id, ...ratings, difficulty: 3 };
  assert.equal((await h.api('/api/scorecards', { method: 'POST', token: engineer.token, body })).status, 403);
  assert.equal((await h.api('/api/scorecards', { method: 'POST', token: planner.token, body })).status, 403);

  const created = await h.api('/api/scorecards', { method: 'POST', token: manager.token, body });
  assert.equal(created.status, 200);
  assert.equal(created.data.base_score, 100);
  assert.equal(created.data.adjusted_score, 100);          // capped at 100
  assert.equal(created.data.rating, 'Exceptional');

  const low = await h.api('/api/scorecards', { method: 'POST', token: manager.token,
    body: { project_id: project2, engineer_id: other.id, timeline_rating: 3, delivery_quality: 3, communication_ownership: 3, documentation_quality: 3, customer_feedback: 3, difficulty: 1 } });
  assert.equal(low.data.base_score, 60);
  assert.equal(low.data.adjusted_score, 54);               // 60 * 0.90
  assert.equal(low.data.rating, 'Performance Concern');
});

test('a duplicate scorecard is a 409, not a 500', async () => {
  const res = await h.api('/api/scorecards', { method: 'POST', token: manager.token,
    body: { project_id: project, engineer_id: engineer.id, ...ratings } });
  assert.equal(res.status, 409);
});

test('create rejects invalid ids, ratings and difficulty', async () => {
  const post = body => h.api('/api/scorecards', { method: 'POST', token: manager.token, body });
  const ok = { project_id: project2, engineer_id: engineer.id, ...ratings };
  assert.equal((await post({ ...ok, project_id: undefined })).status, 400);
  assert.equal((await post({ ...ok, engineer_id: 'abc' })).status, 400);
  assert.equal((await post({ ...ok, timeline_rating: 6 })).status, 400);
  assert.equal((await post({ ...ok, delivery_quality: 2.5 })).status, 400);
  assert.equal((await post({ ...ok, customer_feedback: undefined })).status, 400);
  assert.equal((await post({ ...ok, difficulty: 9 })).status, 400);
  assert.equal((await post({ ...ok, difficulty: 'hard' })).status, 400);
});

test('updating without difficulty keeps the stored difficulty instead of writing NaN', async () => {
  const list = (await h.api('/api/scorecards', { token: manager.token })).data;
  const card = list.find(c => c.engineer_id === other.id);
  assert.equal(card.difficulty, 1);

  const updated = await h.api(`/api/scorecards/${card.id}`, { method: 'PUT', token: manager.token, body: { timeline_rating: 4 } });
  assert.equal(updated.status, 200);
  // (4*.15 + 3*.85) / 5 = 63.0 base; difficulty 1 (x0.90) => 56.7
  assert.equal(updated.data.base_score, 63);
  const after = (await h.api('/api/scorecards', { token: manager.token })).data.find(c => c.id === card.id);
  assert.equal(after.difficulty, 1);
  assert.equal(after.adjusted_score, 56.7);

  assert.equal((await h.api(`/api/scorecards/${card.id}`, { method: 'PUT', token: manager.token, body: { difficulty: 7 } })).status, 400);
  assert.equal((await h.api(`/api/scorecards/${card.id}`, { method: 'PUT', token: engineer.token, body: { difficulty: 2 } })).status, 403);
  assert.equal((await h.api('/api/scorecards/99999999', { method: 'PUT', token: manager.token, body: {} })).status, 404);
});

// pg-mem cannot filter a joined query by a bound parameter; this runs on the real database in CI.
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem: lookups on joins)' };
test('only managers can list every scorecard; others see just their own', realDb, async () => {
  assert.equal((await h.api('/api/scorecards', { token: manager.token })).data.length, 2);
  const mine = (await h.api('/api/scorecards', { token: engineer.token })).data;
  assert.deepEqual(mine.map(c => c.engineer_id), [engineer.id]);
  // An engineer cannot widen the list with query filters.
  assert.deepEqual((await h.api(`/api/scorecards?engineer_id=${other.id}`, { token: engineer.token })).data.map(c => c.engineer_id), [engineer.id]);
  assert.deepEqual((await h.api('/api/scorecards', { token: planner.token })).data, []);
});
