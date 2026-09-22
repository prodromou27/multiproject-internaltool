/**
 * Per-team Service Activity SLA targets (server/db.js: team_sla_targets).
 * A team with no row uses these defaults — every existing team behaves exactly
 * as before this feature shipped, until a manager explicitly sets its own targets.
 */
const db = require('./db');

const DEFAULT_SLA_TARGETS = { response_hours: 8, resolution_hours: 48 };

function parseHours(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 365) return { error: `${label} must be a positive number of hours (up to a year)` };
  return { value: n };
}

/** Validates a { response_hours, resolution_hours } body. Returns { error } or { value }. */
function validateSlaTargets(body) {
  if (!body || typeof body !== 'object') return { error: 'SLA targets are required' };
  const response = parseHours(body.response_hours, 'response_hours');
  if (response.error) return response;
  const resolution = parseHours(body.resolution_hours, 'resolution_hours');
  if (resolution.error) return resolution;
  if (response.value > resolution.value) return { error: 'response_hours cannot exceed resolution_hours' };
  return { value: { response_hours: response.value, resolution_hours: resolution.value } };
}

/** Returns { [team_id]: { response_hours, resolution_hours } } for every given team id, defaulted. */
async function getTeamSlaTargets(teamIds) {
  const ids = [...new Set(teamIds)];
  const map = Object.fromEntries(ids.map(id => [id, { ...DEFAULT_SLA_TARGETS }]));
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT team_id, response_hours, resolution_hours FROM team_sla_targets WHERE team_id IN (${placeholders})`
  ).all(...ids);
  for (const row of rows) map[row.team_id] = { response_hours: row.response_hours, resolution_hours: row.resolution_hours };
  return map;
}

module.exports = { DEFAULT_SLA_TARGETS, validateSlaTargets, getTeamSlaTargets };
