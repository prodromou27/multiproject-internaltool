const test = require('node:test');
const assert = require('node:assert/strict');
const { metadata,compileReport,csvCell } = require('../customReports');
const base = { source: 'tasks',fields: ['id','title'] };
test('report templates compile with explicit UTC dates and configured terminal states', () => {
  const { reportTemplates } = require('../reportTemplates');
  const templates = reportTemplates(new Date('2024-02-29T23:59:59Z'),{ project: [{ value: 'archived',is_terminal: true }] });
  assert.equal(templates.month_start,'2024-02-01');
  assert.equal(templates.month_end,'2024-02-29');
  assert.equal(templates.rows.length,11);
  for (const template of templates.rows) assert.doesNotThrow(() => compileReport(template.definition,100));
  const overdue = compileReport(templates.rows.find(row => row.key==='overdue_projects').definition,100);
  assert.match(overdue.sql,/r.status NOT IN \(\?,\?,\?\)/);
  assert.deepEqual(overdue.params.slice(0,4),['2024-02-29','closed','cancelled','archived']);
  assert.equal(reportTemplates(new Date('2026-12-31T12:00:00Z')).month_end,'2026-12-31');
  assert.throws(() => compileReport({ ...base,filters: [{ field: 'id',operator: 'not_in',value: ['1'] }] },100),error => error.status===400);
});
test('CSV cells escape delimiters and protect spreadsheet formula strings', () => {
  assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');
  assert.equal(csvCell(' =SUM(A1:A2)'),`"' =SUM(A1:A2)"`);
  assert.equal(csvCell('@formula'),`"'@formula"`);
  assert.equal(csvCell(-2),'"-2"');
  assert.equal(csvCell(null),'""');
});
test('report compilation parameterizes values and restricts structural identifiers', () => {
  const value = "x' OR 1=1 -- %_\\";
  const report = compileReport({ ...base,filters: [{ field: 'title',operator: 'contains',value }] },100);
  assert.equal(report.sql.includes(value),false);
  assert.equal(report.params[0], "%x' or 1=1 -- \\%\\_\\\\%");
  assert.equal(report.params.at(-1),101);
  for (const definition of [
    { ...base,source: '__proto__' }, { ...base,fields: ['password'] }, { ...base,fields: ['title; DROP TABLE tasks'] },
    { ...base,sql: 'SELECT * FROM users' }, { ...base,filters: [{ field: 'id',operator: 'eq',value: '1' }] },
    { ...base,filters: [{ field: 'deadline',operator: 'eq',value: '2026-02-29' }] },
    { ...base,filters: [{ field: 'id',operator: 'in',value: [] }] },
    { ...base,sort: [{ field: 'title',direction: 'asc; DROP TABLE users' }] },
    { ...base,fields: ['title','title'] }, { ...base,aggregations: [{ field: 'title',operation: 'sum' }] },
  ]) assert.throws(() => compileReport(definition,100),error => error.status===400);
});
test('report aggregation uses stable groups and approved numeric operations', () => {
  const report = compileReport({ source: 'activities',fields: ['customer_id'],group_by: ['customer_id'],aggregations: [{ field: '*',operation: 'count' },{ field: 'duration_minutes',operation: 'sum' }],sort: [{ field: 'metric_1',direction: 'desc' }] },100);
  assert.match(report.sql,/GROUP BY r.customer_id/);
  assert.match(report.sql,/SUM\(r.duration_minutes\) DESC NULLS LAST,r.customer_id ASC/);
  assert.deepEqual(report.columns.map(column => column.key),['customer_id','metric_0','metric_1']);
  assert.equal(JSON.stringify(metadata()).includes('sql'),false);
  for (const source of metadata()) for (const field of source.fields) assert.ok(!/password|secret|token|notes|email|storage/i.test(field.key));
});
