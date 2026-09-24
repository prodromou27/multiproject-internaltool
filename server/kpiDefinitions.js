const DATA_SOURCES = Object.freeze([
  { key: 'manual', label: 'Manual value', description: 'Use an authorized value entered in the definition.' },
  { key: 'project_completion', label: 'Project completion', description: 'Average completion percentage for matching projects.' },
  { key: 'task_completion', label: 'Task completion rate', description: 'Percentage of matching tasks in a completed or closed state.' },
  { key: 'overdue_tasks', label: 'Overdue tasks', description: 'Count of matching open tasks past their due date.' },
  { key: 'service_hours', label: 'Service activity hours', description: 'Recorded service activity duration in hours.' },
]);

const SOURCE_KEYS = new Set(DATA_SOURCES.map(source => source.key));
const DIRECTIONS = new Set(['higher', 'lower']);
const SCOPES = new Set(['organization', 'team', 'project']);
const VISUALIZATIONS = new Set(['number', 'gauge', 'progress', 'trend', 'bar']);

function text(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null) return required ? { error: `${label} is required` } : { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const normalized = value.trim();
  if (required && !normalized) return { error: `${label} is required` };
  if (normalized.length > max) return { error: `${label} cannot exceed ${max} characters` };
  return { value: normalized || null };
}

function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) return { error: `${label} must be a finite number` };
  return { value: number };
}

function positiveInteger(value, label, { min = 0, max = 1000000 } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return { error: `${label} must be an integer from ${min} to ${max}` };
  return { value: number };
}

function validateDefinition(input = {}, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'A KPI definition is required' };
  const required = !partial;
  const result = {};
  for (const [key, label, max, isRequired] of [
    ['name', 'Name', 120, true], ['description', 'Description', 1000, false], ['category', 'Category', 80, true],
  ]) {
    if (input[key] !== undefined || required) {
      const parsed = text(input[key], label, max, { required: isRequired });
      if (parsed.error) return parsed;
      result[key] = parsed.value;
    }
  }
  for (const [key, allowed, label] of [
    ['data_source', SOURCE_KEYS, 'Data source'], ['direction', DIRECTIONS, 'Direction'],
    ['scope_type', SCOPES, 'Scope'], ['visualization_type', VISUALIZATIONS, 'Visualization type'],
  ]) {
    if (input[key] !== undefined || required) {
      if (typeof input[key] !== 'string' || !allowed.has(input[key])) return { error: `${label} is invalid` };
      result[key] = input[key];
    }
  }
  for (const [key, label] of [['target_value', 'Target'], ['warning_threshold', 'Warning threshold'], ['critical_threshold', 'Critical threshold']]) {
    if (input[key] !== undefined || required) {
      const parsed = finiteNumber(input[key], label);
      if (parsed.error) return parsed;
      result[key] = parsed.value;
    }
  }
  if (input.display_order !== undefined || required) {
    const parsed = positiveInteger(input.display_order ?? 0, 'Display order');
    if (parsed.error) return parsed;
    result.display_order = parsed.value;
  }
  if (input.enabled !== undefined || required) {
    if (typeof input.enabled !== 'boolean') return { error: 'Enabled must be true or false' };
    result.enabled = input.enabled;
  }
  if (input.calculation_config !== undefined || required) {
    if (!input.calculation_config || typeof input.calculation_config !== 'object' || Array.isArray(input.calculation_config)) return { error: 'Calculation configuration must be an object' };
    const encoded = JSON.stringify(input.calculation_config);
    if (encoded.length > 4000) return { error: 'Calculation configuration is too large' };
    result.calculation_config = input.calculation_config;
  }
  if ((result.data_source ?? input.data_source) === 'manual') {
    const manual = finiteNumber((result.calculation_config ?? input.calculation_config)?.manual_value, 'Manual value');
    if (manual.error) return manual;
    result.calculation_config = { ...(result.calculation_config ?? input.calculation_config), manual_value: manual.value };
  }
  const scope = result.scope_type ?? input.scope_type;
  if (scope !== undefined || required) {
    const parsedTeam = input.team_id === null || input.team_id === undefined || input.team_id === '' ? { value: null } : positiveInteger(input.team_id, 'Team ID', { min: 1 });
    const parsedProject = input.project_id === null || input.project_id === undefined || input.project_id === '' ? { value: null } : positiveInteger(input.project_id, 'Project ID', { min: 1 });
    if (parsedTeam.error) return parsedTeam;
    if (parsedProject.error) return parsedProject;
    const teamId = parsedTeam.value, projectId = parsedProject.value;
    if (scope === 'team' && !teamId) return { error: 'A team is required for team-scoped KPIs' };
    if (scope === 'project' && !projectId) return { error: 'A project is required for project-scoped KPIs' };
    result.team_id = scope === 'team' ? teamId : null;
    result.project_id = scope === 'project' ? projectId : null;
  }
  const direction = result.direction ?? input.direction;
  const target = result.target_value ?? input.target_value;
  const warning = result.warning_threshold ?? input.warning_threshold;
  const critical = result.critical_threshold ?? input.critical_threshold;
  if (direction && [target, warning, critical].every(Number.isFinite)) {
    if (direction === 'higher' && !(critical <= warning && warning <= target)) return { error: 'For higher-is-better KPIs, critical must be at or below warning, and warning at or below target' };
    if (direction === 'lower' && !(target <= warning && warning <= critical)) return { error: 'For lower-is-better KPIs, target must be at or below warning, and warning at or below critical' };
  }
  return { value: result };
}

