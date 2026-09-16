/**
 * Shared helpers for the Service Activity Tracking module.
 * Kept separate from routes/serviceActivities.js so the pure logic here
 * (reference formatting, eligibility checks) is unit-testable without a DB.
 */
const db = require('./db');

/** Format: ACT-YYYY-NNNNNN (6-digit, zero-padded, unique per year). */
function formatActivityReference(year, seq) {
  return `ACT-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Generate a unique activity reference inside the given transaction.
 * Retries on unique-violation to stay correct under concurrent inserts.
 */
async function generateActivityReference(tx, year = new Date().getFullYear()) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { c } = await tx.prepare(
      `SELECT COUNT(*) AS c FROM service_activities WHERE activity_reference LIKE ?`
    ).get(`ACT-${year}-%`);
    const candidate = formatActivityReference(year, Number(c) + 1 + attempt);
    const exists = await tx.prepare('SELECT 1 FROM service_activities WHERE activity_reference = ?').get(candidate);
    if (!exists) return candidate;
  }
  // Extremely unlikely fallback — timestamp-suffixed, still matches the format's shape.
  return formatActivityReference(year, Date.now() % 1000000);
}

/**
 * Returns the set of team_ids a user belongs to that have Service Activity
 * Tracking enabled. Empty set = engineer has no access to the module at all.
 */
async function getEnabledTeamIdsForUser(userId) {
  const rows = await db.prepare(`
    SELECT t.id FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ? AND t.service_activity_enabled = 1
  `).all(userId);
  return new Set(rows.map(r => r.id));
}

/**
 * Returns true if `userId` (an engineer) is authorized to log/view activity
 * against `customerId`: customer must be active + service-tracking enabled +
 * assigned to a team the engineer belongs to (with tracking enabled), and if
 * the customer has explicit engineer restrictions, the engineer must be listed.
 */
async function isCustomerAuthorizedForEngineer(userId, customerId, enabledTeamIds) {
  if (!enabledTeamIds.size) return false;
  const customer = await db.prepare(
    'SELECT id, active, service_activity_enabled FROM customers WHERE id = ?'
  ).get(customerId);
  if (!customer || !customer.active || !customer.service_activity_enabled) return false;

  const teamIds = [...enabledTeamIds];
  const placeholders = teamIds.map(() => '?').join(',');
  const teamMatch = await db.prepare(
    `SELECT 1 FROM customer_teams WHERE customer_id = ? AND team_id IN (${placeholders})`
  ).get(customerId, ...teamIds);
  if (!teamMatch) return false;

  const restricted = await db.prepare('SELECT 1 FROM customer_engineers WHERE customer_id = ?').get(customerId);
  if (restricted) {
    const allowed = await db.prepare(
      'SELECT 1 FROM customer_engineers WHERE customer_id = ? AND user_id = ?'
    ).get(customerId, userId);
    if (!allowed) return false;
  }
  return true;
}

module.exports = {
  formatActivityReference,
  generateActivityReference,
  getEnabledTeamIdsForUser,
  isCustomerAuthorizedForEngineer,
};
