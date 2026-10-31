const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const harness = require('./lib/harness');

let h, manager, planner, engineer, project;

async function upload(path, token, buffer, filename = 'effort.xlsx') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(h.baseUrl + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' },
    body: form,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Builds a workbook matching the color-coded effort-sheet format parseEffortSheet expects:
// EDC297 = product/category header, D9D9D9 (col A) = task group, FFEB9C (col C) = a task row.
async function buildEffortSheet() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Solutions');
  ws.getCell('A6').value = 'Customer Name';       ws.getCell('B6').value = 'Acme Corp';
  ws.getCell('A7').value = 'Q - Reference';        ws.getCell('B7').value = 'Q-123';

  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${argb}` } });
  ws.getCell('C20').value = 'Security';            ws.getCell('C20').fill = fill('EDC297');
  ws.getCell('C21').value = 'Firewall';             // sub-product row (no fill, col A/D empty)
  ws.getCell('A22').fill = fill('D9D9D9');          ws.getCell('C22').value = 'Implementation'; // task group row
  ws.getCell('A23').value = 'T1';
  ws.getCell('B23').value = 'Security Eng';
  ws.getCell('C23').value = 'Configure firewall rules'; ws.getCell('C23').fill = fill('FFEB9C');
  ws.getCell('D23').value = 2;
  ws.getCell('E23').value = 4;
  ws.getCell('F23').value = 1;

  return wb.xlsx.writeBuffer();
}

test.before(async () => {
  h = await harness.start({ '/api/projects': require('../routes/importExcel') });
  manager = await h.makeUser('Import Manager', 'manager');
  planner = await h.makeUser('Import Planner', 'planner');
  engineer = await h.makeUser('Import Engineer', 'engineer');
  project = (await h.db.prepare("INSERT INTO projects (title, status, created_by) VALUES ('Import target', 'in_progress', ?)").run(manager.id)).lastInsertRowid;
});
test.after(() => h.stop());

test('preview is manager/planner-only, requires a file and an existing project', async () => {
  const buffer = await buildEffortSheet();
  assert.equal((await upload(`/api/projects/${project}/import-excel/preview`, engineer.token, buffer)).status, 403);
  assert.equal((await upload('/api/projects/99999999/import-excel/preview', manager.token, buffer)).status, 404);

  const noFile = await h.api(`/api/projects/${project}/import-excel/preview`, { method: 'POST', token: manager.token, body: {} });
  assert.equal(noFile.status, 400);

  const corrupt = await upload(`/api/projects/${project}/import-excel/preview`, manager.token, Buffer.from('not an xlsx file'));
  assert.equal(corrupt.status, 400);
});

test('preview correctly parses the color-coded effort sheet into tasks and metadata', async () => {
  const buffer = await buildEffortSheet();
  const result = await upload(`/api/projects/${project}/import-excel/preview`, manager.token, buffer);
  assert.equal(result.status, 200);
  assert.equal(result.data.count, 1);
  assert.deepEqual(result.data.meta, { customer: 'Acme Corp', reference: 'Q-123' });
  assert.deepEqual(result.data.tasks, [{
    product: 'Security', subProduct: 'Firewall', taskGroup: 'Implementation',
    taskCode: 'T1', department: 'Security Eng', title: 'Configure firewall rules',
    qty: 2, workingHours: 4, nonWorkingHours: 1,
  }]);

  // Planner can preview too (not just manager).
  assert.equal((await upload(`/api/projects/${project}/import-excel/preview`, planner.token, buffer)).status, 200);
});

test('confirm inserts only non-empty task titles and is manager/planner-only', async () => {
  assert.equal((await h.api(`/api/projects/${project}/import-excel/confirm`, { method: 'POST', token: engineer.token, body: { tasks: [{ title: 'X' }] } })).status, 403);
  assert.equal((await h.api(`/api/projects/${project}/import-excel/confirm`, { method: 'POST', token: manager.token, body: {} })).status, 400);
  assert.equal((await h.api(`/api/projects/${project}/import-excel/confirm`, { method: 'POST', token: manager.token, body: { tasks: [] } })).status, 400);
  assert.equal((await h.api('/api/projects/99999999/import-excel/confirm', { method: 'POST', token: manager.token, body: { tasks: [{ title: 'X' }] } })).status, 404);

  const before = (await h.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?').get(project)).n;
  const result = await h.api(`/api/projects/${project}/import-excel/confirm`, { method: 'POST', token: manager.token, body: {
    tasks: [{ title: 'Configure firewall rules' }, { title: '   ' }, { title: '' }, { title: 'Provision VPN' }],
  } });
  assert.equal(result.status, 200);
  assert.equal(result.data.created, 2); // blank/whitespace-only titles were skipped
  assert.equal(result.data.message, '2 tasks imported successfully');
  const after = (await h.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?').get(project)).n;
  assert.equal(after - before, 2);

  const titles = (await h.db.prepare('SELECT title FROM tasks WHERE project_id = ? ORDER BY id DESC LIMIT 2').all(project)).map(t => t.title);
  assert.deepEqual(titles.sort(), ['Configure firewall rules', 'Provision VPN']);

  const single = await h.api(`/api/projects/${project}/import-excel/confirm`, { method: 'POST', token: manager.token, body: { tasks: [{ title: 'One task' }] } });
  assert.equal(single.data.message, '1 task imported successfully');
});