function evaluate(value, definition) {
  if (definition.direction === 'higher') {
    if (value < Number(definition.critical_threshold)) return 'critical';
    if (value < Number(definition.warning_threshold)) return 'warning';
  } else {
    if (value > Number(definition.critical_threshold)) return 'critical';
    if (value > Number(definition.warning_threshold)) return 'warning';
  }
  return 'healthy';
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function scopeSql(definition, aliases) {
  if (definition.scope_type === 'organization') return { sql: '', params: [] };
  if (definition.scope_type === 'project') return { sql: ` AND ${aliases.projectId} = ?`, params: [definition.project_id] };
  if (aliases.teamId) return { sql: ` AND ${aliases.teamId} = ?`, params: [definition.team_id] };
  return { sql: ` AND EXISTS (SELECT 1 FROM customer_teams kct WHERE kct.customer_id = ${aliases.customerId} AND kct.team_id = ?)`, params: [definition.team_id] };
}

async function calculateDefinition(db, definition) {
  const config = parseConfig(definition.calculation_config);
  if (definition.data_source === 'manual') {
    const parsed = finiteNumber(config.manual_value, 'Manual value');
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
    return { value: parsed.value, facts: { source: 'manual' } };
  }
  if (definition.data_source === 'project_completion') {
    const scope = scopeSql(definition, { projectId: 'p.id', customerId: 'p.customer_id' });
    const row = await db.prepare(`SELECT COALESCE(AVG(COALESCE(p.completion_pct,0)),0) AS value, COUNT(*) AS records FROM projects p WHERE p.status NOT IN ('closed','cancelled')${scope.sql}`).get(...scope.params);
    return { value: Number(Number(row.value).toFixed(2)), facts: { records: Number(row.records) } };
  }
  if (definition.data_source === 'task_completion') {
    const scope = scopeSql(definition, { projectId: 't.project_id', customerId: 'p.customer_id' });
    const row = await db.prepare(`SELECT COALESCE(100.0 * SUM(CASE WHEN t.status IN ('completed','closed') THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0),0) AS value, COUNT(*) AS records FROM tasks t JOIN projects p ON p.id=t.project_id WHERE 1=1${scope.sql}`).get(...scope.params);
    return { value: Number(Number(row.value).toFixed(2)), facts: { records: Number(row.records) } };
  }
  if (definition.data_source === 'overdue_tasks') {
    const scope = scopeSql(definition, { projectId: 't.project_id', customerId: 'p.customer_id' });
    const row = await db.prepare(`SELECT COUNT(*) AS value FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.deadline IS NOT NULL AND t.deadline < app_today() AND t.status NOT IN ('completed','closed','cancelled')${scope.sql}`).get(...scope.params);
    return { value: Number(row.value), facts: { records: Number(row.value) } };
  }
  if (definition.data_source === 'service_hours') {
    const scope = scopeSql(definition, { projectId: 'sa.related_project_id', customerId: 'sa.customer_id', teamId: 'sa.team_id' });
    const row = await db.prepare(`SELECT COALESCE(SUM(COALESCE(sa.duration_minutes,0)),0) / 60.0 AS value, COUNT(*) AS records FROM service_activities sa WHERE sa.status <> 'cancelled'${scope.sql}`).get(...scope.params);
    return { value: Number(Number(row.value).toFixed(2)), facts: { records: Number(row.records) } };
  }
  throw Object.assign(new Error('Unsupported KPI data source'), { status: 400 });
}

module.exports = { DATA_SOURCES, validateDefinition, evaluate, parseConfig, calculateDefinition };
