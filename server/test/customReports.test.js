const test = require('node:test');
const assert = require('node:assert/strict');
const { metadata,compileReport,csvCell } = require('../customReports');
const base = { source: 'tasks',fields: ['id','title'] };
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
