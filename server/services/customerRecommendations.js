const { positiveId } = require('../customerAccess');

const STATUSES = new Set(['open','accepted','rejected','in_progress','implemented','deferred','converted_to_project','closed']);
const AUTHOR_ROLES = new Set(['manager','planner','engineer']);
const TASK_PRIORITIES = new Set(['low','medium','high']);

function validDate(value, minYear = 1900, maxYear = 9998) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0,4));
  if (year < minYear || year > maxYear || Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString().slice(0,10) === value;
}

function capabilitiesFor(role) {
  return {
    can_create: AUTHOR_ROLES.has(role),
    can_convert_project: role === 'manager',
    can_convert_task: AUTHOR_ROLES.has(role),
  };
}

function canEdit(user, row) {
  return user.role === 'manager' || (['planner','engineer'].includes(user.role) && row.created_by === user.id);
}

function validateRecommendation(body, existing = {}) {
  const value = { ...existing, ...body };
  for (const key of ['finding','recommendation']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 10000)
      return { error: `${key} must contain 1 to 10000 characters` };
  }
  if (value.follow_up_notes != null && (typeof value.follow_up_notes !== 'string' || value.follow_up_notes.length > 10000))
    return { error: 'Follow-up notes must be text of at most 10000 characters' };
  if (!['low','medium','high','critical'].includes(value.risk_level ?? 'medium')) return { error: 'Invalid risk level' };
  if (!STATUSES.has(value.status ?? 'open')) return { error: 'Invalid status' };
  if (value.status === 'converted_to_project' && !existing.related_project_id) return { error: 'Use Convert to project to record a conversion' };
  for (const key of ['owner_id','source_visit_id']) {
    if (value[key] != null && value[key] !== '' && !positiveId(value[key])) return { error: `Invalid ${key}` };
  }
  if (value.due_date != null && value.due_date !== '' && !validDate(value.due_date)) return { error: 'Invalid due date' };
  return { value: {
    finding: value.finding.trim(),
    recommendation: value.recommendation.trim(),
    risk_level: value.risk_level ?? 'medium',
    owner_id: value.owner_id ? Number(value.owner_id) : null,
    source_visit_id: value.source_visit_id ? Number(value.source_visit_id) : null,
    due_date: value.due_date || null,
    status: value.status ?? 'open',
    follow_up_notes: value.follow_up_notes || null,
  } };
}

function validateTaskConversion(body, recommendationId) {
  if (!positiveId(recommendationId) || !positiveId(body.version) || !positiveId(body.project_id) || !positiveId(body.assigned_to))
    return { error: 'Valid recommendation version, project and assignee are required' };
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 500)
    return { error: 'Task title must contain 1 to 500 characters' };
  if (!TASK_PRIORITIES.has(body.priority ?? 'medium')) return { error: 'Invalid task priority' };
  if (body.deadline && !validDate(body.deadline)) return { error: 'Invalid task deadline' };
  return { value: {
    recommendation_id: Number(recommendationId),
    version: Number(body.version),
    project_id: Number(body.project_id),
    assigned_to: Number(body.assigned_to),
    title: body.title.trim(),
    priority: body.priority ?? 'medium',
    deadline: body.deadline || null,
  } };
}

module.exports = { STATUSES,AUTHOR_ROLES,capabilitiesFor,canEdit,validateRecommendation,validateTaskConversion,validDate };
