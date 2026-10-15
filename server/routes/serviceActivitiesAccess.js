/**
 * Express middleware and access-scoped query helpers for the Service Activity
 * Tracking routes — split out of routes/serviceActivities.js. Kept separate
 * from server/serviceActivities.js (pure, DB-only helpers, unit-tested without
 * an Express app) since everything here takes req/res/next.
 */
const db = require('../db');
const { logAudit } = require('../auditLog');
const { getEnabledTeamIdsForUser, isCustomerAuthorizedForEngineer } = require('../serviceActivities');
const { attemptTicketWriteback } = require('../ticketWriteback');

const positiveRouteId = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

/** Middleware: engineer must belong to at least one team with tracking enabled.
 * Managers always pass (they administer/oversee all enabled teams). */
async function requireServiceActivityAccess(req, res, next) {
  if (req.user.role === 'manager') { req.enabledTeamIds = null; return next(); }
  if (!['engineer', 'pm'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const enabled = await getEnabledTeamIdsForUser(req.user.id);
  if (!enabled.size) return res.status(403).json({ error: 'Service Activity Tracking is not enabled for your team' });
  req.enabledTeamIds = enabled;
  next();
}

async function requireOwnedActivity(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid ID' });
  const activity = await db.prepare('SELECT * FROM service_activities WHERE id = ?').get(id);
  if (!activity) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && activity.engineer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  req.activity = activity;
  next();
}

async function requireAuthorizedActivityCustomer(req, res, next) {
  if (req.user.role !== 'manager'
    && !await isCustomerAuthorizedForEngineer(req.user.id, req.activity.customer_id, req.enabledTeamIds))
    return res.status(403).json({ error: 'You are not authorized to log activity for this customer' });
  next();
}

async function resolveActivityTeam(req, customerId, preferredTeamId) {
  const assigned = await db.prepare('SELECT team_id FROM customer_teams WHERE customer_id = ? ORDER BY team_id').all(customerId);
  const eligible = req.user.role === 'manager' ? assigned : assigned.filter(t => req.enabledTeamIds.has(t.team_id));
  return eligible.find(t => t.team_id === preferredTeamId)?.team_id || eligible[0]?.team_id;
}

/**
 * Called only on the transition INTO the terminal Completed status. Best-effort:
 * never throws (attemptTicketWriteback already catches RT failures), and never
 * blocks the response on anything other than the RT call itself succeeding or
 * failing — the activity is already saved as completed by the time this runs,
 * so a slow or unreachable RT should not appear to fail the completion.
 */
async function writeBackTicketOnCompletion(req, { id, title, customerId, ticketReference }) {
  const outcome = await attemptTicketWriteback({ customerId, ticketReference });
  if (!outcome.attempted) return;
  const detail = outcome.ok ? `ticket_id=${outcome.ticket_id}; ${outcome.message}` : `ticket_id=${outcome.ticket_id}; error=${outcome.error}`;
  await logAudit(db, req, 'service_activity', id, title, outcome.ok ? 'ticket_writeback_succeeded' : 'ticket_writeback_failed', detail);
}

// req.enabledTeamIds is null for managers (see requireServiceActivityAccess) — they see
// every team's categories, since a manager may log on behalf of any team.
async function categoriesForTeams(enabledTeamIds) {
  if (enabledTeamIds === null) {
    return db.prepare('SELECT * FROM activity_categories WHERE active = 1 ORDER BY sort_order, name').all();
  }
  const teamIds = [...enabledTeamIds];
  const placeholders = teamIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM activity_categories WHERE active = 1 AND (team_id IS NULL OR team_id IN (${placeholders})) ORDER BY sort_order, name`
  ).all(...teamIds);
}

/* ── List/export filter builder ──────────────────────────────────────── */
function activityFilters(query, user) {
  const integer = (key, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error(`Invalid ${key}`);
    return Number(value);
  };
  for (const key of ['from', 'to', 'status', 'billable_classification', 'search']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !query[key].trim() || query[key].length > (key === 'search' ? 300 : 100))) throw new Error(`Invalid ${key}`);
  }
  const { from, to, status, billable_classification, search } = query;
  for (const [key, value] of [['from', from], ['to', to]]) {
    if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`Invalid ${key}`);
  }
  if (from && to && from > to) throw new Error('From date cannot be after To date');
  const customer_id = integer('customer_id');
  const category_id = integer('category_id');
  const technology_id = integer('technology_id');
  const page = integer('page', 1);
  const limit = integer('page_size', 25, 200);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page');
  let where = 'WHERE 1=1';
  const params = [];
  if (user.role !== 'manager') {
    where += ' AND sa.engineer_id = ?'; params.push(user.id);
  }
  if (from)         { where += ' AND sa.activity_date >= ?'; params.push(from); }
  if (to)           { where += ' AND sa.activity_date <= ?'; params.push(to); }
  if (customer_id)  { where += ' AND sa.customer_id = ?'; params.push(customer_id); }
  if (category_id)  { where += ' AND sa.category_id = ?'; params.push(category_id); }
  if (status)        { where += ' AND sa.status = ?'; params.push(status); }
  if (billable_classification) { where += ' AND sa.billable_classification = ?'; params.push(billable_classification); }
  if (technology_id) {
    where += ' AND EXISTS (SELECT 1 FROM service_activity_technologies sat WHERE sat.service_activity_id = sa.id AND sat.technology_id = ?)';
    params.push(technology_id);
  }
  if (search?.trim()) {
    where += ' AND (sa.title ILIKE ? OR sa.description ILIKE ? OR sa.activity_reference ILIKE ? OR sa.ticket_reference ILIKE ?)';
    const q = `%${search.trim()}%`;
    params.push(q, q, q, q);
  }

  return { where, params, page, limit, offset };
}

module.exports = {
  positiveRouteId,
  requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer,
  resolveActivityTeam, writeBackTicketOnCompletion, categoriesForTeams, activityFilters,
};
