/**
 * Service Activity payload validation — split out of routes/serviceActivities.js
 * (which was 859 lines mixing this with routing) purely to keep the route file
 * to routing concerns. Behavior is unchanged; this is a relocation, not a rewrite.
 */
const db = require('./db');

const VALID_WORK_LOCATIONS = new Set(['remote', 'onsite', 'internal', 'hybrid']);
const VALID_BILLABLE = new Set(['included_in_contract', 'billable', 'non_billable', 'internal', 'not_applicable']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

/**
 * Validate + resolve a create/update payload against customer-specific rules
 * and cross-entity ownership. Returns { error } or the resolved fields.
 */
async function validateActivityPayload(body, { customerId, isCreate }) {
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return { error: 'Customer not found' };
  if (isCreate && (!customer.active || !customer.service_activity_enabled)) return { error: 'Service Activity Tracking is not enabled for this customer' };

  if (body.title != null && typeof body.title !== 'string') return { error: 'Title must be text' };
  for (const field of ['ticket_reference', 'description', 'customer_impact', 'external_case_reference',
    'change_type', 'change_reason', 'previous_state', 'new_state', 'change_risk', 'customer_approval_reference', 'verification_notes']) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > 10000))
      return { error: `${field} must be text of at most 10000 characters` };
  }
  for (const field of ['customer_id', 'category_id', 'subcategory_id', 'related_project_id', 'related_task_id', 'related_visit_id', 'verified_by']) {
    const value = body[field];
    if (value != null && value !== '' && (!['number', 'string'].includes(typeof value)
      || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1))
      return { error: `${field} must be a positive integer` };
  }
  for (const field of ['follow_up_required', 'rollback_available']) {
    if (body[field] != null && ![true, false, 0, 1].includes(body[field])) return { error: `${field} must be a boolean` };
  }
  for (const field of ['start_time', 'end_time']) {
    if (body[field] != null && body[field] !== '' && (typeof body[field] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])))
      return { error: `${field} must use HH:MM in 24-hour format` };
  }
  if (body.follow_up_date != null && body.follow_up_date !== '') {
    const date = body.follow_up_date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date) return { error: 'Follow-up date must be a valid YYYY-MM-DD date' };
  }
  const title = body.title?.trim();
  if (isCreate || body.title !== undefined) {
    if (!title) return { error: 'Title is required' };
    if (title.length > 300) return { error: 'Title cannot exceed 300 characters' };
  }

  const activityDate = body.activity_date;
  if (!activityDate) return { error: 'Activity date is required' };
  if (activityDate) {
    const d = new Date(activityDate + 'T00:00:00');
    if (typeof activityDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(activityDate) || isNaN(d)
      || d.getFullYear() !== Number(activityDate.slice(0, 4))
      || d.getMonth() + 1 !== Number(activityDate.slice(5, 7))
      || d.getDate() !== Number(activityDate.slice(8, 10))) return { error: 'Invalid activity date' };
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (d > today) return { error: 'Activity date cannot be in the future' };
  }

  if (!body.category_id) return { error: 'Category is required' };
  let category = null;
  if (body.category_id) {
    category = await db.prepare('SELECT require_asset FROM activity_categories WHERE id = ? AND active = 1').get(body.category_id);
    if (!category) return { error: 'Invalid category' };
  }
  if (body.subcategory_id) {
    const sub = await db.prepare('SELECT 1 FROM activity_subcategories WHERE id = ? AND category_id = ?').get(body.subcategory_id, body.category_id);
    if (!sub) return { error: 'Subcategory does not belong to the selected category' };
  }

  if (body.priority && !VALID_PRIORITIES.has(body.priority)) return { error: 'Invalid priority' };
  if (body.work_location && !VALID_WORK_LOCATIONS.has(body.work_location)) return { error: 'Invalid work location' };
  if (body.billable_classification && !VALID_BILLABLE.has(body.billable_classification)) return { error: 'Invalid billable classification' };

  if (body.start_time && body.end_time && body.end_time < body.start_time)
    return { error: 'End time cannot be before start time' };

  for (const field of ['duration_minutes', 'billable_minutes']) {
    const value = body[field];
    if (value != null && value !== '' && (!['number', 'string'].includes(typeof value)
      || !Number.isSafeInteger(Number(value)) || Number(value) < (field === 'duration_minutes' ? 1 : 0)
      || Number(value) > 1440)) return { error: `${field} must be whole minutes within one day` };
  }
  if (body.technology_ids !== undefined) {
    if (!Array.isArray(body.technology_ids) || body.technology_ids.length > 100
      || body.technology_ids.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(body.technology_ids).size !== body.technology_ids.length)
      return { error: 'Technology IDs must be a list of unique positive integers' };
    if (body.technology_ids.length) {
      const ids = body.technology_ids;
      const rows = await db.prepare(`SELECT id FROM technologies WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      if (rows.length !== ids.length) return { error: 'Invalid or inactive technology' };
    }
  }
  if (body.asset_ids !== undefined) {
    if (!Array.isArray(body.asset_ids) || body.asset_ids.length > 100
      || body.asset_ids.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(body.asset_ids).size !== body.asset_ids.length)
      return { error: 'Asset IDs must be a list of unique positive integers' };
    if (body.asset_ids.length) {
      const rows = await db.prepare(`SELECT id FROM customer_assets WHERE customer_id=? AND id IN (${body.asset_ids.map(() => '?').join(',')})`).all(Number(customerId),...body.asset_ids);
      if (rows.length !== body.asset_ids.length) return { error: 'Every selected asset must belong to the activity customer' };
    }
  }
  // Optional per-asset version: {"<assetId>": "1.2.3"}. Only for assets on this activity.
  if (body.asset_versions !== undefined && body.asset_versions !== null) {
    const versions = body.asset_versions;
    if (typeof versions !== 'object' || Array.isArray(versions)) return { error: 'Asset versions must be an object keyed by asset ID' };
    const selected = new Set((body.asset_ids || []).map(String));
    for (const [assetId, version] of Object.entries(versions)) {
      if (!selected.has(assetId)) return { error: 'A version can only be recorded for an asset selected on this activity' };
      if (version != null && (typeof version !== 'string' || version.trim().length > 100)) return { error: 'Asset version must be text of at most 100 characters' };
    }
  }
  // Categories that describe changing a specific device (Upgrade, Patch / Firmware
  // Update by default) require the asset to be named — but only when the customer
  // has assets to choose from, so a customer with no inventory yet isn't a dead end.
  if (category?.require_asset && !(body.asset_ids || []).length) {
    const { c } = await db.prepare("SELECT COUNT(*) AS c FROM customer_assets WHERE customer_id=? AND lifecycle_status NOT IN ('retired','decommissioned')").get(Number(customerId));
    if (Number(c) > 0) return { error: 'This category requires you to select the asset that was worked on' };
  }

  if (body.follow_up_required && !body.follow_up_date)
    return { error: 'Follow-up date is required when follow-up is required' };

  // Related entities, if supplied, must belong to the same customer.
  if (body.related_project_id) {
    const p = await db.prepare('SELECT 1 FROM projects WHERE id = ? AND customer_id = ?').get(body.related_project_id, customerId);
    if (!p) return { error: 'Related project does not belong to the selected customer' };
  }
  if (body.related_task_id) {
    const t = await db.prepare(`
      SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.customer_id = ?
    `).get(body.related_task_id, customerId);
    if (!t) return { error: 'Related task does not belong to the selected customer' };
  }
  if (body.related_visit_id) {
    const v = await db.prepare('SELECT 1 FROM maintenance_visits WHERE id = ? AND customer_id = ?').get(body.related_visit_id, customerId);
    if (!v) return { error: 'Related maintenance visit does not belong to the selected customer' };
  }
  if (body.follow_up_task_id) {
    const task = await db.prepare(`SELECT t.project_id, p.customer_id FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(body.follow_up_task_id);
    if (task?.project_id && task.customer_id !== Number(customerId)) return { error: 'Follow-up task does not belong to the selected customer' };
  }

  // Customer-specific requirement rules
  const durationProvided = body.duration_minutes != null && body.duration_minutes !== '';
  if (customer.require_duration && !durationProvided) return { error: 'Duration is required for this customer' };
  if (customer.require_ticket_reference && !body.ticket_reference?.trim()) return { error: 'Ticket reference is required for this customer' };
  if (customer.require_technology && !(Array.isArray(body.technology_ids) && body.technology_ids.length)) return { error: 'At least one technology is required for this customer' };
  if (customer.require_notes && !body.description?.trim()) return { error: 'Notes are required for this customer' };
  if (customer.require_billable_classification && !body.billable_classification) return { error: 'Billable classification is required for this customer' };

  return { customer };
}

/**
 * A category with team_id set is only usable for activities that resolve to that
 * team — not just any team the engineer happens to also belong to. Checked
 * separately from validateActivityPayload (rather than folded into it) so that
 * other validation errors — e.g. a related project not belonging to the new
 * customer — still surface first when a request has multiple problems; this
 * check only matters once team resolution has actually succeeded.
 */
async function assertCategoryUsableByTeam(categoryId, teamId) {
  const cat = await db.prepare('SELECT team_id FROM activity_categories WHERE id = ?').get(categoryId);
  if (cat?.team_id != null && cat.team_id !== teamId)
    return 'This category is not available to the team this activity belongs to';
  return null;
}

/** Category-level "require attachment" rule can only realistically be checked once
 * the activity exists (attachments FK to the activity id), so it's enforced here —
 * at the point status is being set to the terminal Completed value — rather than
 * at initial creation. */
async function assertAttachmentRuleSatisfied(activityId, categoryId) {
  const category = await db.prepare('SELECT require_attachment FROM activity_categories WHERE id = ?').get(categoryId);
  if (!category?.require_attachment) return null;
  const { c } = await db.prepare('SELECT COUNT(*) AS c FROM attachments WHERE service_activity_id = ?').get(activityId);
  if (!c) return 'This category requires at least one attachment before the activity can be marked completed';
  return null;
}

module.exports = {
  VALID_WORK_LOCATIONS, VALID_BILLABLE, VALID_PRIORITIES,
  validateActivityPayload, assertCategoryUsableByTeam, assertAttachmentRuleSatisfied,
};
