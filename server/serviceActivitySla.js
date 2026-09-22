/**
 * Pure Service Activity SLA computation, split out of routes/sla.js so it's
 * unit-testable without a database (the route's other SLA blocks use correlated
 * subqueries pg-mem can't run, so the route itself can only be integration-tested
 * against real Postgres — this module lets the actual breach/at-risk math be
 * verified directly instead).
 */

// Stored timestamps are TEXT 'YYYY-MM-DD HH:MM:SS' in UTC (see db.js's app_now()) — treat
// them as such explicitly, since a bare `new Date('YYYY-MM-DD HH:MM:SS')` is ambiguous.
function toUtcDate(value) {
  return new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
}

/**
 * `activity`: { id, activity_reference, title, status, team_id, team_name, created_at, completed_at }
 * `target`: { response_hours, resolution_hours }
 * `statuses`: { completedValue, initialValue }
 * `nowMs`: injectable for tests; defaults to Date.now().
 */
function evaluateActivitySla(activity, target, { completedValue, initialValue }, nowMs = Date.now()) {
  const createdMs = toUtcDate(activity.created_at).getTime();
  const isCompleted = activity.status === completedValue;
  const endMs = isCompleted ? toUtcDate(activity.completed_at || activity.created_at).getTime() : nowMs;
  const elapsedHours = (endMs - createdMs) / 3600000;
  const notStarted = activity.status === initialValue;
  return {
    id: activity.id,
    reference: activity.activity_reference,
    title: activity.title,
    status: activity.status,
    team_id: activity.team_id,
    team_name: activity.team_name,
    customer_name: activity.customer_name,
    created_at: activity.created_at,
    completed_at: activity.completed_at,
    elapsed_hours: Math.round(elapsedHours * 10) / 10,
    response_hours: target.response_hours,
    resolution_hours: target.resolution_hours,
    // Nobody has picked it up yet, and the response window has passed.
    response_breached: notStarted && elapsedHours > target.response_hours,
    // Still open, past the resolution target.
    breached: !isCompleted && elapsedHours > target.resolution_hours,
    // Still open, within the last 10% of the resolution window.
    at_risk: !isCompleted && elapsedHours >= target.resolution_hours * 0.9 && elapsedHours <= target.resolution_hours,
    // Done, but took longer than the resolution target.
    late_complete: isCompleted && elapsedHours > target.resolution_hours,
  };
}

function summarizeByTeam(items) {
  const byTeam = {};
  for (const item of items) {
    byTeam[item.team_id] ||= {
      team_id: item.team_id, team_name: item.team_name,
      response_hours: item.response_hours, resolution_hours: item.resolution_hours,
      total: 0, breached: 0, at_risk: 0, late_complete: 0, response_breached: 0,
    };
    const bucket = byTeam[item.team_id];
    bucket.total++;
    if (item.breached) bucket.breached++;
    if (item.at_risk) bucket.at_risk++;
    if (item.late_complete) bucket.late_complete++;
    if (item.response_breached) bucket.response_breached++;
  }
  return Object.values(byTeam).sort((a, b) => a.team_name.localeCompare(b.team_name));
}

module.exports = { toUtcDate, evaluateActivitySla, summarizeByTeam };
