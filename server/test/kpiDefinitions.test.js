const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDefinition, evaluate } = require('../kpiDefinitions');

const valid = {
  name: 'Delivery confidence', description: 'Average active project completion', category: 'Delivery',
  data_source: 'project_completion', calculation_config: {}, target_value: 90,
  warning_threshold: 75, critical_threshold: 50, direction: 'higher', scope_type: 'organization',
  team_id: null, project_id: null, enabled: true, display_order: 10, visualization_type: 'gauge',
};

test('KPI definitions validate scope and direction-aware thresholds', () => {
  assert.equal(validateDefinition(valid).error, undefined);
  assert.match(validateDefinition({ ...valid, critical_threshold: 80 }).error, /higher-is-better/);
  assert.equal(validateDefinition({ ...valid, direction: 'lower', target_value: 2, warning_threshold: 4, critical_threshold: 8 }).error, undefined);
  assert.match(validateDefinition({ ...valid, scope_type: 'team' }).error, /team is required/i);
  assert.match(validateDefinition({ ...valid, scope_type: 'project', project_id: 'bad' }).error, /Project ID/);
});

test('manual definitions require a finite configured value', () => {
  assert.match(validateDefinition({ ...valid, data_source: 'manual', calculation_config: {} }).error, /Manual value/);
  assert.equal(validateDefinition({ ...valid, data_source: 'manual', calculation_config: { manual_value: 12.5 } }).value.calculation_config.manual_value, 12.5);
});

test('KPI values receive deterministic health statuses', () => {
  assert.equal(evaluate(49, valid), 'critical');
  assert.equal(evaluate(60, valid), 'warning');
  assert.equal(evaluate(90, valid), 'healthy');
  const lower = { direction: 'lower', warning_threshold: 4, critical_threshold: 8 };
  assert.equal(evaluate(3, lower), 'healthy');
  assert.equal(evaluate(6, lower), 'warning');
  assert.equal(evaluate(10, lower), 'critical');
});
