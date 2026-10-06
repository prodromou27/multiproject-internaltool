const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { catalogue, validateTables, tableFor } = require('../reportTables');
const { renderExcel } = require('../managedCustomerExcelRenderer');
const { renderWord } = require('../managedCustomerWordRenderer');
const { templateData } = require('../managedReportDocx');

const ticket = (number, subject, priority, created) => ({ ticket_number: number, subject, normalized_status: 'open', normalized_priority: priority, owner_name: 'Ann', created_at_external: created });
const model = (tables = {}) => ({
  customer: { name: 'Northwind Logistics' },
  period: { from: '2026-10-01', to: '2026-10-31' },
  generated_at: '2026-10-31T09:00:00Z',
  narratives: {},
  sections: ['open_tickets', 'period_tickets', 'service_activities', 'assets'],
  overview: { tickets: { open_now: 2 }, activities: { activities: 3, hours: 4 }, tasks: { open_now: 0 }, projects: { active_now: 0 }, visits: { visits_period: 0 }, recommendations: { open_now: 0 } },
  tickets: { enabled: true, open: { rows: [ticket('101', 'VPN down', 'high', '2026-10-02'), ticket('102', 'Printer', 'low', '2026-10-03')] }, period: { rows: [ticket('103', 'New user', 'normal', '2026-10-04')] } },
  activities: { enabled: true, rows: [
    { activity_date: '2026-10-04', activity_reference: 'ACT-1', title: 'Firmware upgrade', engineer_name: 'Maria', category_name: 'Upgrade', duration_minutes: 90, description: 'Upgraded to 7.4.3' },
    { activity_date: '2026-10-09', activity_reference: 'ACT-2', title: 'Backup check', engineer_name: 'Nick', category_name: 'Check', duration_minutes: 30 },
    { activity_date: '2026-10-02', activity_reference: 'ACT-3', title: 'Policy review', engineer_name: 'Maria', category_name: 'Review', duration_minutes: 120 },
  ] },
  tasks: { enabled: false }, projects: { enabled: false }, maintenance_visits: { enabled: false }, recommendations: { enabled: false },
  assets: [{ name: 'FW-01', type: 'firewall', vendor: 'Fortinet', model: 'FG-100F', version: '7.4.3', support_end: '2027-01-01', support_status: 'Supported', warranty_status: 'In warranty' }],
  tables,
});

test('each format keeps its usual columns when the template chooses none', () => {
  const doc = tableFor(model(), 'service_activities', 'document'), xls = tableFor(model(), 'service_activities', 'spreadsheet');
  assert.deepEqual(doc.columns.map(c => c.label), ['Date', 'Reference', 'Activity', 'Asset / version', 'Engineer', 'Category', 'Hours']);
  assert.deepEqual(xls.columns.map(c => c.key), ['date', 'reference', 'activity', 'assets', 'engineer', 'category', 'minutes', 'location', 'billing', 'ticket']);
  assert.equal(doc.rows[0][6], 1.5, 'hours from minutes');
  assert.equal(tableFor({ ...model(), tickets: { enabled: false } }, 'open_tickets'), null, 'no tickets without ticketing');
  const entry = catalogue().find(t => t.key === 'assets');
  assert.ok(entry.columns.some(c => c.key === 'vendor' && !c.default_document), 'extra columns are offered but off by default');
});

test("a template's columns, order, sorting and row limit shape the table", () => {
  const tables = validateTables({ service_activities: { columns: ['engineer', 'date', 'description'], sort: { column: 'date', direction: 'desc' }, limit: 2 } });
  const table = tableFor(model(tables), 'service_activities');
  assert.deepEqual(table.columns.map(c => c.label), ['Engineer', 'Date', 'Description']);
  assert.deepEqual(table.rows, [['Nick', '2026-10-09', ''], ['Maria', '2026-10-04', 'Upgraded to 7.4.3']]);
  const byHours = tableFor(model(validateTables({ service_activities: { columns: ['reference'], sort: { column: 'minutes' } } })), 'service_activities');
  assert.deepEqual(byHours.rows.map(r => r[0]), ['ACT-2', 'ACT-1', 'ACT-3'], 'numbers sort as numbers');
});

test('table choices are checked', () => {
  assert.deepEqual(validateTables(undefined), {});
  for (const bad of [[], { nope: { columns: ['x'] } }, { assets: { columns: [] } }, { assets: { columns: ['ghost'] } },
    { assets: { columns: ['asset'], sort: { column: 'ghost' } } }, { assets: { columns: ['asset'], limit: 0 } }, { assets: { columns: ['asset'], limit: 1.5 } }])
    assert.throws(() => validateTables(bad), error => error.status === 400, JSON.stringify(bad));
  assert.deepEqual(validateTables({ assets: { columns: ['asset', 'asset', 'vendor'], sort: { column: 'asset', direction: 'sideways' }, limit: '10' } }),
    { assets: { columns: ['asset', 'vendor'], sort: { column: 'asset', direction: 'asc' }, limit: 10 } });
});

test('Excel uses the chosen columns, and splits tickets when the two ticket tables differ', async () => {
  const load = async m => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await renderExcel(m)); return workbook; };
  const standard = await load(model());
  assert.deepEqual(standard.worksheets.map(s => s.name), ['Summary', 'Tickets', 'Activities', 'Assets']);
  assert.equal(standard.getWorksheet('Tickets').getRow(1).getCell(1).value, 'Report set');
  assert.equal(standard.getWorksheet('Tickets').getRow(4).getCell(1).value, 'Created in period');

  const custom = await load(model(validateTables({ open_tickets: { columns: ['ticket', 'priority'], sort: { column: 'priority' } }, assets: { columns: ['asset', 'vendor', 'model'] } })));
  assert.deepEqual(custom.worksheets.map(s => s.name), ['Summary', 'Open Tickets', 'Tickets Created During Period', 'Activities', 'Assets']);
  const open = custom.getWorksheet('Open Tickets');
  assert.deepEqual([open.getRow(1).getCell(1).value, open.getRow(1).getCell(2).value, open.getRow(2).getCell(2).value], ['Ticket', 'Priority', 'high']);
  assert.deepEqual(custom.getWorksheet('Assets').getRow(2).values.slice(1), ['FW-01', 'Fortinet', 'FG-100F']);
});

test('Word uses the chosen columns, and uploaded Word templates get the sorting and limit', async () => {
  const tables = validateTables({ service_activities: { columns: ['reference', 'description'], sort: { column: 'date' }, limit: 1 } });
  const xml = await (await JSZip.loadAsync(await renderWord(model(tables)))).file('word/document.xml').async('string');
  assert.match(xml, /Description/);
  assert.match(xml, /ACT-3/);
  assert.doesNotMatch(xml, /ACT-1|Engineer/);
  assert.deepEqual(templateData(model(tables)).activities.map(a => a.reference), ['ACT-3']);
});
