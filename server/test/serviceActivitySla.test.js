const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateActivitySla, summarizeByTeam, toUtcDate } = require('../serviceActivitySla');

const target = { response_hours: 4, resolution_hours: 24 };
const statuses = { completedValue: 'completed', initialValue: 'planned' };
const NOW = Date.parse('2026-09-22T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);

function activity(overrides) {
  return { id: 1, activity_reference: 'ACT-2026-000001', title: 'Test', team_id: 1, team_name: 'Team A', customer_name: 'Acme', status: 'planned', created_at: hoursAgo(0), completed_at: null, ...overrides };
}

test('toUtcDate parses the stored space-separated UTC text format', () => {
  assert.equal(toUtcDate('2026-09-22 12:00:00').getTime(), Date.parse('2026-09-22T12:00:00Z'));
  assert.equal(toUtcDate('2026-09-22T12:00:00Z').getTime(), Date.parse('2026-09-22T12:00:00Z'));
});

test('an activity still in its initial status past the response window is response_breached, but not yet resolution-breached', () => {
  const result = evaluateActivitySla(activity({ status: 'planned', created_at: hoursAgo(10) }), target, statuses, NOW);
  assert.equal(result.response_breached, true);
  assert.equal(result.breached, false);
  assert.equal(result.at_risk, false);
  assert.equal(result.late_complete, false);
  assert.equal(result.elapsed_hours, 10);
});

test('an in-progress activity is not response_breached even past the response window — someone has picked it up', () => {
  const result = evaluateActivitySla(activity({ status: 'in_progress', created_at: hoursAgo(10) }), target, statuses, NOW);
  assert.equal(result.response_breached, false);
});

test('resolution breach and at-risk are mutually exclusive, at the 90%-100% boundary', () => {
  assert.deepEqual(
    [evaluateActivitySla(activity({ status: 'in_progress', created_at: hoursAgo(21.5) }), target, statuses, NOW).at_risk,
     evaluateActivitySla(activity({ status: 'in_progress', created_at: hoursAgo(21.5) }), target, statuses, NOW).breached],
    [false, false], // just under the 90% (21.6h) at-risk threshold
  );
  const atRisk = evaluateActivitySla(activity({ status: 'in_progress', created_at: hoursAgo(22) }), target, statuses, NOW);
  assert.equal(atRisk.at_risk, true);
  assert.equal(atRisk.breached, false);
  const breached = evaluateActivitySla(activity({ status: 'in_progress', created_at: hoursAgo(25) }), target, statuses, NOW);
  assert.equal(breached.at_risk, false);
  assert.equal(breached.breached, true);
});

test('a completed activity is judged by its actual duration, not elapsed time since now', () => {
  const onTime = evaluateActivitySla(activity({ status: 'completed', created_at: hoursAgo(1000), completed_at: hoursAgo(990) }), target, statuses, NOW);
  assert.equal(onTime.elapsed_hours, 10);
  assert.equal(onTime.late_complete, false);
  assert.equal(onTime.breached, false); // completed activities are never "breached" (still open), only late_complete

  const late = evaluateActivitySla(activity({ status: 'completed', created_at: hoursAgo(1000), completed_at: hoursAgo(960) }), target, statuses, NOW);
  assert.equal(late.elapsed_hours, 40);
  assert.equal(late.late_complete, true);
  assert.equal(late.breached, false);
  assert.equal(late.at_risk, false);
});

test('a completed activity with no completed_at recorded does not crash and reads as zero elapsed', () => {
  const created = hoursAgo(50);
  const result = evaluateActivitySla(activity({ status: 'completed', created_at: created, completed_at: null }), target, statuses, NOW);
  assert.equal(result.elapsed_hours, 0);
  assert.equal(result.late_complete, false);
});

test('summarizeByTeam aggregates per team and sorts by team name', () => {
  const items = [
    evaluateActivitySla(activity({ team_id: 2, team_name: 'Zeta', status: 'in_progress', created_at: hoursAgo(30) }), target, statuses, NOW),
    evaluateActivitySla(activity({ team_id: 1, team_name: 'Alpha', status: 'planned', created_at: hoursAgo(10) }), target, statuses, NOW),
    evaluateActivitySla(activity({ team_id: 1, team_name: 'Alpha', status: 'in_progress', created_at: hoursAgo(1) }), target, statuses, NOW),
  ];
  const byTeam = summarizeByTeam(items);
  assert.deepEqual(byTeam.map(t => t.team_name), ['Alpha', 'Zeta']);
  const alpha = byTeam.find(t => t.team_name === 'Alpha');
  assert.equal(alpha.total, 2);
  assert.equal(alpha.response_breached, 1);
  const zeta = byTeam.find(t => t.team_name === 'Zeta');
  assert.equal(zeta.total, 1);
  assert.equal(zeta.breached, 1);
});
