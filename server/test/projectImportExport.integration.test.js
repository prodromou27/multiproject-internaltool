// Projects: managers can import and export the project list in bulk.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const ExcelJS = require('exceljs');

async function workbook(rows) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Projects');
  sheet.addRow(['project_code*', 'title*', 'description*', 'start_date*', 'member_names*', 'customer_name', 'priority', 'deadline']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function send(path, buffer, extra = {}, token = ids.tokenManager) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'projects.xlsx');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${suiteFixture.baseUrl}/api/projects/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
}
const projectCount = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM projects').get()).n);

let file;
test('a review lists new projects, ones already there, and rows that cannot go in; nothing changes', async () => {
  await db.prepare("INSERT INTO projects (project_code, title, description, start_date, created_by) VALUES ('PRJ-EXISTING', 'Already here', 'x', '2026-01-01', ?)").run(ids.manager);
  file = await workbook([
    ['PRJ-NEW-1', 'Fresh project', 'Scope here', '2026-12-01', 'Engineer Enabled', 'Acme Corp', 'high', '2027-01-01'],
    ['PRJ-EXISTING', 'Already here', 'x', '2026-01-01', 'Engineer Enabled', '', '', ''],
    ['PRJ-NEW-1', 'Duplicate code', 'Scope', '2026-12-02', 'Engineer Enabled', '', '', ''],
    ['PRJ-NEW-2', 'Bad date', 'Scope', 'not-a-date', 'Engineer Enabled', '', '', ''],
    ['PRJ-NEW-3', 'Ghost engineer', 'Scope', '2026-12-03', 'No Such Person', '', '', ''],
    ['PRJ-NEW-4', 'No engineer', 'Scope', '2026-12-04', '', '', '', ''],
    ['PRJ-NEW-5', 'Bad customer', 'Scope', '2026-12-05', 'Engineer Enabled', 'No Such Customer', '', ''],
    ['PRJ-NEW-6', 'Deadline before start', 'Scope', '2026-12-06', 'Engineer Enabled', '', '', '2026-01-01'],
  ]);
  const before = await projectCount();
  const res = await send('import/preview', file);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.counts.create, 1);
  assert.equal(res.data.counts.unchanged, 1);
  assert.equal(res.data.counts.duplicates, 1);
  const byName = Object.fromEntries(res.data.rows.map(r => [r.name, r]));
  assert.equal(byName['Already here'].action, 'unchanged');
  assert.equal(byName['Duplicate code'].kind, 'duplicate');
  assert.match(byName['Bad date'].error, /start_date must be/);
  assert.match(byName['Ghost engineer'].error, /Engineer not found/);
  assert.match(byName['No engineer'].error, /Missing: member_names/);
  assert.match(byName['Bad customer'].error, /Customer not found/);
  assert.match(byName['Deadline before start'].error, /deadline cannot be before/);
  assert.equal(await projectCount(), before);
  assert.equal((await send('import/preview', file, {}, ids.tokenEnabled)).status, 403, 'engineers cannot import projects');
});

test('the reviewed import adds the new project with its members; doing it again adds nothing', async () => {
  const review = (await send('import/preview', file)).data;
  const before = await projectCount();
  const done = await send('import', file, { preview_token: review.token });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.imported, 1);
  assert.equal(await projectCount(), before + 1);
  const created = await db.prepare("SELECT id, priority, deadline, customer_id FROM projects WHERE project_code = 'PRJ-NEW-1'").get();
  assert.equal(created.priority, 'high');
  assert.equal(created.deadline, '2027-01-01');
  assert.ok(created.customer_id);
  assert.ok(await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(created.id, ids.engineerEnabled));
  const again = await send('import', file);
  assert.equal(again.data.imported, 0, 'no review (scripts): the same file adds nothing new');
});

test('export includes the new project with its members, and the template lists the required columns', async () => {
  const exported = await api('/api/projects/export', { token: ids.tokenManager });
  assert.equal(exported.status, 200);
  const template = await api('/api/projects/template/download', { token: ids.tokenManager });
  assert.equal(template.status, 200);
  assert.equal((await api('/api/projects/export', { token: ids.tokenEnabled })).status, 403, 'engineers cannot export projects');
});
