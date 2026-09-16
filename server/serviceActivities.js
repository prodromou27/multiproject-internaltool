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
 * A per-year counter row serializes allocation across concurrent transactions.
 * Seed from existing references once so upgrades preserve their numbering.
 */
async function generateActivityReference(tx, year = new Date().getFullYear()) {
  let counter = await tx.prepare(`UPDATE service_activity_sequences
    SET last_value = last_value + 1 WHERE year = ? RETURNING last_value`).get(year);
  if (!counter) {
    counter = await tx.prepare(`INSERT INTO service_activity_sequences (year, last_value)
      SELECT CAST(? AS INTEGER), COALESCE(MAX(CAST(substr(activity_reference, 10, 6) AS INTEGER)), 0) + 1
      FROM service_activities WHERE activity_reference LIKE ?
      ON CONFLICT (year) DO UPDATE SET last_value = service_activity_sequences.last_value + 1
      RETURNING last_value`).get(year, `ACT-${year}-%`);
  }
  if (counter.last_value > 999999) throw new Error('Service activity reference limit reached for this year');
  return formatActivityReference(year, counter.last_value);
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
