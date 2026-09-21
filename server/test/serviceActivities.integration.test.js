/**
 * Integration tests for the Service Activity Tracking module's authorization
 * and business rules, run against an in-memory Postgres (pg-mem) rather than
 * pure-function unit tests, since the behavior under test (team gating,
 * customer authorization, IDOR resistance, reference uniqueness) only exists
 * at the route-handler level.
 *
 * This intentionally does NOT boot server/index.js (its TLS/rate-limit/
 * scheduler bootstrap isn't designed to be imported) — instead it mounts the
 * real route modules on a minimal Express app, against the real db.js module
 * with its Postgres Pool swapped for pg-mem's. That's the same technique
 * used to validate the schema DDL during development; see server/db.js's
 * `translate()` for why SQLite-shaped SQL works against a Postgres backend.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(32);
// TEST_DATABASE_URL must point to a fresh, disposable database (CI supplies one).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://fake:fake@localhost/fake';

const { newDb, DataType } = require('pg-mem');
const memDb = newDb();
memDb.public.registerFunction({ name: 'substr', args: [DataType.text, DataType.integer, DataType.integer],
  returns: DataType.text, implementation: (text, start, length) => text.substring(start - 1, start - 1 + length) });
const { Pool: RealPool } = memDb.adapters.createPg();

// pg-mem doesn't implement the round()-overload shim db.js defines for real
// Postgres compatibility, nor Postgres's to_char()/AT TIME ZONE at all — both
// are used throughout db.js purely for computing "now" as a formatted text
// timestamp (the app stores all timestamps as TEXT). Neither affects any
// business logic under test here, so both are rewritten before reaching
// pg-mem's parser rather than worked around per call site.
function pgMemCompatible(sql) {
  if (/CREATE OR REPLACE FUNCTION (round|app_now|app_today)/i.test(sql)) return null; // no-op
  const now = new Date().toISOString();
  let out = sql
    .replace(/\bapp_now\(\)/g, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/\bapp_today\(\)/g, `'${now.slice(0, 10)}'`)
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD HH24:MI:SS'\)/gi, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD'\)/gi, `'${now.slice(0, 10)}'`);
  // pg-mem has a confirmed bug rejecting NULL against CHECK(col IN (...)) constraints
  // (real Postgres correctly treats NULL as passing a CHECK, per the SQL standard —
  // verified with a minimal repro during schema development). Strip these CHECK
  // clauses only for this in-memory test backend; the real schema keeps them.
  if (/^\s*CREATE TABLE/i.test(out)) {
    out = out.replace(/\s+CHECK\([a-z_]+\s+IN\s*\([^)]*\)\)/gi, '');
  }
  return out;
}

class Pool extends RealPool {
  query(text, ...rest) {
    if (typeof text === 'string') {
      const rewritten = pgMemCompatible(text);
      if (rewritten === null) return Promise.resolve({ rows: [] });
      return super.query(rewritten, ...rest);
    }
    return super.query(text, ...rest);
  }
}

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'pg' && !process.env.TEST_DATABASE_URL) {
    const real = originalRequire.apply(this, arguments);
    return { ...real, Pool };
  }
  return originalRequire.apply(this, arguments);
};

require('express-async-errors');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signJwt } = require('../middleware/auth');

let server, baseUrl;

async function api(path, { method = 'GET', token, body, cookie, origin, csrf = true, useCurrentVersion = true } = {}) {
  // Business-rule tests use fresh snapshots; conflict tests supply explicit versions.
  if (useCurrentVersion && method === 'PUT' && /^\/api\/service-activities\/\d+$/.test(path) && body && body.version === undefined) {
    const current = await db.prepare('SELECT version FROM service_activities WHERE id = ?').get(Number(path.split('/').pop()));
    if (current) body = { ...body, version: current.version };
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(csrf ? { 'X-SolutionsHub-Request': '1' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

let ids = {};

test.before(async () => {
  await db.init();

  const app = express();
  app.use(express.json());
  app.use('/api', require('../middleware/session').protectCookieRequests);
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/notes', require('../routes/notes'));
  app.use('/api/search', require('../routes/search'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/api/tasks', require('../routes/tasks'));
  app.use('/api/projects', require('../routes/projects'));
  app.use('/api/attachments', require('../routes/attachments'));
  app.use('/api/operations', require('../routes/operations'));
  app.use('/api/calendar', require('../routes/calendar'));
  app.use('/api/maintenance-visits', require('../routes/maintenance-visits'));
  app.use('/api/time-logs', require('../routes/time-logs'));
  app.use('/api/teams', require('../routes/teams'));
  app.use('/api/customers', require('../routes/customers'));
  app.use('/api/workload', require('../routes/workload'));
  app.use('/api/report-settings', require('../routes/report-settings'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/ticketing', require('../routes/ticketing'));
  app.use('/api/managed-customers', require('../routes/managedCustomers'));
  app.use('/api/service-activities', require('../routes/serviceActivities'));
  app.use('/api/projects/:projectId/custom-fields', require('../routes/customFields'));
  app.use(require('../middleware/errors').errorHandler);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // ── Seed: two teams (one enabled, one disabled), a manager, two engineers,
  // one customer assigned only to the enabled team, and a category. ──
  const hash = bcrypt.hashSync('pw', 4);
  const mkUser = async (name, role) =>
    (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(name, `${name.toLowerCase()}@test.local`, hash, role)).lastInsertRowid;

  ids.manager = await mkUser('Manager One', 'manager');
  ids.engineerEnabled = await mkUser('Engineer Enabled', 'engineer');
  ids.engineerDisabled = await mkUser('Engineer Disabled', 'engineer');
  ids.planner = await mkUser('Planner One', 'planner');
  ids.pm = await mkUser('PM One', 'pm');

  ids.teamEnabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 1)').run('Security Team')).lastInsertRowid;
  ids.teamDisabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 0)').run('Legacy Team')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, ids.engineerEnabled);
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamDisabled, ids.engineerDisabled);

  ids.customer = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Acme Corp')).lastInsertRowid;
  ids.customerUnassigned = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Other Corp')).lastInsertRowid;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);

  const cat = await db.prepare('SELECT id FROM activity_categories LIMIT 1').get();
  ids.category = cat.id;
  ids.technology = (await db.prepare('SELECT id FROM technologies WHERE active=1 ORDER BY id LIMIT 1').get()).id;

  ids.tokenManager = signJwt({ id: ids.manager });
  ids.tokenEnabled = signJwt({ id: ids.engineerEnabled });
  ids.tokenDisabled = signJwt({ id: ids.engineerDisabled });
  ids.tokenPlanner = signJwt({ id: ids.planner });
  ids.tokenPm = signJwt({ id: ids.pm });
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.pool.end();
  Module.prototype.require = originalRequire;
});

test('workload pressure enforces manager access, policy versions and independent obligations', async () => {
  const { defaults } = require('../workloadPolicy');
  const path='/api/workload/pressure';
  for (const role of ['engineer','planner','pm']) {
    const id=(await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Pressure ${role}`,`pressure-${role}@test.local`,bcrypt.hashSync('pw',4),role)).lastInsertRowid;
    const token=signJwt({ id });
    assert.equal((await api(path,{ token })).status,403);
    assert.equal((await api(`${path}/policy`,{ token })).status,403);
    assert.equal((await api(`${path}/policy`,{ method: 'PUT',token,body: { ...defaults(),version: 0 } })).status,403);
  }
  const original=(await api(`${path}/policy`,{ token: ids.tokenManager })).data.policy;
  assert.equal(original.version,0);
  const save=body => api(`${path}/policy`,{ method: 'PUT',token: ids.tokenManager,body });
  assert.equal((await save({ ...defaults(),version: 0 })).data.version,1);
  if (process.env.TEST_DATABASE_URL) assert.equal((await save({ ...defaults(),version: 0 })).status,409);
  assert.equal((await save({ ...defaults(),version: 1 })).data.version,2);
  assert.equal((await save({ ...defaults(),version: 1 })).status,409);
  assert.equal((await save({ ...defaults(),version: 2,pressure: { overdue: '2' } })).status,400);
  for (const query of ['as_of=2026-02-29','as_of=','as_of=2026-09-18&as_of=2026-09-19']) assert.equal((await api(`${path}?${query}`,{ token: ids.tokenManager })).status,400);
  const engineer=(await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Pressure owner','pressure-owner@test.local',bcrypt.hashSync('pw',4),'engineer')).lastInsertRowid;
  const task=(await db.prepare('INSERT INTO tasks (title,status,priority,deadline,assigned_to,created_by) VALUES (?,?,?,?,?,?)').run('Waiting pressure','waiting_customer','high','2026-09-17',engineer,ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO tasks (title,status,assigned_to,created_by) VALUES (?,?,?,?)').run('Terminal pressure','completed',engineer,ids.manager);
  const visit=(await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,status,created_by) VALUES (?,?,?,?,?)').run('Report pressure',ids.customer,'2026-09-17','completed',ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit,engineer);
  for (const [reference,linked] of [['PRESSURE-UNLINKED',null],['PRESSURE-LINKED',task]]) await db.prepare('INSERT INTO service_activities (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,created_by,follow_up_required,follow_up_task_id) VALUES (?,?,?,?,?,?,?,?,1,?)').run(reference,ids.customer,ids.teamEnabled,engineer,'2026-09-18',ids.category,reference,ids.manager,linked);
  const response=await api(`${path}?as_of=2026-09-18`,{ token: ids.tokenManager });
  assert.equal(response.status,200);
  const result=response.data.engineers.find(row => row.id===engineer);
  assert.equal(result.breakdown.task.count,1);
  assert.equal(result.breakdown.visit.count,0);
  assert.equal(result.breakdown.report.count,1);
  assert.equal(result.breakdown.follow_up.count,1);
  assert.equal(result.pressure_points,7.75);
});

test('customer assets validate technical identifiers, enforce versions and remain manager-only', async () => {
  const base=`/api/customers/${ids.customer}/assets`;
  assert.equal((await api(base,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/customers/not-an-id/assets',{ token:ids.tokenManager })).status,400);
  const body={ name:'Primary Gateway',asset_tag:'GW-001',asset_type:'Security gateway',technology_id:ids.technology,vendor:'Check Point',model:'6200',serial_number:'CP123',hostname:'gw01.example.local',ip_address:'192.0.2.10',mac_address:'00:11:22:33:44:55',software_version:'R81.20',location:'Primary DC',environment:'production',criticality:'critical',lifecycle_status:'active',coverage_type:'managed',support_provider:'Partner',support_reference:'SUP-1',support_start_date:'2026-01-01',support_end_date:'2026-12-31',warranty_expiry_date:'2027-12-31',management_url:'https://gw01.example.local',notes:'Cluster member one' };
  for (const change of [{ ip_address:'999.1.1.1' },{ hostname:'bad host' },{ mac_address:'not-a-mac' },{ coverage_type:'leased' },{ support_end_date:'2025-01-01' },{ management_url:'https://user:secret@example.test' },{ technology_id:true }]) assert.equal((await api(base,{ method:'POST',token:ids.tokenManager,body:{ ...body,...change,asset_tag:`BAD-${JSON.stringify(change)}` } })).status,400);
  const created=await api(base,{ method:'POST',token:ids.tokenManager,body });
  assert.equal(created.status,201);
  assert.equal(created.data.hostname,body.hostname);
  assert.equal(created.data.version,1);
  assert.equal(created.data.asset_tag_hash,undefined);
  assert.equal((await api(base,{ method:'POST',token:ids.tokenManager,body:{ ...body,name:'Duplicate',asset_tag:' gw-001 ' } })).status,409);
  const searched=await api(`${base}?search=gw01`,{ token:ids.tokenManager });
  assert.equal(searched.status,200);
  assert.equal(searched.data.total,1);
  for (const query of ['search=x','expiry=31']) assert.equal((await api(`${base}?${query}`,{ token:ids.tokenManager })).status,400);
  const exportResponse=await fetch(`${baseUrl}${base}/export?search=gw01`,{ headers:{ Authorization:`Bearer ${ids.tokenManager}` } });
  assert.equal(exportResponse.status,200);
  const ExcelJS=require('exceljs'),exportBook=new ExcelJS.Workbook();await exportBook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  assert.equal(exportBook.worksheets[0].getRow(2).getCell(1).value,'Primary Gateway');
  const importBook=new ExcelJS.Workbook(),importSheet=importBook.addWorksheet('Assets');
  importSheet.addRow(['name*','asset_type*','asset_tag','technology','hostname','ip_address','coverage_type']);
  importSheet.addRow(['Imported host','Server','IMPORT-1','Firewall','imported.example.local','2001:db8::1','support']);
  const form=new FormData();form.append('file',new Blob([await importBook.xlsx.writeBuffer()],{ type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),'assets.xlsx');
  const importedResponse=await fetch(`${baseUrl}${base}/import`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'X-SolutionsHub-Request':'1' },body:form });
  assert.equal(importedResponse.status,201);
  assert.equal((await importedResponse.json()).imported,1);
  const list=await api(`${base}?coverage=managed&status=active`,{ token:ids.tokenManager });
  assert.equal(list.status,200);
  assert.equal(list.data.rows.some(row => row.id===created.data.id),true);
  assert.equal((await api(`${base}?coverage=invalid`,{ token:ids.tokenManager })).status,400);
  const item=`${base}/${created.data.id}`;
  const updated=await api(item,{ method:'PUT',token:ids.tokenManager,body:{ ...created.data,coverage_type:'support' } });
  assert.equal(updated.status,200);
  assert.equal(updated.data.version,2);
  assert.equal(updated.data.coverage_type,'support');
  assert.equal((await api(item,{ method:'PUT',token:ids.tokenManager,body:{ ...created.data,name:'Stale' } })).status,409);
  let currentVersion=2;
  if (process.env.TEST_DATABASE_URL) {
    const edits=await Promise.all(['Concurrent one','Concurrent two'].map(name => api(item,{ method:'PUT',token:ids.tokenManager,body:{ ...updated.data,name,version:2 } })));
    assert.deepEqual(edits.map(result => result.status).sort(),[200,409]);
    currentVersion=3;
  }
  assert.equal((await api(item,{ method:'DELETE',token:ids.tokenManager,body:{ version:1 } })).status,409);
  assert.equal((await api(item,{ method:'DELETE',token:ids.tokenManager,body:{ version:currentVersion } })).status,200);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM customer_asset_history WHERE customer_id=?').get(ids.customer)).total)>=3,true);
});

test('customer asset files enforce ownership, file signatures, encryption and cleanup', async () => {
  const base=`/api/customers/${ids.customer}/assets`;
  const created=await api(base,{ method:'POST',token:ids.tokenManager,body:{ name:'Documented gateway',asset_tag:'DOC-GW-1',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' } });
  const other=await api(`/api/customers/${ids.customerUnassigned}/assets`,{ method:'POST',token:ids.tokenManager,body:{ name:'Other documented gateway',asset_tag:'DOC-GW-2',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'support' } });
  assert.equal(created.status,201);assert.equal(other.status,201);
  const filesPath=`${base}/${created.data.id}/attachments`;
  const sendFile=async (token,content,type,name='document.pdf') => {
    const form=new FormData();form.append('file',new Blob([content],{ type }),name);
    return fetch(`${baseUrl}${filesPath}`,{ method:'POST',headers:{ Authorization:`Bearer ${token}`,'X-SolutionsHub-Request':'1' },body:form });
  };
  assert.equal((await sendFile(ids.tokenEnabled,'%PDF-1.4\ntest','application/pdf')).status,403);
  assert.equal((await sendFile(ids.tokenManager,'not a PDF','application/pdf')).status,400);
  process.env.ATTACHMENT_KEY='ab'.repeat(32);
  try {
    const uploaded=await sendFile(ids.tokenManager,'%PDF-1.4\nasset documentation','application/pdf');
    assert.equal(uploaded.status,201);
    const result=await uploaded.json(),stored=await db.prepare('SELECT * FROM attachments WHERE id=?').get(result.id);
    assert.equal(stored.customer_asset_id,created.data.id);assert.ok(stored.enc_iv);assert.ok(stored.enc_tag);
    const list=await api(filesPath,{ token:ids.tokenManager });
    assert.equal(list.status,200);assert.equal(list.data.length,1);assert.equal(list.data[0].stored_name,undefined);assert.equal(list.data[0].enc_iv,undefined);
    const inventory=await api(`${base}?search=Documented%20gateway`,{ token:ids.tokenManager });
    assert.equal(Number(inventory.data.rows[0].attachment_count),1);
    assert.equal((await api(`/api/customers/${ids.customerUnassigned}/assets/${created.data.id}/attachments`,{ token:ids.tokenManager })).status,404);
    assert.equal((await api(`${filesPath}/${result.id}/download`,{ token:ids.tokenEnabled })).status,403);
    const download=await fetch(`${baseUrl}${filesPath}/${result.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenManager}` } });
    assert.equal(download.status,200);assert.equal(await download.text(),'%PDF-1.4\nasset documentation');assert.equal(download.headers.get('cache-control'),'private, no-store');assert.equal(download.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await api(`${filesPath}/${result.id}`,{ method:'DELETE',token:ids.tokenManager,body:{} })).status,200);
    assert.equal((await api(filesPath,{ token:ids.tokenManager })).data.length,0);
  } finally { delete process.env.ATTACHMENT_KEY; }
  const cleanupUpload=await sendFile(ids.tokenManager,'%PDF-1.4\ncleanup check','application/pdf','cleanup.pdf');
  assert.equal(cleanupUpload.status,201);
  const cleanupResult=await cleanupUpload.json(),cleanupRow=await db.prepare('SELECT stored_name FROM attachments WHERE id=?').get(cleanupResult.id);
  const cleanupPath=require('path').join(require('../uploadUtils').uploadDir,cleanupRow.stored_name);
  assert.equal((await api(`${base}/${created.data.id}`,{ method:'DELETE',token:ids.tokenManager,body:{ version:created.data.version } })).status,200);
  await assert.rejects(require('fs').promises.access(cleanupPath));
  assert.equal((await api(`/api/customers/${ids.customerUnassigned}/assets/${other.data.id}`,{ method:'DELETE',token:ids.tokenManager,body:{ version:other.data.version } })).status,200);
});

test('project attachments follow project visibility and preserve PM read-only access', async () => {
  const project=(await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Attachment permissions',ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(project,ids.planner);
  const path=`/api/attachments/${project}`;
  assert.equal((await api('/api/attachments/not-an-id',{ token:ids.tokenManager })).status,400);
  assert.equal((await api('/api/attachments/999999999',{ token:ids.tokenManager })).status,404);
  assert.equal((await api(path,{ token:ids.tokenDisabled })).status,403);
  assert.equal((await api(path,{ token:ids.tokenPlanner })).status,200);
  const sendFile=async token => {
    const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nproject file'],{ type:'application/pdf' }),'project.pdf');
    return fetch(`${baseUrl}${path}`,{ method:'POST',headers:{ Authorization:`Bearer ${token}`,'X-SolutionsHub-Request':'1' },body:form });
  };
  assert.equal((await sendFile(ids.tokenPm)).status,403);
  const uploaded=await sendFile(ids.tokenManager);assert.equal(uploaded.status,201);const attachment=await uploaded.json();
  const list=await api(path,{ token:ids.tokenPlanner });
  assert.equal(list.status,200);assert.equal(list.data.length,1);assert.equal(list.data[0].stored_name,undefined);assert.equal(list.data[0].enc_iv,undefined);
  assert.equal((await api(`${path}/download/${attachment.id}`,{ token:ids.tokenDisabled })).status,403);
  const pmDownload=await fetch(`${baseUrl}${path}/download/${attachment.id}`,{ headers:{ Authorization:`Bearer ${ids.tokenPm}` } });
  assert.equal(pmDownload.status,200);assert.equal(await pmDownload.text(),'%PDF-1.4\nproject file');assert.equal(pmDownload.headers.get('cache-control'),'private, no-store');assert.equal(pmDownload.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await api(`${path}/${attachment.id}`,{ method:'DELETE',token:ids.tokenPm,body:{} })).status,403);
  assert.equal((await api(`${path}/${attachment.id}`,{ method:'DELETE',token:ids.tokenPlanner,body:{} })).status,403);
  assert.equal((await api(`${path}/${attachment.id}`,{ method:'DELETE',token:ids.tokenManager,body:{} })).status,200);
});

test('engineer from a disabled team cannot access the service-activities module', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenDisabled });
  assert.equal(status, 403);
  assert.match(data.error, /not enabled/i);
});

test('engineer from an enabled team can list activities (empty at first)', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenEnabled });
  assert.equal(status, 200);
  assert.deepEqual(data.rows, []);
});

test('meta endpoint only returns customers assigned to the engineer\'s enabled team', async () => {
  const { status, data } = await api('/api/service-activities/meta', { token: ids.tokenEnabled });
  assert.equal(status, 200);
  const names = data.customers.map(c => c.name);
  assert.ok(names.includes('Acme Corp'));
  assert.ok(!names.includes('Other Corp'), 'unassigned customer must not be selectable');
});

test('activities link only authorized same-customer assets and preserve asset history', async () => {
  const assetBody={ name:'Activity gateway',asset_tag:'ACT-GW-1',asset_type:'Security gateway',hostname:'activity-gw.example.local',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' };
  const createdAsset=await api(`/api/customers/${ids.customer}/assets`,{ method:'POST',token:ids.tokenManager,body:assetBody });
  const otherAsset=await api(`/api/customers/${ids.customerUnassigned}/assets`,{ method:'POST',token:ids.tokenManager,body:{ ...assetBody,name:'Other gateway',asset_tag:'OTHER-GW-1',hostname:'other-gw.example.local' } });
  assert.equal(createdAsset.status,201);assert.equal(otherAsset.status,201);
  const choices=await api(`/api/service-activities/assets?customer_id=${ids.customer}`,{ token:ids.tokenEnabled });
  assert.equal(choices.status,200);assert.equal(choices.data.find(row => row.id===createdAsset.data.id).hostname,'activity-gw.example.local');
  assert.equal((await api(`/api/service-activities/assets?customer_id=${ids.customerUnassigned}`,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await createActivity({ asset_ids:[otherAsset.data.id] })).status,400);
  const activity=await createActivity({ title:'Gateway maintenance',asset_ids:[createdAsset.data.id] });
  assert.equal(activity.status,200);
  const detail=await api(`/api/service-activities/${activity.data.id}`,{ token:ids.tokenEnabled });
  assert.deepEqual(detail.data.assets.map(row => row.id),[createdAsset.data.id]);
  const inventory=await api(`/api/customers/${ids.customer}/assets?search=Activity%20gateway`,{ token:ids.tokenManager });
  assert.equal(Number(inventory.data.rows[0].activity_count),1);
  assert.equal((await api(`/api/customers/${ids.customer}/assets/${createdAsset.data.id}`,{ method:'DELETE',token:ids.tokenManager,body:{ version:1 } })).status,409);
  assert.equal((await api(`/api/service-activities/${activity.data.id}`,{ method:'PUT',token:ids.tokenEnabled,body:{ asset_ids:[],version:detail.data.version } })).status,200);
  assert.equal((await api(`/api/customers/${ids.customer}/assets/${createdAsset.data.id}`,{ method:'DELETE',token:ids.tokenManager,body:{ version:1 } })).status,200);
  assert.equal((await api(`/api/customers/${ids.customerUnassigned}/assets/${otherAsset.data.id}`,{ method:'DELETE',token:ids.tokenManager,body:{ version:1 } })).status,200);
});

test('engineer can create an activity for an authorized customer, and server derives engineer_id/team_id itself', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'VPN troubleshooting',
      status: 'planned',
      // IDOR attempt: try to impersonate the manager and assign to a different team.
      engineer_id: ids.manager,
      team_id: ids.teamDisabled,
    },
  });
  assert.equal(status, 200);
  assert.match(data.activity_reference, /^ACT-\d{4}-\d{6}$/);

  const stored = await db.prepare('SELECT engineer_id, team_id FROM service_activities WHERE id = ?').get(data.id);
  assert.equal(stored.engineer_id, ids.engineerEnabled, 'engineer_id must be the authenticated user, not the spoofed value');
  assert.equal(stored.team_id, ids.teamEnabled, 'team_id must be derived from the engineer\'s real team, not the spoofed value');
});

test('engineer cannot log an activity against a customer not assigned to their team (IDOR)', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customerUnassigned,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Should be rejected',
      status: 'planned',
    },
  });
  assert.equal(status, 403);
  assert.match(data.error, /not authorized/i);
});

test('engineer cannot edit another engineer\'s activity', async () => {
  const created = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Owned by engineerEnabled',
      status: 'planned',
    },
  });
  assert.equal(created.status, 200);

  // A second engineer on the same enabled team should still be forbidden from
  // editing an activity they don't own.
  const otherEngineerId = await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Engineer Two', 'engineertwo@test.local', bcrypt.hashSync('pw', 4), 'engineer');
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, otherEngineerId.lastInsertRowid);
  const otherToken = signJwt({ id: otherEngineerId.lastInsertRowid });

  const { status, data } = await api(`/api/service-activities/${created.data.id}`, {
    method: 'PUT',
    token: otherToken,
    body: { title: 'Hijacked title' },
  });
  assert.equal(status, 403);
  assert.equal(data.error, 'Forbidden');
});

test('manager can view activities regardless of team membership', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenManager });
  assert.equal(status, 200);
  assert.ok(data.total >= 2);
});

test('a historical activity can be created directly with a terminal Completed status', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Historical completed work',
      status: 'completed',
      duration_minutes: 60,
    },
  });
  assert.equal(status, 200);
  const stored = await db.prepare('SELECT status, completed_at FROM service_activities WHERE id = ?').get(data.id);
  assert.equal(stored.status, 'completed');
  assert.ok(stored.completed_at, 'completed_at should be set for a directly-created completed activity');
});

test('activity references are unique and correctly formatted across multiple creates', async () => {
  const refs = new Set();
  for (let i = 0; i < 3; i++) {
    const { status, data } = await api('/api/service-activities', {
      method: 'POST',
      token: ids.tokenEnabled,
      body: {
        customer_id: ids.customer,
        activity_date: new Date().toISOString().slice(0, 10),
        category_id: ids.category,
        title: `Bulk activity ${i}`,
        status: 'planned',
      },
    });
    assert.equal(status, 200);
    assert.ok(!refs.has(data.activity_reference), 'reference must be unique');
    refs.add(data.activity_reference);
  }
});

test('direct URL access to a disabled team\'s data is rejected server-side regardless of client-side gating', async () => {
  // Simulates an engineer on a disabled team hitting the API URL directly
  // (bypassing the client nav/route guard entirely).
  const { status } = await api('/api/service-activities/meta', { token: ids.tokenDisabled });
  assert.equal(status, 403);
});

async function createActivity(overrides = {}) {
  return api('/api/service-activities', {
    method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: '2026-01-15',
      category_id: ids.category, title: 'Validation regression', status: 'planned', ...overrides },
  });
}

test('invalid dates, durations, text and technology IDs return 400 instead of reaching storage', async () => {
  for (const body of [
    { activity_date: '2026-02-30' }, { duration_minutes: 'abc' },
    { duration_minutes: 1.5 }, { duration_minutes: 1441 }, { title: 123 },
    { technology_ids: [999999] }, { technology_ids: [1, 1] },
    { asset_ids: [999999] }, { asset_ids: [1, 1] }, { asset_ids: ['1'] },
  ]) {
    const result = await createActivity(body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('partial edits preserve required fields and reject attempts to clear them', async () => {
  await db.prepare('UPDATE customers SET require_duration=1, require_ticket_reference=1, require_notes=1 WHERE id=?').run(ids.customer);
  try {
    const created = await createActivity({ duration_minutes: 60, ticket_reference: 'CASE-1', description: 'Work notes' });
    assert.equal(created.status, 200);
    const update = body => api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body,
    });
    assert.equal((await update({ title: 'Updated title' })).status, 200);
    for (const body of [{ duration_minutes: null }, { ticket_reference: '' }, { description: '' }, { category_id: null }, { activity_date: null }]) {
      assert.equal((await update(body)).status, 400, JSON.stringify(body));
    }
    const stored = await db.prepare('SELECT duration_minutes, ticket_reference, description FROM service_activities WHERE id=?').get(created.data.id);
    assert.equal(stored.duration_minutes, 60);
    assert.equal(stored.ticket_reference, 'CASE-1');
    assert.equal(stored.description, 'Work notes');
  } finally {
    await db.prepare('UPDATE customers SET require_duration=0, require_ticket_reference=0, require_notes=0 WHERE id=?').run(ids.customer);
  }
});

test('changing customers revalidates retained related project links', async () => {
  const project = await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Customer-specific project', ids.customer, ids.manager);
  const created = await createActivity({ related_project_id: project.lastInsertRowid });
  assert.equal(created.status, 200);
  const result = await api(`/api/service-activities/${created.data.id}`, {
    method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned },
  });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /project.*customer/i);
});

test('revoked customer access prevents editing an existing owned activity', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  await db.prepare('DELETE FROM customer_teams WHERE customer_id=? AND team_id=?').run(ids.customer, ids.teamEnabled);
  try {
    const result = await api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body: { title: 'After access revoked' },
    });
    assert.equal(result.status, 403);
    for (const action of ['complete', 'duplicate', 'follow-up-task', 'attachments']) {
      const denied = await api(`/api/service-activities/${created.data.id}/${action}`, { method: 'POST', token: ids.tokenEnabled, body: {} });
      assert.equal(denied.status, 403, action);
    }
  } finally {
    await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);
  }
});

test('concurrent activity creation allocates unique references without reusing deleted numbers', async () => {
  const created = await Promise.all(Array.from({ length: 10 }, (_, i) => createActivity({ title: `Concurrent work ${i}` })));
  created.forEach(result => assert.equal(result.status, 200, result.data.error));
  const references = created.map(result => result.data.activity_reference);
  assert.equal(new Set(references).size, 10);
  const latest = created.reduce((a, b) => a.data.activity_reference > b.data.activity_reference ? a : b);
  await db.prepare('DELETE FROM service_activities WHERE id=?').run(latest.data.id);
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.ok(next.data.activity_reference > latest.data.activity_reference);
});

test('reference counters initialize from existing activity references on upgrade', async () => {
  const previous = await createActivity();
  assert.equal(previous.status, 200);
  await db.prepare('DELETE FROM service_activity_sequences WHERE year=?').run(new Date().getFullYear());
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.equal(Number(next.data.activity_reference.slice(-6)), Number(previous.data.activity_reference.slice(-6)) + 1);
});

test('follow-up creation is idempotent and ad-hoc follow-ups do not prevent later activity edits', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  const path = `/api/service-activities/${created.data.id}/follow-up-task`;
  const first = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  const again = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(first.data.created, true);
  assert.equal(again.data.created, false);
  assert.equal(first.data.id, again.data.id);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { title: 'Edited after follow-up creation' } });
  assert.equal(updated.status, 200, updated.data.error);
  const activity = await db.prepare('SELECT related_task_id, follow_up_task_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(activity.related_task_id, null);
  assert.equal(activity.follow_up_task_id, first.data.id);
});

test('PostgreSQL locks prevent concurrent duplicate follow-up tasks', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity();
  const results = await Promise.all(Array.from({ length: 5 }, () => api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token: ids.tokenEnabled, body: {} })));
  results.forEach(result => assert.equal(result.status, 200));
  assert.equal(new Set(results.map(result => result.data.id)).size, 1);
  assert.equal(results.filter(result => result.data.created).length, 1);
});

test('customer changes choose an eligible team for the new customer', async () => {
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customerUnassigned, ids.teamDisabled);
  const created = await createActivity();
  assert.equal(created.status, 200);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned } });
  assert.equal(updated.status, 200);
  const stored = await db.prepare('SELECT customer_id, team_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(stored.customer_id, ids.customerUnassigned);
  assert.equal(stored.team_id, ids.teamDisabled);
});

test('export reaches the workbook route and remains scoped to the owning engineer', async () => {
  const manager = await createActivity({ title: 'Engineer export scope marker' });
  assert.equal(manager.status, 200);
  const response = await fetch(`${baseUrl}/api/service-activities/export`, { headers: { Authorization: `Bearer ${ids.tokenEnabled}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.ok(rows.length);
  assert.ok(rows.every(row => row[10] === 'Engineer Enabled'));
});

test('task custom fields enforce task ownership and project relationships', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Custom fields project', ids.manager)).lastInsertRowid;
  const otherProject = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Other project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const mkTask = async assignedTo => (await db.prepare('INSERT INTO tasks (project_id, title, assigned_to, created_by) VALUES (?, ?, ?, ?)')
    .run(project, 'Scoped task', assignedTo, ids.manager)).lastInsertRowid;
  const ownTask = await mkTask(ids.engineerEnabled);
  const otherTask = await mkTask(ids.manager);
  const field = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(project, 'Number field', 'number')).lastInsertRowid;
  const otherField = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(otherProject, 'Private field', 'text')).lastInsertRowid;
  const endpoint = task => `/api/projects/${project}/custom-fields/values/${task}`;
  assert.equal((await api(endpoint(otherTask), { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(endpoint(otherTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 403);
  assert.equal((await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 200);
  assert.equal((await api(endpoint(ownTask), { token: ids.tokenEnabled })).data[field], '42');
  const invalid = [{ [otherField]: 'Cross-project write' }, { [field]: 'NaN' }, null, [], { [field]: {} }];
  for (const values of invalid) {
    const result = await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values } });
    assert.equal(result.status, 400, JSON.stringify(values));
  }
  const stored = await db.prepare('SELECT field_id, value FROM task_custom_values WHERE task_id=?').all(ownTask);
  assert.deepEqual(stored, [{ field_id: field, value: '42' }]);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Custom ${role}`, `${role}@custom.test`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api(endpoint(ownTask), { token: signJwt({ id: user }) })).status, 403);
  }
});

test('custom field definitions and typed values reject invalid input', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Typed fields project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (project_id, title, created_by) VALUES (?, ?, ?)').run(project, 'Typed task', ids.manager)).lastInsertRowid;
  const base = `/api/projects/${project}/custom-fields`;
  for (const body of [{ name: 123 }, { name: 'Bad type', field_type: 'script' }, { name: 'Bad options', options: {} }]) {
    assert.equal((await api(base, { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const select = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Environment', field_type: 'select', options: ['Production', 'Test'], required: true } });
  assert.equal(select.status, 200);
  const date = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Renewal', field_type: 'date' } });
  assert.equal(date.status, 200);
  assert.equal((await api(`${base}/${date.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { field_type: 'script' } })).status, 400);
  for (const values of [{ [select.data.id]: 'Unknown' }, { [select.data.id]: '' }, { [date.data.id]: '2026-02-30' }]) {
    assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values } })).status, 400);
  }
  assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values: { [select.data.id]: 'Production', [date.data.id]: '2026-02-28' } } })).status, 200);
});

test('browser cookies enforce CSRF, required password changes, renewal and logout revocation', async () => {
  const email = 'cookie-user@test.local';
  const initialPassword = 'initial-password-123';
  const userId = (await db.prepare('INSERT INTO users (name, email, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)')
    .run('Cookie user', email, bcrypt.hashSync(initialPassword, 4), 'manager')).lastInsertRowid;
  const loggedIn = await api('/api/auth/login', { method: 'POST', body: { email, password: initialPassword } });
  assert.equal(loggedIn.status, 200);
  const setCookie = loggedIn.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api/);
  assert.equal(loggedIn.headers.get('cache-control'), 'no-store');
  const cookie = setCookie.split(';')[0];
  const me = await api('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.id, userId);
  assert.equal(me.data.must_change_password, 1);
  const restricted = await api('/api/service-activities', { cookie });
  assert.equal(restricted.status, 403);
  assert.equal(restricted.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const exportDenied = await fetch(`${baseUrl}/api/service-activities/export`, { headers: { Cookie: cookie } });
  assert.equal(exportDenied.status, 403);
  const body = { new_password: 'replacement-password-123' };
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, csrf: false, body })).status, 403);
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, origin: 'https://attacker.example', body })).status, 403);
  const changed = await api('/api/auth/change-password-first', { method: 'POST', cookie, body });
  assert.equal(changed.status, 200);
  const renewedCookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie })).status, 401);
  assert.equal((await api('/api/service-activities', { cookie: renewedCookie })).status, 200);
  const profile = await api('/api/auth/profile', { method: 'PUT', cookie: renewedCookie, body: { name: 'Cookie User', email: 'COOKIE-USER@TEST.LOCAL' } });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.email, email);
  const profileCookie = profile.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie: renewedCookie })).status, 401);
  const loggedOut = await api('/api/auth/logout', { method: 'POST', cookie: profileCookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api('/api/auth/me', { cookie: profileCookie })).status, 401);
  assert.equal((await api('/api/auth/me', { token: profile.data.token })).status, 401);
});

test('2FA partial tokens do not grant cookie-based access', async () => {
  const partial = signJwt({ id: ids.manager, partial: true }, { expiresIn: '5m' });
  const result = await api('/api/auth/me', { cookie: `solutionshub_session=${partial}` });
  assert.equal(result.status, 401);
  assert.match(result.data.error, /scope/);
});

test('password endpoints reject malformed and bcrypt-truncated passwords', async () => {
  for (const new_password of [null, {}, [], 'short', 'x'.repeat(73), 'é'.repeat(37)]) {
    for (const path of ['/change-password', '/change-password-first', '/reset-password']) {
      const result = await api(`/api/auth${path}`, { method: 'POST', token: ids.tokenManager,
        body: { new_password, current_password: 'pw', token: 'reset-token' } });
      assert.equal(result.status, 400, `${path}: ${JSON.stringify(new_password)}`);
    }
  }
  assert.equal((await api('/api/auth/forgot-password', { method: 'POST', body: { email: {} } })).status, 400);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body: { token: {}, new_password: 'valid-password-123' } })).status, 400);
});

test('reset tokens are single-use and revoke previous sessions', async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Reset user', 'reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, hash, new Date(Date.now() + 3600000).toISOString());
  const session = signJwt({ id: user, token_version: 0 });
  const body = { token, new_password: 'new-reset-password-123' };
  const first = await api('/api/auth/reset-password', { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body })).status, 400);
  assert.equal((await api('/api/auth/me', { token: session })).status, 401);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(body.new_password, stored.password), true);
  assert.equal(stored.token_version, 1);
});

test('concurrent reset requests consume a token only once on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Concurrent reset user', 'concurrent-reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600000).toISOString());
  const results = await Promise.all([0, 1].map(i => api('/api/auth/reset-password', {
    method: 'POST', body: { token, new_password: `concurrent-password-${i}` },
  })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const winner = results.findIndex(r => r.status === 200);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(`concurrent-password-${winner}`, stored.password), true);
  assert.equal(stored.token_version, 1);
});

test('task edits can clear assignments and validate fields and relationships', async () => {
  const created = await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: '  Assignment test  ', assigned_to: ids.engineerEnabled, deadline: '2026-10-15' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/tasks/${created.data.id}`;
  assert.equal((await db.prepare('SELECT title FROM tasks WHERE id=?').get(created.data.id)).title, 'Assignment test');
  for (const body of [{ title: {} }, { title: '' }, { title: 'x'.repeat(501) }, { description: [] },
    { deadline: '2026-02-30' }, { priority: '' }, { assigned_to: ids.manager }, { assigned_to: 99999999 }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { assigned_to: null, deadline: null } })).status, 200);
  const task = await db.prepare('SELECT assigned_to, deadline FROM tasks WHERE id=?').get(created.data.id);
  assert.equal(task.assigned_to, null);
  assert.equal(task.deadline, null);
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Missing project', project_id: 99999999 } })).status, 400);
});

test('bulk task edits respect role boundaries and clear waiting notes', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Bulk project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title, project_id, assigned_to, created_by, status, pending_from_customer) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Bulk task', project, ids.engineerEnabled, ids.manager, 'waiting_customer', 'Old waiting note')).lastInsertRowid;
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Bulk ${role}`, `bulk-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: signJwt({ id: user }),
      body: { ids: [task], action: 'status', status: 'completed' } })).status, 403);
  }
  const body = { ids: [task], action: 'status', status: 'in_progress' };
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenDisabled, body })).data.affected, 0);
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body })).data.affected, 1);
  const stored = await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.pending_from_customer, null);
});

test('bulk waiting updates validate reasons, count unique owned tasks and preserve legacy notes', async () => {
  const taskIds = [];
  for (const owner of [ids.engineerEnabled, ids.engineerEnabled, ids.engineerDisabled]) {
    taskIds.push((await db.prepare('INSERT INTO tasks (title, assigned_to, created_by, pending_from_customer) VALUES (?, ?, ?, ?)')
      .run('Bulk waiting validation', owner, ids.manager, 'Existing note')).lastInsertRowid);
  }
  const body = { ids: [...taskIds, taskIds[0]], action: 'status', status: 'waiting_vendor', pending_from_customer: '  Awaiting credentials  ' };
  for (const reason of [null, 123, '', '   ', 'x'.repeat(10001)]) {
    assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...body, pending_from_customer: reason } })).status, 400);
  }
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...body, ids: [Number.MAX_SAFE_INTEGER + 1] } })).status, 400);
  const response = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(response.status, 200);
  assert.equal(response.data.affected, 2);
  for (const task of taskIds.slice(0, 2)) {
    assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'waiting_vendor', pending_from_customer: 'Awaiting credentials' });
  }
  assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(taskIds[2]),
    { status: 'open', pending_from_customer: 'Existing note' });
  const legacy = { ids: taskIds.slice(0, 2), action: 'status', status: 'waiting_customer' };
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: legacy })).data.affected, 2);
  assert.equal((await db.prepare('SELECT pending_from_customer FROM tasks WHERE id=?').get(taskIds[0])).pending_from_customer, 'Awaiting credentials');
  await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body: { ...legacy, status: 'in_progress' } });
  assert.equal((await db.prepare('SELECT pending_from_customer FROM tasks WHERE id=?').get(taskIds[0])).pending_from_customer, null);
});

test('bulk edits recheck engineer ownership when the update executes', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Reassigned during bulk save', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const originalPrepare = db.prepare;
  let signalReached, release;
  const reached = new Promise(resolve => { signalReached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let request;
  try {
    db.prepare = function (sql) {
      const statement = originalPrepare.call(db, sql);
      if (/^UPDATE tasks SET status=\?/.test(sql)) return { ...statement, async run(...params) {
        signalReached();
        await gate;
        return statement.run(...params);
      } };
      return statement;
    };
    request = api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled,
      body: { ids: [task], action: 'status', status: 'waiting_vendor', pending_from_customer: 'Private reason' } });
    await reached;
    await originalPrepare.call(db, 'UPDATE tasks SET assigned_to=? WHERE id=?').run(ids.engineerDisabled, task);
    release();
    const response = await request;
    assert.equal(response.status, 200);
    assert.equal(response.data.affected, 0);
    assert.deepEqual(await originalPrepare.call(db, 'SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'open', pending_from_customer: null });
  } finally {
    release();
    if (request) await request;
    db.prepare = originalPrepare;
  }
});

test('bulk task updates roll back every row if PostgreSQL rejects a row', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const taskIds = [];
  for (let i = 0; i < 2; i++) taskIds.push((await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Atomic bulk failure', ids.engineerEnabled, ids.manager)).lastInsertRowid);
  try {
    await db.exec(`CREATE FUNCTION test_reject_bulk_task() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = ${taskIds[1]} THEN RAISE EXCEPTION 'Simulated row failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject_bulk_task BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION test_reject_bulk_task();`);
    const response = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled,
      body: { ids: taskIds, action: 'status', status: 'waiting_vendor', pending_from_customer: 'Must save together' } });
    assert.equal(response.status, 500);
    for (const task of taskIds) assert.deepEqual(await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task),
      { status: 'open', pending_from_customer: null });
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS test_reject_bulk_task ON tasks; DROP FUNCTION IF EXISTS test_reject_bulk_task();');
  }
});

test('time logs enforce task visibility, ownership and private summaries', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Time log task', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const body = { task_id: task, hours: 1.5, description: 'Work performed' };
  assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenDisabled, body })).status, 403);
  const created = await api('/api/time-logs', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/time-logs?task_id=${task}`, { token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`/api/time-logs/${created.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 403);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Time ${role}`, `time-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api(`/api/time-logs?task_id=${task}`, { token })).status, 403);
    assert.equal((await api('/api/time-logs', { method: 'POST', token, body })).status, 403);
    const summary = await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token });
    assert.equal(summary.status, 200);
    assert.equal(Number(summary.data.total), 0);
  }
  assert.equal(Number((await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token: ids.tokenManager })).data.total), 1.5);
});

test('time log input validation rejects malformed targets, hours and dates', async () => {
  for (const body of [{ task_id: -1, hours: 1 }, { task_id: {}, hours: 1 }, { task_id: 1, hours: true },
    { task_id: 1, hours: [1] }, { task_id: 1, hours: 'Infinity' }, { task_id: 1, hours: 25 },
    { task_id: 1, hours: 1, description: {} }, { task_id: 1, visit_id: 1, hours: 1 }]) {
    assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  for (const path of ['/api/time-logs?task_id=abc', '/api/time-logs/mine?from=2026-02-30&to=2026-03-01',
    '/api/time-logs/summary?month=2026-13', '/api/time-logs/summary?user_id=abc']) {
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400, path);
  }
});

test('customer contracts validate merged dates and allow clearing optional fields', async () => {
  const created = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: {
    name: 'Contract edit customer', customer_code: 'EDIT', contract_type: 'MSP',
    contract_start_date: '2026-01-01', contract_end_date: '2026-12-31', included_hours: 20,
  } });
  assert.equal(created.status, 200);
  const endpoint = `/api/customers/${created.data.id}`;
  for (const body of [{ name: {} }, { included_hours: -1 }, { included_hours: 'Infinity' },
    { included_hours: [] }, { contract_start_date: '2026-02-30' }, { contract_end_date: '2025-12-31' }, { notes: {} }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { notes: 'Updated notes' } })).status, 200);
  let stored = await db.prepare('SELECT contract_start_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.equal(stored.contract_start_date, '2026-01-01');
  assert.equal(Number(stored.included_hours), 20);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { customer_code: '', contract_type: null, contract_start_date: '', contract_end_date: null, included_hours: '' } })).status, 200);
  stored = await db.prepare('SELECT customer_code, contract_type, contract_start_date, contract_end_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.ok(Object.values(stored).every(value => value === null));
  assert.equal((await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: [] } })).status, 400);
});

test('projects validate memberships, calendar dates, status updates and pin access', async () => {
  for (const body of [{ title: 'Invalid members', member_ids: {} }, { title: 'Invalid date', deadline: '2026-02-30' },
    { title: 'Wrong role', member_ids: [ids.manager] }]) {
    assert.equal((await api('/api/projects', { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const created = await api('/api/projects', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Project review', deadline: '2026-12-01', member_ids: [ids.engineerEnabled] } });
  assert.equal(created.status, 200);
  const endpoint = `/api/projects/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { deadline: null } })).status, 200);
  assert.equal((await db.prepare('SELECT deadline FROM projects WHERE id=?').get(created.data.id)).deadline, null);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  for (const message of [{}, '   ']) {
    assert.equal((await api(`${endpoint}/status-update`, { method: 'POST', token: ids.tokenManager, body: { message } })).status, 400);
  }
  assert.equal((await api('/api/projects/99999999/status-update', { method: 'POST', token: ids.tokenManager, body: { message: 'Missing project' } })).status, 404);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
  const updates = await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(created.data.id);
  assert.equal(updates.length, 2);
});

test('concurrent project closure requests and approvals write one update each on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Concurrent closure', ids.manager)).lastInsertRowid;
  for (const action of ['request-closure', 'approve-closure']) {
    const results = await Promise.all([0, 1, 2].map(() => api(`/api/projects/${project}/${action}`, { method: 'POST', token: ids.tokenManager })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 409].includes(r.status)));
  }
  assert.equal((await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(project)).length, 2);
});

test('maintenance visits validate dates, assignments and engineer notes', async () => {
  const asset=(await api(`/api/customers/${ids.customer}/assets`,{ method:'POST',token:ids.tokenManager,body:{ name:'Visit gateway',asset_tag:'VISIT-GW-1',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' } })).data;
  const other=(await api(`/api/customers/${ids.customerUnassigned}/assets`,{ method:'POST',token:ids.tokenManager,body:{ name:'Other visit gateway',asset_tag:'VISIT-GW-2',asset_type:'Security gateway',environment:'production',criticality:'high',lifecycle_status:'active',coverage_type:'managed' } })).data;
  const body = { title: 'Reviewed visit', customer_id: ids.customer, scheduled_date: '2026-11-01', engineer_ids: [ids.engineerEnabled],asset_ids:[asset.id] };
  for (const invalid of [{ ...body, scheduled_date: '2026-02-30' }, { ...body, engineer_ids: [ids.manager] }, { ...body, notes: {} }]) {
    assert.equal((await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  assert.equal((await api('/api/maintenance-visits',{ method:'POST',token:ids.tokenManager,body:{ ...body,title:'Wrong asset',asset_ids:[other.id] } })).status,400);
  assert.equal((await api(`/api/maintenance-visits/assets/choices?customer_id=${ids.customer}`,{ token:ids.tokenEnabled })).status,403);
  const choices=await api(`/api/maintenance-visits/assets/choices?customer_id=${ids.customer}`,{ token:ids.tokenManager });
  assert.equal(choices.data.some(row => row.id===asset.id),true);
  const endpoint = `/api/maintenance-visits/${created.data.id}`;
  assert.deepEqual((await api(endpoint,{ token:ids.tokenManager })).data.asset_ids,[asset.id]);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { notes: 'Private' } })).status, 403);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: 'Engineer notes' } })).status, 200);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { title: 'Rescheduled visit', engineer_ids: [ids.engineerDisabled] } })).status, 200);
  const assigned = await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id=?').all(created.data.id);
  assert.deepEqual(assigned, [{ user_id: ids.engineerDisabled }]);
});

test('maintenance report transitions preserve original attribution and clear downstream flags', async () => {
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(ids.customer, 'Report transitions', '2026-11-01', 'in_progress', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  const endpoint = `/api/maintenance-visits/${visit}`;
  const planner = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Report planner', 'report-planner@test.local', bcrypt.hashSync('pw', 4), 'planner')).lastInsertRowid;
  const plannerToken = signJwt({ id: planner });
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT report_sent_by FROM maintenance_visits WHERE id=?').get(visit)).report_sent_by, ids.engineerEnabled);
  for (const token of [plannerToken, ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api(`${endpoint}/report-unsent`, { method: 'POST', token })).status, 403);
  }
  assert.equal((await db.prepare('SELECT report_sent FROM maintenance_visits WHERE id=?').get(visit)).report_sent, 1);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: plannerToken })).status, 200);
  assert.equal((await api(`${endpoint}/report-customer-unsent`, { method: 'POST', token: plannerToken })).status, 200);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`${endpoint}/report-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  let stored = await db.prepare('SELECT status, report_sent, report_sent_to_customer, report_sent_to_customer_by FROM maintenance_visits WHERE id=?').get(visit);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.report_sent, 0);
  assert.equal(stored.report_sent_to_customer, 0);
  assert.equal(stored.report_sent_to_customer_by, null);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 400);
  await db.prepare("UPDATE maintenance_visits SET status='completed' WHERE id=?").run(visit);
  assert.equal((await api(`${endpoint}/report-customer-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT status FROM maintenance_visits WHERE id=?').get(visit)).status, 'completed');
  await db.prepare("UPDATE maintenance_visits SET status='cancelled' WHERE id=?").run(visit);
  for (const action of ['report-sent', 'report-customer-sent', 'complete']) {
    assert.equal((await api(`${endpoint}/${action}`, { method: 'POST', token: ids.tokenManager })).status, 400);
  }
  assert.equal((await api('/api/maintenance-visits/99999999/report-customer-unsent', { method: 'POST', token: ids.tokenManager })).status, 404);
});

test('admin user input validation, duplicate emails and email clearing return predictable results', async () => {
  const body = { name: 'Admin test engineer', email: 'admin-test@test.local', password: 'new-password-123', role: 'engineer' };
  for (const invalid of [{ ...body, name: {} }, { ...body, email: {} }, { ...body, password: {} }, { ...body, password: 'x'.repeat(73) }]) {
    assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body })).status, 409);
  const endpoint = `/api/admin/users/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { name: {} } })).status, 400);
  assert.equal((await api(`${endpoint}/reset-password`, { method: 'POST', token: ids.tokenManager, body: { password: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { email: null } })).status, 200);
  assert.equal((await db.prepare('SELECT email FROM users WHERE id=?').get(created.data.id)).email, null);
  assert.equal((await api(`/api/admin/users/${ids.manager}/toggle-active`, { method: 'POST', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`/api/admin/users/${ids.manager}`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenEnabled, body })).status, 403);
});

test('the final active manager cannot demote themselves', async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Final manager', 'final-manager@test.local', bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid;
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    assert.equal((await api(`/api/admin/users/${user}`, { method: 'PUT', token: signJwt({ id: user }), body: { role: 'engineer' } })).status, 400);
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').get(user)).role, 'manager');
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    await db.prepare('UPDATE users SET active=0 WHERE id=?').run(user);
  }
});

test('concurrent manager self-demotions preserve an active manager on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const managers = [];
  for (const suffix of ['a', 'b']) managers.push((await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(`Concurrent manager ${suffix}`, `concurrent-manager-${suffix}@test.local`, bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid);
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    const results = await Promise.all(managers.map(id => api(`/api/admin/users/${id}`, {
      method: 'PUT', token: signJwt({ id }), body: { role: 'engineer' },
    })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 401].includes(r.status)));
    const remaining = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='manager' AND active=1").get();
    assert.equal(Number(remaining.c), 1);
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    for (const id of managers) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
  }
});

test('personal notes and todos reject malformed values and isolate users', async () => {
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: {} } })).status, 400);
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: 'Private scratchpad' } })).status, 200);
  assert.equal((await api('/api/notes/note', { token: ids.tokenEnabled })).data.content, 'Private scratchpad');
  assert.equal((await api('/api/notes/note', { token: ids.tokenDisabled })).data.content, '');
  assert.equal((await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: {} } })).status, 400);
  const created = await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: 'Private todo' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/notes/todos/${created.data.id}`;
  for (const body of [{ title: {} }, { done: 'false' }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body })).status, 400);
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { done: true } })).status, 404);
  assert.equal((await api(endpoint, { method: 'DELETE', token: ids.tokenDisabled })).status, 200);
  assert.equal((await api('/api/notes/todos', { token: ids.tokenEnabled })).data.length, 1);
});

// pg-mem does not implement the correlated customer-count subqueries used by search.
test('quick and smart search enforce task roles and PM project visibility', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Search review project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO tasks (title, created_by, assigned_to) VALUES (?, ?, ?)').run('Search review private task', ids.manager, ids.engineerEnabled);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Search ${role}`, `search-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    const quick = await api('/api/search?q=Search%20review', { token });
    assert.equal(quick.status, 200);
    assert.deepEqual(quick.data.tasks, []);
    const smart = await api('/api/search/smart?entity=tasks&q=Search%20review', { token });
    assert.equal(smart.status, 200);
    assert.deepEqual(smart.data.tasks, []);
    const projects = await api('/api/search/smart?entity=projects&q=Search%20review', { token });
    assert.equal(projects.status, 200);
    assert.equal(projects.data.projects.some(p => p.id === project), role === 'pm');
    assert.equal(quick.data.projects.some(p => p.id === project), role === 'pm');
  }
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenEnabled })).data.tasks.length, 1);
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenDisabled })).data.tasks.length, 0);
  for (const path of ['/api/search?q[a]=test', '/api/search/smart?q[a]=test', '/api/search/smart?entity=unknown'])
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400);
});

test('service activities validate follow-up dates, times, IDs, text and boolean inputs', async () => {
  const base = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: 'Validation review' };
  for (const invalid of [{ follow_up_date: '2026-02-30' }, { follow_up_date: {} }, { start_time: '25:00' },
    { end_time: '12:99' }, { category_id: {} }, { related_project_id: [] }, { change_reason: {} },
    { follow_up_required: 'false' }, { rollback_available: 'false' }]) {
    assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { ...base, ...invalid } })).status, 400, JSON.stringify(invalid));
  }
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { ...base, start_time: '09:00', end_time: '10:00', follow_up_required: true, follow_up_date: '2026-12-01' } });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { follow_up_date: 'not-a-date' } })).status, 400);
});

test('tracking blocks planners even in enabled teams and keeps PM activity access separate from task creation', async () => {
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Tracking ${role}`, `tracking-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, user);
    const token = signJwt({ id: user });
    const body = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: `Tracking ${role}` };
    assert.equal((await api('/api/service-activities/meta', { token })).status, role === 'planner' ? 403 : 200);
    const created = await api('/api/service-activities', { method: 'POST', token, body });
    assert.equal(created.status, role === 'planner' ? 403 : 200);
    if (role === 'pm') {
      assert.equal((await api(`/api/service-activities/${created.data.id}`, { token })).status, 200);
      assert.equal((await api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token })).status, 403);
      const other = await db.prepare('SELECT id FROM service_activities WHERE engineer_id=? LIMIT 1').get(ids.engineerEnabled);
      assert.equal((await api(`/api/service-activities/${other.id}`, { token })).status, 403);
    }
  }
});

test('tracking metadata exposes customer requirements only for authorized customers', async () => {
  await db.prepare('UPDATE customers SET require_ticket_reference=1 WHERE id=?').run(ids.customer);
  try {
    const meta = await api('/api/service-activities/meta', { token: ids.tokenEnabled });
    assert.equal(meta.status, 200);
    assert.equal(meta.data.customers.find(c => c.id === ids.customer).require_ticket_reference, 1);
    assert.ok(!meta.data.customers.some(c => c.id === ids.customerUnassigned));
  } finally { await db.prepare('UPDATE customers SET require_ticket_reference=0 WHERE id=?').run(ids.customer); }
});

test('the activity detail used for editing preserves notes, category and technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Edit detail technology')).lastInsertRowid;
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10),
    title: 'Full edit detail', description: 'Preserve these notes', technology_ids: [technology], ticket_reference: 'CASE-123',
  } });
  assert.equal(created.status, 200);
  const detail = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.customer_id, ids.customer);
  assert.equal(detail.data.category_id, ids.category);
  assert.equal(detail.data.description, 'Preserve these notes');
  assert.deepEqual(detail.data.technologies.map(t => t.id), [technology]);
  const edited = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { ...detail.data, title: 'Edited title', technology_ids: detail.data.technologies.map(t => t.id) } });
  assert.equal(edited.status, 200);
  const saved = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(saved.data.description, 'Preserve these notes');
  assert.equal(saved.data.ticket_reference, 'CASE-123');
  assert.deepEqual(saved.data.technologies.map(t => t.id), [technology]);
});

test('attachment upload failures clean files and attachment reads enforce activity ownership', async t => {
  const fs = require('fs');
  const path = require('path');
  const { uploadDir } = require('../uploadUtils');
  const activity = (await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10), title: 'Attachment regression',
  } })).data.id;
  const endpoint = `/api/service-activities/${activity}/attachments`;
  const uploadPdf = async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nTest document'], { type: 'application/pdf' }), 'test.pdf');
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenEnabled}` }, body: form });
    return { status: response.status, data: await response.json() };
  };
  const before = (await fs.promises.readdir(uploadDir)).sort();
  const originalPrepare = db.prepare;
  const failure = t.mock.method(db, 'prepare', function(sql) {
    if (/INSERT INTO attachments/i.test(sql)) return { run: async () => { throw new Error('Simulated attachment database failure'); } };
    return originalPrepare.call(this, sql);
  });
  try {
    assert.equal((await uploadPdf()).status, 500);
    assert.deepEqual((await fs.promises.readdir(uploadDir)).sort(), before);
  } finally { failure.mock.restore(); }
  const uploaded = await uploadPdf();
  assert.equal(uploaded.status, 200);
  const attachment = await db.prepare('SELECT stored_name FROM attachments WHERE id=?').get(uploaded.data.id);
  const storedPath = path.join(uploadDir, attachment.stored_name);
  try {
    assert.equal((await api(endpoint, { token: ids.tokenDisabled })).status, 403);
    const ownerList=await api(endpoint,{ token:ids.tokenEnabled });
    assert.equal(ownerList.status,200);assert.equal(ownerList.data[0].stored_name,undefined);assert.equal(ownerList.data[0].enc_iv,undefined);assert.equal(ownerList.data[0].enc_tag,undefined);
    assert.equal((await api(`${endpoint}/not-an-id/download`,{ token:ids.tokenEnabled })).status,400);
    const download = await fetch(`${baseUrl}${endpoint}/${uploaded.data.id}/download`, { headers: { Authorization: `Bearer ${ids.tokenDisabled}` } });
    assert.equal(download.status, 403);
    const ownerDownload=await fetch(`${baseUrl}${endpoint}/${uploaded.data.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenEnabled}` } });
    assert.equal(ownerDownload.status,200);assert.equal(ownerDownload.headers.get('cache-control'),'private, no-store');assert.equal(ownerDownload.headers.get('x-content-type-options'),'nosniff');
    const original = db.prepare;
    const deletionFailure = t.mock.method(db, 'prepare', function(sql) {
      if (/DELETE FROM attachments WHERE id/i.test(sql)) return { run: async () => { throw new Error('Simulated delete failure'); } };
      return original.call(this, sql);
    });
    try {
      assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 500);
      assert.equal(fs.existsSync(storedPath), true);
    } finally { deletionFailure.mock.restore(); }
    assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 200);
    assert.equal(fs.existsSync(storedPath), false);
  } finally {
    await fs.promises.unlink(storedPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});


test('activity edits reject stale versions without changing fields or technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Concurrent edit technology')).lastInsertRowid;
  const created = await createActivity({ title: 'Concurrent editing', description: 'Original', technology_ids: [technology] });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenManager });
  const options = { method: 'PUT', token: ids.tokenManager };
  const first = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Winning edit' } });
  assert.equal(first.status, 200);
  const stale = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Lost edit', technology_ids: [] } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'ACTIVITY_CONFLICT');
  const saved = await api(path, { token: ids.tokenManager });
  assert.equal(saved.data.description, 'Winning edit');
  assert.deepEqual(saved.data.technologies.map(item => item.id), [technology]);
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.equal((await api(path, { ...options, useCurrentVersion: false, body: { title: 'Missing version' } })).status, 428);
  assert.equal((await api(path, { ...options, body: { version: '1' } })).status, 400);
  assert.equal((await api(path, { ...options, body: { version: saved.data.version, description: 'Fresh edit' } })).status, 200);
});

test('list and export reject the same malformed filters', async () => {
  for (const query of ['customer_id=1x', 'category_id=-1', 'technology_id=0', 'from=2026-02-30', 'to=bad', 'from=2026-09-17&to=2026-09-01', 'page=1.5', 'page_size=201', 'page=9007199254740991', 'search=a&search=b', 'status[x]=planned']) {
    for (const route of ['/api/service-activities', '/api/service-activities/export']) {
      const result = await api(`${route}?${query}`, { token: ids.tokenManager });
      assert.equal(result.status, 400, `${route}?${query}`);
    }
  }
});

// pg-mem cannot execute the correlated technology predicate over these joins.
test('Excel export matches all list filters and exports the entire matching set', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Export consistency technology')).lastInsertRowid;
  for (let i = 0; i < 2; i++) await createActivity({ title: `Export consistency ${i}`, technology_ids: [technology], billable_classification: 'billable' });
  await createActivity({ title: 'Export consistency excluded', billable_classification: 'non_billable' });
  const query = new URLSearchParams({ customer_id: ids.customer, category_id: ids.category, technology_id: technology, status: 'planned', billable_classification: 'billable', search: 'Export consistency', from: '2026-01-01', to: '2026-01-31', page_size: 1 });
  const list = await api(`/api/service-activities?${query}`, { token: ids.tokenManager });
  assert.equal(list.status, 200);
  assert.equal(Number(list.data.total), 2);
  assert.equal(list.data.rows.length, 1);
  const response = await fetch(`${baseUrl}/api/service-activities/export?${query}`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(response.status, 200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], list.data.rows[0].activity_reference);
  assert.ok(rows.every(row => row[5].startsWith('Export consistency') && row[8] === 'billable'));
});


test('simultaneous edits allow exactly one write on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity({ title: 'Simultaneous edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenEnabled });
  const results = await Promise.all(['First writer', 'Second writer'].map(description => api(path, {
    method: 'PUT', token: ids.tokenEnabled, body: { version: snapshot.data.version, description },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await api(path, { token: ids.tokenEnabled });
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.ok(['First writer', 'Second writer'].includes(saved.data.description));
});

test('completion and follow-up creation invalidate older editing snapshots', async () => {
  const created = await createActivity({ title: 'Other mutations invalidate edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const token = ids.tokenEnabled;
  const before = (await api(path, { token })).data;
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  const completed = (await api(path, { token })).data;
  assert.equal(completed.version, before.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: before.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, completed.version);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  const linked = (await api(path, { token })).data;
  assert.equal(linked.version, completed.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: completed.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, linked.version);
});


test('management activity report export rejects non-managers including scoped download tokens', async () => {
  for (const role of ['planner', 'pm', 'engineer']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Report guard ${role}`, `report-guard-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/reports/service-activity/export', { token })).status, 403);
    const downloadToken = signJwt({ id: user, download: true });
    assert.equal((await api(`/api/reports/service-activity/export?token=${downloadToken}`)).status, 403);
  }
  for (const suffix of ['', `?token=${signJwt({ id: ids.manager, download: true })}`]) {
    const response = await fetch(`${baseUrl}/api/reports/service-activity/export${suffix}`, {
      headers: suffix ? {} : { Authorization: `Bearer ${ids.tokenManager}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    await response.arrayBuffer();
  }
});


test('task list and workbook export match filters and preserve ownership on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Dispatch project', ids.manager)).lastInsertRowid;
  const rows = [];
  for (const [title, status, priority, deadline, owner] of [
    ['Dispatch 100%_special', 'pending_approval', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch today', 'open', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch waiting', 'waiting_vendor', 'low', '2035-12-30', ids.engineerEnabled],
    ['Dispatch completed', 'completed', 'high', '2035-12-31', ids.engineerEnabled],
    ['Dispatch last day', 'open', 'high', '2036-01-06', ids.engineerEnabled],
    ['Dispatch outside', 'open', 'high', '2036-01-07', ids.engineerEnabled],
    ['Dispatch private', 'open', 'high', '2035-12-31', ids.engineerDisabled],
  ]) rows.push((await db.prepare('INSERT INTO tasks (title,status,priority,deadline,assigned_to,project_id,created_by) VALUES (?,?,?,?,?,?,?)').run(title, status, priority, deadline, owner, project, ids.manager)).lastInsertRowid);
  const cases = [
    [{ filter: 'pending_approval' }, [rows[0]]],
    [{ filter: 'due_today' }, [rows[0], rows[1]]],
    [{ filter: 'overdue' }, [rows[2]]],
    [{ filter: 'waiting_customer' }, [rows[2]]],
    [{ filter: 'due_week' }, [rows[0], rows[1], rows[4]]],
    [{ priority: 'low', search: '  dispatch  ' }, [rows[2]]],
    [{ search: '100%_special' }, [rows[0]]],
  ];
  for (const [extra, expected] of cases) {
    const query = new URLSearchParams({ project_id: String(project), as_of: '2035-12-31', sort: 'deadline', ...extra });
    const list = await api(`/api/tasks?${query}`, { token: ids.tokenEnabled });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.map(row => row.id), expected);
    const response = await fetch(`${baseUrl}/api/tasks/export?${query}`, { headers: { Authorization: `Bearer ${ids.tokenEnabled}` } });
    assert.equal(response.status, 200);
    const workbook = new (require('exceljs').Workbook)();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const titles = [];
    workbook.worksheets[0].eachRow((row, number) => { if (number > 1) titles.push(row.getCell(1).value); });
    assert.deepEqual(titles, list.data.map(row => row.title));
  }
  const spoof = await api(`/api/tasks?project_id=${project}&assigned_to=${ids.engineerDisabled}`, { token: ids.tokenEnabled });
  assert.ok(spoof.data.every(row => row.assigned_to === ids.engineerEnabled));
  const own = await api(`/api/tasks?project_id=${project}&assigned_to=${ids.engineerEnabled}`, { token: ids.tokenManager });
  assert.equal(own.data.length, 6);

});

test('task pages retain full totals, stable ordering, enrichment and unpaged exports on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Paged task fixture', ids.manager)).lastInsertRowid;
  const rows = [];
  for (let i = 0; i < 62; i++) rows.push((await db.prepare('INSERT INTO tasks (title,project_id,deadline,assigned_to,created_by) VALUES (?,?,?,?,?)').run(`Paged item ${i}`, project, '2042-03-01', i === 61 ? ids.engineerDisabled : ids.engineerEnabled, ids.manager)).lastInsertRowid);
  await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_id) VALUES (?,?)').run(rows[0], rows[60]);
  for (const hours of [0.35, 0.4]) await db.prepare('INSERT INTO time_logs (task_id,user_id,hours,logged_at) VALUES (?,?,?,?)').run(rows[25], ids.engineerEnabled, hours, '2042-03-01');
  const base = `project_id=${project}&sort=deadline&filter=open`;
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const response = await api(`/api/tasks?${base}&page=${page}&page_size=25`, { token: ids.tokenEnabled });
    assert.equal(response.status, 200);
    assert.equal(response.data.total, 61);
    assert.equal(response.data.counts.all, 61);
    assert.equal(response.data.counts.open, 61);
    assert.equal(response.data.rows.length, page === 3 ? 11 : 25);
    if (page === 1) assert.equal(response.data.rows[0].is_blocked, true);
    if (page === 2) assert.equal(response.data.rows[0].logged_hours, 0.8);
    found.push(...response.data.rows.map(row => row.id));
  }
  assert.deepEqual(found, rows.slice(0, 61));
  const legacy = await api(`/api/tasks?${base}`, { token: ids.tokenEnabled });
  assert.ok(Array.isArray(legacy.data));
  assert.equal(legacy.data.length, 61);
  const outside = await api(`/api/tasks?${base}&page=999`, { token: ids.tokenEnabled });
  assert.deepEqual(outside.data.rows, []);
  assert.equal(outside.data.total, 61);
  const narrowed = await api(`/api/tasks?${base}&page=1&search=Paged%20item%2060`, { token: ids.tokenEnabled });
  assert.equal(narrowed.data.total, 1);
  assert.equal(narrowed.data.counts.all, 1);
  const download = signJwt({ id: ids.engineerEnabled, download: true });
  const response = await fetch(`${baseUrl}/api/tasks/export?${base}&page=2&page_size=25&token=${download}`);
  assert.equal(response.status, 200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount, 62, 'header plus every matching task, independent of page');
});

test('saved custom reports protect private definitions, ownership and edit versions', async () => {
  const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Report peer manager','report-peer-manager@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
  const token = signJwt({ id: user });
  const body = { name: 'Private delivery report',visibility: 'private',definition: { source: 'tasks',fields: ['id','title'] } };
  const created = await api('/api/reports/custom/saved',{ method: 'POST',token: ids.tokenManager,body });
  assert.equal(created.status,201);
  const path = `/api/reports/custom/saved/${created.data.id}`;
  assert.equal((await api(path,{ token })).status,404);
  assert.equal((await api(`${path}/preview`,{ method: 'POST',token })).status,404);
  assert.equal((await api('/api/reports/custom/saved',{ token })).data.total,0);
  for (const roleToken of [ids.tokenEnabled,ids.tokenDisabled]) {
    assert.equal((await api(path,{ token: roleToken })).status,403);
    assert.equal((await api('/api/reports/custom/saved',{ method: 'POST',token: roleToken,body })).status,403);
  }
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: { ...body,visibility: 'shared',shared_user_ids: [ids.engineerEnabled],shared_team_ids: [],version: 1 } })).status,400);
  const direct = { ...body,visibility: 'shared',shared_user_ids: [user],shared_team_ids: [],version: 1 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: direct })).data.version,2);
  assert.deepEqual((await api(path,{ token: ids.tokenManager })).data.shared_user_ids,[user]);
  assert.deepEqual((await api(path,{ token })).data.shared_user_ids,[],'share membership is visible only to the owner');
  await db.prepare('INSERT INTO team_members (team_id,user_id) VALUES (?,?)').run(ids.teamEnabled,user);
  const teamShared = { ...body,visibility: 'shared',shared_user_ids: [],shared_team_ids: [ids.teamEnabled],version: 2 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: teamShared })).data.version,3);
  assert.equal((await api(path,{ token })).status,200,'manager team membership grants access');
  await db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(ids.teamEnabled,user);
  assert.equal((await api(path,{ token })).status,404,'team access is rechecked after membership removal');
  const shared = { ...body,visibility: 'management',version: 3 };
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: shared })).data.version,4);
  const other = await api(path,{ token });
  assert.equal(other.status,200);
  assert.equal(other.data.can_edit,false);
  assert.deepEqual(other.data.definition,body.definition);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...shared,version: 4 } })).status,403);
  assert.equal((await api(path,{ method: 'DELETE',token,body: { version: 4 } })).status,403);
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: shared })).status,409);
  assert.equal((await api(path,{ method: 'PUT',token: ids.tokenManager,body: { ...body,version: 4 } })).data.version,5);
  assert.equal((await api(`${path}/preview`,{ method: 'POST',token })).status,404,'visibility is checked again on each run');
  assert.equal((await api(path,{ method: 'DELETE',token: ids.tokenManager,body: { version: 4 } })).status,409);
  assert.equal((await api(path,{ method: 'DELETE',token: ids.tokenManager,body: { version: 5 } })).status,200);
  assert.equal((await api(path,{ token: ids.tokenManager })).status,404);
});

test('malformed password expiry values cannot silently disable the policy', async () => {
  const save = value => api('/api/settings/security',{ method: 'PUT',token: ids.tokenManager,body: { password_expiry_days: value } });
  assert.equal((await save(90)).status,200);
  for (const value of ['', '0', '90days',false,null,-1,1.5,3651,{},[]]) assert.equal((await save(value)).status,400);
  assert.equal((await api('/api/settings/security',{ token: ids.tokenManager })).data.password_expiry_days,90);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='password_expiry_days'").get()).value,'90');
  assert.equal((await api('/api/settings/security',{ method: 'PUT',token: ids.tokenEnabled,body: { password_expiry_days: 0 } })).status,403);
  assert.equal((await save(0)).status,200,'explicit numeric zero remains supported');
  assert.equal((await api('/api/settings/security',{ token: ids.tokenManager })).data.password_expiry_days,0);
  assert.equal((await save(90)).status,200);
});

test('integration settings redact stored tokens and webhooks, preserve edits and validate requests', async () => {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('integrations',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ teams: { enabled: false,webhook_url: 'https://secret.example/webhook' },webex: { enabled: true,bot_token: 'retained-webex-token',mode: 'both' } }));
  const read = await api('/api/settings/integrations',{ token: ids.tokenManager });
  assert.equal(read.status,200);
  assert.equal(read.data.teams.webhook_url,'');
  assert.equal(read.data.teams.webhook_url_set,true);
  assert.equal(read.data.webex.bot_token,'');
  assert.equal(read.data.webex.bot_token_set,true);
  assert.equal(JSON.stringify(read.data).includes('retained-webex-token'),false);
  assert.equal((await api('/api/settings/integrations',{ token: ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body: { teams: { clear_webhook_url: true },webex: { mode: 'space',bot_token: '' } } })).status,200);
  let stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='integrations'").get()).value);
  assert.equal(stored.webex.bot_token,'retained-webex-token');
  assert.equal(stored.webex.mode,'space');
  assert.equal(stored.teams.webhook_url,'');
  assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body: { webex: { clear_bot_token: true } } })).status,200);
  stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='integrations'").get()).value);
  assert.equal(stored.webex.bot_token,'');
  for (const body of [[],{ teams: { enabled: 'false' } },{ teams: { webhook_url: 'https://127.0.0.1/private' } }]) assert.equal((await api('/api/settings/integrations',{ method: 'POST',token: ids.tokenManager,body })).status,400);
});

test('Request Tracker settings are manager-only and never return or store a plaintext token',async () => {
  assert.equal((await api('/api/ticketing/settings',{ token:ids.tokenEnabled })).status,403);
  const previous=process.env.CUSTOMER_FIELD_KEY;process.env.CUSTOMER_FIELD_KEY='ef'.repeat(32);
  try {
    const saved=await api('/api/ticketing/settings',{ method:'PUT',token:ids.tokenManager,body:{ enabled:true,base_url:'https://8.8.8.8/rt/',api_token:'integration-secret',sync_interval_minutes:30 } });
    assert.equal(saved.status,200);assert.equal(saved.data.api_token,'');assert.equal(saved.data.api_token_set,true);assert.equal(saved.data.base_url,'https://8.8.8.8/rt');
    const stored=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='ticketing_rt'").get()).value);
    assert.match(stored.api_token,/^enc:/);assert.equal(JSON.stringify(stored).includes('integration-secret'),false);
    const read=await api('/api/ticketing/settings',{ token:ids.tokenManager });assert.equal(JSON.stringify(read.data).includes('integration-secret'),false);
    assert.equal((await api('/api/ticketing/settings',{ method:'PUT',token:ids.tokenManager,body:{ sync_interval_minutes:5 } })).status,400);
  } finally { if (previous===undefined) delete process.env.CUSTOMER_FIELD_KEY;else process.env.CUSTOMER_FIELD_KEY=previous; }
});

test('managed customer configuration enforces manager access, versions and unique RT queues',async () => {
  const path=`/api/customers/${ids.customer}/managed-services`;
  assert.equal((await api(path,{ token:ids.tokenEnabled })).status,403);
  const initial=await api(path,{ token:ids.tokenManager });
  assert.equal(initial.status,200);assert.equal(initial.data.version,0);assert.equal(initial.data.managed_services_enabled,false);
  const body={ ...initial.data,managed_services_enabled:true,service_activity_tracking_enabled:true,responsible_team_id:ids.teamEnabled,
    service_manager_id:ids.manager,reporting_frequency:'monthly',ticket_integration_enabled:true,ticket_include_in_reporting:true,
    external_queue_id:'42',external_queue_name:'Acme Support' };
  for (const key of ['customer_id','last_successful_sync_at','last_sync_status']) delete body[key];
  await db.prepare("INSERT INTO settings (key,value) VALUES ('ticketing_rt',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled:false }));
  assert.equal((await api(path,{ method:'PUT',token:ids.tokenManager,body })).status,409);
  await db.prepare("UPDATE settings SET value=? WHERE key='ticketing_rt'").run(JSON.stringify({ enabled:true,base_url:'https://8.8.8.8/rt' }));
  const saved=await api(path,{ method:'PUT',token:ids.tokenManager,body });
  assert.equal(saved.status,200);assert.equal(saved.data.version,1);assert.equal(saved.data.external_queue_id,'42');
  assert.equal((await db.prepare('SELECT service_activity_enabled FROM customers WHERE id=?').get(ids.customer)).service_activity_enabled,1);
  assert.equal((await db.prepare('SELECT external_queue_name FROM customer_ticketing_configurations WHERE customer_id=?').get(ids.customer)).external_queue_name,'Acme Support');
  assert.equal((await api(path,{ method:'PUT',token:ids.tokenManager,body })).status,409);

  const otherInitial=(await api(`/api/customers/${ids.customerUnassigned}/managed-services`,{ token:ids.tokenManager })).data;
  const other={ ...otherInitial,managed_services_enabled:true,ticket_integration_enabled:true,external_queue_id:'42',external_queue_name:'Duplicate Queue' };
  for (const key of ['customer_id','last_successful_sync_at','last_sync_status']) delete other[key];
  assert.equal((await api(`/api/customers/${ids.customerUnassigned}/managed-services`,{ method:'PUT',token:ids.tokenManager,body:other })).status,409);
  assert.equal((await api(path,{ method:'PUT',token:ids.tokenManager,body:{ ...body,version:1,responsible_team_id:ids.teamDisabled } })).status,400);
  assert.equal((await api(path,{ method:'PUT',token:ids.tokenManager,body:{ ...body,version:1,external_queue_id:'not-an-id' } })).status,400);

  const cleared={ ...saved.data,ticket_integration_enabled:false,external_queue_id:'',external_queue_name:'' };
  for (const key of ['customer_id','last_successful_sync_at','last_sync_status']) delete cleared[key];
  const removed=await api(path,{ method:'PUT',token:ids.tokenManager,body:cleared });
  assert.equal(removed.status,200);assert.equal(removed.data.external_queue_id,'');
  assert.equal(await db.prepare('SELECT id FROM customer_ticketing_configurations WHERE customer_id=?').get(ids.customer),undefined);
});

test('ticket synchronization controls remain manager-only and validate mappings',async () => {
  assert.equal((await api(`/api/ticketing/sync/${ids.customer}`,{ method:'POST',token:ids.tokenEnabled,body:{} })).status,403);
  assert.equal((await api('/api/ticketing/sync/not-an-id',{ method:'POST',token:ids.tokenManager,body:{} })).status,400);
  assert.equal((await api(`/api/ticketing/sync/${ids.customer}`,{ method:'POST',token:ids.tokenManager,body:{} })).status,400);
  assert.equal((await api('/api/ticketing/sync-runs',{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/ticketing/monitoring',{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/ticketing/sync-runs?customer_id=invalid',{ token:ids.tokenManager })).status,400);
});

test('ticket synchronization persists normalized snapshots and run counts',async () => {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('ticketing_rt',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled:true,base_url:'https://rt.example.test/rt',sync_interval_minutes:60 }));
  await db.prepare(`INSERT INTO customer_ticketing_configurations
    (customer_id,provider_type,external_queue_id,external_queue_name,enabled,include_in_reporting)
    VALUES (?,'request_tracker','42','Acme Support',1,1)`).run(ids.customer);
  const { syncCustomer }=require('../ticketSync');
  const provider={ getTickets:async () => [
    { id:'7001',Subject:'Open gateway alert',Status:'open',Priority:'95',Owner:{ id:'alice',Name:'Alice' },Created:'2026-09-20T10:00:00Z',LastUpdated:'2026-09-21T10:00:00Z',Due:'2026-09-21T12:00:00Z' },
    { id:'7002',Subject:'Resolved request',Status:'resolved',Priority:'Normal',Owner:{ id:'bob',Name:'Bob' },Created:'2026-09-19T10:00:00Z',LastUpdated:'2026-09-20T10:00:00Z',Resolved:'2026-09-20T09:00:00Z' },
  ] };
  const first=await syncCustomer(ids.customer,{ provider,triggeredBy:ids.manager });
  assert.deepEqual([first.tickets_found,first.tickets_created,first.tickets_updated],[2,2,0]);
  const rows=await db.prepare('SELECT * FROM external_tickets WHERE customer_id=? ORDER BY external_ticket_id').all(ids.customer);
  assert.equal(rows[0].normalized_priority,'Critical');assert.equal(rows[0].status_group,'open');assert.equal(rows[0].sla_breached,1);
  assert.equal(rows[1].normalized_status,'Resolved');assert.equal(rows[1].status_group,'closed');
  const firstTicket=(await provider.getTickets())[0];
  const second=await syncCustomer(ids.customer,{ provider:{ getTickets:async () => [{ ...firstTicket,Subject:'Updated gateway alert' }] } });
  assert.deepEqual([second.tickets_found,second.tickets_created,second.tickets_updated],[1,0,1]);
  assert.equal((await db.prepare("SELECT subject FROM external_tickets WHERE external_ticket_id='7001'").get()).subject,'Updated gateway alert');
  const runs=await db.prepare('SELECT id,customer_id,status FROM ticket_sync_runs ORDER BY id').all();
  assert.deepEqual(runs.map(row => [row.customer_id,row.status]),[[ids.customer,'success'],[ids.customer,'success']]);
});

test('ticket synchronization monitoring summarizes mappings and names run history',async () => {
  const monitoring=await api('/api/ticketing/monitoring',{ token:ids.tokenManager });
  assert.equal(monitoring.status,200);assert.equal(monitoring.data.integration.enabled,true);
  assert.equal(monitoring.data.summary.mapped_customers,1);assert.equal(monitoring.data.summary.total_tickets,2);
  assert.equal(monitoring.data.summary.last_successful_sync_at!==null,true);
  assert.equal(monitoring.data.customers[0].customer_name,'Acme Corp');assert.equal(monitoring.data.customers[0].open_ticket_count,1);
  const history=await api('/api/ticketing/sync-runs',{ token:ids.tokenManager });
  assert.equal(history.status,200);assert.equal(history.data.rows.length,2);
  assert.equal(history.data.rows.every(run => run.customer_name==='Acme Corp'),true);
  assert.equal(history.data.rows.some(run => run.triggered_by_name),true);
});

test('managed customer dashboard separates current state from period metrics',async () => {
  await db.prepare(`INSERT INTO managed_customer_configurations (customer_id,managed_services_enabled,version,updated_by)
    VALUES (?,1,1,?) ON CONFLICT (customer_id) DO UPDATE SET managed_services_enabled=1`).run(ids.customer,ids.manager);
  assert.equal((await api('/api/managed-customers',{ token:ids.tokenEnabled })).status,403);
  const list=await api('/api/managed-customers',{ token:ids.tokenManager });
  assert.equal(list.status,200);assert.equal(list.data.rows.some(row => row.id===ids.customer),true);
  assert.equal((await api(`/api/managed-customers/${ids.customer}/overview?from=bad&to=2026-09-21`,{ token:ids.tokenManager })).status,400);
  const overview=await api(`/api/managed-customers/${ids.customer}/overview?from=2026-09-01&to=2026-09-30`,{ token:ids.tokenManager });
  assert.equal(overview.status,200);assert.equal(overview.data.customer.id,ids.customer);
  assert.equal(overview.data.tickets.open_now>=1,true);assert.equal(overview.data.tickets.created_period>=2,true);
  assert.equal(typeof overview.data.activities.hours,'number');assert.equal(overview.data.period.from,'2026-09-01');
});

test('managed customer tickets enforce access, validate filters and paginate local results',async () => {
  const path=`/api/managed-customers/${ids.customer}/tickets`;
  assert.equal((await api(path,{ token:ids.tokenEnabled })).status,403);
  for (const query of ['page=0','page_size=101','from=2026-02-30','from=2026-09-22&to=2026-09-21','search=']) {
    assert.equal((await api(`${path}?${query}`,{ token:ids.tokenManager })).status,400);
  }
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/tickets`,{ token:ids.tokenManager })).status,404);
  const first=await api(`${path}?page=1&page_size=1`,{ token:ids.tokenManager });
  assert.equal(first.status,200);assert.equal(first.data.total,2);assert.equal(first.data.rows.length,1);assert.equal(first.data.page_size,1);
  assert.equal(first.data.facets.owners.includes('Alice'),true);assert.equal(first.data.facets.statuses.includes('Open'),true);
  const filtered=await api(`${path}?status=Open&priority=Critical&owner=Alice&from=2026-09-20&to=2026-09-20&search=gateway`,{ token:ids.tokenManager });
  assert.equal(filtered.status,200);assert.equal(filtered.data.total,1);assert.equal(filtered.data.rows[0].ticket_number,'7001');
  assert.match(filtered.data.rows[0].external_url,/^https:\/\//);
  const literalWildcard=await api(`${path}?search=%25`,{ token:ids.tokenManager });
  assert.equal(literalWildcard.status,200);assert.equal(literalWildcard.data.total,0);
});

test('managed customer ticket analytics separate current backlog from period throughput',async () => {
  const path=`/api/managed-customers/${ids.customer}/ticket-analytics`;
  assert.equal((await api(path,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`${path}?from=bad&to=2026-09-21`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/ticket-analytics`,{ token:ids.tokenManager })).status,404);
  const result=await api(`${path}?from=2026-09-01&to=2026-09-30`,{ token:ids.tokenManager });
  assert.equal(result.status,200);assert.equal(result.data.current.total_open,1);
  assert.deepEqual(result.data.current.statuses,[{ name:'Open',count:1 }]);
  assert.deepEqual(result.data.current.priorities,[{ name:'Critical',count:1 }]);
  assert.equal(result.data.period.created,2);assert.equal(result.data.period.resolved,1);
  assert.equal(result.data.current.aging.reduce((sum,row) => sum+row.count,0),1);
});

test('managed customer activities reuse customer-scoped activity records and period totals',async () => {
  const path=`/api/managed-customers/${ids.customer}/activities`;
  assert.equal((await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenEnabled })).status,403);
  for (const query of ['from=bad&to=2026-12-31','from=2026-12-31&to=2026-01-01','from=2026-01-01&to=2026-12-31&page_size=101']) assert.equal((await api(`${path}?${query}`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/activities?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager })).status,404);
  const result=await api(`${path}?from=2026-01-01&to=2026-12-31&page=1&page_size=1`,{ token:ids.tokenManager });
  assert.equal(result.status,200);assert.equal(result.data.enabled,true);assert.equal(result.data.rows.length,1);
  assert.equal(result.data.total>=1,true);assert.equal(result.data.summary.activities,result.data.total);
  assert.equal(typeof result.data.summary.hours,'number');assert.equal(result.data.breakdowns.categories.length>=1,true);
  assert.equal(result.data.rows[0].category_name.length>0,true);assert.equal(result.data.rows[0].engineer_name.length>0,true);
});

test('managed customer work reuses task and project relationships with configured reporting gates',async () => {
  const path=`/api/managed-customers/${ids.customer}/work`;
  assert.equal((await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`${path}?from=2026-12-31&to=2026-01-01`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/work?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager })).status,404);
  const result=await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager });
  assert.equal(result.status,200);assert.equal(result.data.tasks.enabled,true);assert.equal(result.data.projects.enabled,true);
  assert.equal(result.data.tasks.summary.total>=result.data.tasks.rows.length,true);
  assert.equal(result.data.projects.summary.total>=result.data.projects.rows.length,true);
  assert.equal(result.data.tasks.rows.every(row => row.project_id),true);
  assert.equal(result.data.projects.rows.every(row => Number.isInteger(row.completion_pct)),true);
});

test('managed customer service review combines visits, report delivery and recommendations',async () => {
  const path=`/api/managed-customers/${ids.customer}/service-review`;
  assert.equal((await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`${path}?from=bad&to=2026-12-31`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/service-review?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager })).status,404);
  const result=await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager });
  assert.equal(result.status,200);assert.equal(result.data.visits.enabled,true);assert.equal(result.data.recommendations.enabled,true);
  assert.equal(result.data.visits.summary.visits_period>=result.data.visits.rows.length,true);
  assert.equal(result.data.visits.rows.every(row => Number.isInteger(row.recommendation_count)),true);
  assert.equal(typeof result.data.recommendations.summary.open_now,'number');assert.equal(Array.isArray(result.data.recommendations.statuses),true);
});

test('managed customer timeline combines source events with stable pagination',async () => {
  const path=`/api/managed-customers/${ids.customer}/timeline`;
  assert.equal((await api(`${path}?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`${path}?from=2026-01-01&to=2026-12-31&page=0`,{ token:ids.tokenManager })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customerUnassigned}/timeline?from=2026-01-01&to=2026-12-31`,{ token:ids.tokenManager })).status,404);
  const result=await api(`${path}?from=2026-01-01&to=2026-12-31&page_size=2`,{ token:ids.tokenManager });
  assert.equal(result.status,200);assert.equal(result.data.rows.length<=2,true);assert.equal(result.data.total>=result.data.rows.length,true);
  assert.equal(result.data.rows.every(row => ['kind','source_id','occurred_at','title'].every(key => row[key])),true);
  assert.deepEqual([...result.data.rows].sort((a,b) => b.occurred_at.localeCompare(a.occurred_at)),result.data.rows);
});

test('managed customer report preview reuses dashboard metrics and protects customer-facing input',async () => {
  const path=`/api/managed-customers/${ids.customer}/report-preview`,body={ from:'2026-09-01',to:'2026-09-30',sections:['executive_summary','ticket_summary','service_activities'],narratives:{ executive_summary:'  Customer-facing summary  ',risks_concerns:'No material risks.' } };
  assert.equal((await api(path,{ method:'POST',token:ids.tokenEnabled,body })).status,403);
  assert.equal((await api('/api/managed-customers/not-an-id/report-preview',{ method:'POST',token:ids.tokenManager,body })).status,400);
  assert.equal((await api(path,{ method:'POST',token:ids.tokenManager,body:{ ...body,from:'2026-02-31' } })).status,400);
  assert.equal((await api(path,{ method:'POST',token:ids.tokenManager,body:{ ...body,sections:['not_a_section'] } })).status,400);
  assert.equal((await api(path,{ method:'POST',token:ids.tokenManager,body:{ ...body,narratives:{ internal_notes:'must not leak' } } })).status,400);
  const [preview,overview]=await Promise.all([api(path,{ method:'POST',token:ids.tokenManager,body }),api(`/api/managed-customers/${ids.customer}/overview?from=${body.from}&to=${body.to}`,{ token:ids.tokenManager })]);
  assert.equal(preview.status,200);assert.equal(preview.data.schema_version,1);assert.deepEqual(preview.data.sections,body.sections);
  assert.equal(preview.data.narratives.executive_summary,'Customer-facing summary');assert.equal(JSON.stringify(preview.data).includes('internal_notes'),false);
  assert.deepEqual(Object.keys(preview.data.customer).sort(),['id','name','reporting_frequency','responsible_team','service_manager']);
  assert.deepEqual(preview.data.overview.tickets,overview.data.tickets);assert.deepEqual(preview.data.overview.activities,overview.data.activities);
  assert.equal(preview.data.tickets.open.rows.every(ticket => ticket.status_group==='open'),true);
  const documentResponse=await fetch(`${baseUrl}${path.replace('report-preview','report.docx')}`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify(body) });
  assert.equal(documentResponse.status,200);assert.match(documentResponse.headers.get('content-type'),/wordprocessingml/);assert.match(documentResponse.headers.get('content-disposition'),/Acme_Corp_2026-09-01_2026-09-30\.docx/);
  const documentBuffer=Buffer.from(await documentResponse.arrayBuffer());assert.equal(documentBuffer.subarray(0,2).toString(),'PK');
  const archive=await require('jszip').loadAsync(documentBuffer),documentXml=await archive.file('word/document.xml').async('string');
  assert.match(documentXml,/Managed Services Report/);assert.match(documentXml,/Customer-facing summary/);assert.doesNotMatch(documentXml,/internal_notes/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='managed_customer_word_report_generated'").get()).count,1);
});

test('ticket mapping administration is manager-only and reclassifies stored tickets',async () => {
  assert.equal((await api('/api/ticketing/mappings',{ token:ids.tokenEnabled })).status,403);
  const current=await api('/api/ticketing/mappings',{ token:ids.tokenManager });
  assert.equal(current.status,200);assert.equal(current.data.statuses.some(item => item.external==='open'),true);
  const config={ statuses:[{ external:'open',normalized:'In Progress',group:'open' },{ external:'resolved',normalized:'Closed',group:'closed' }],priorities:[{ external:'95',normalized:'High' },{ external:'Normal',normalized:'Normal' }] };
  const saved=await api('/api/ticketing/mappings',{ method:'PUT',token:ids.tokenManager,body:config });
  assert.equal(saved.status,200);assert.equal(saved.data.reclassified>=2,true);
  const open=await db.prepare("SELECT normalized_status,normalized_priority FROM external_tickets WHERE external_ticket_id='7001'").get();
  assert.deepEqual(open,{ normalized_status:'In Progress',normalized_priority:'High' });
  assert.equal((await api('/api/ticketing/mappings',{ method:'PUT',token:ids.tokenManager,body:{ statuses:[{ external:'open',normalized:'Bad',group:'open' }],priorities:[] } })).status,400);
});

test('SMTP settings await reads, redact and retain passwords on ordinary edits', async () => {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('email_smtp',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ host: 'smtp.test.local',port: 587,user: 'report-user',password: 'retained-secret' }));
  const before = await api('/api/report-settings/smtp',{ token: ids.tokenManager });
  assert.equal(before.status,200);
  assert.equal(before.data.host,'smtp.test.local');
  assert.equal(before.data.password_set,true);
  assert.equal(before.data.password,undefined);
  assert.equal((await api('/api/report-settings/smtp',{ token: ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/report-settings/smtp',{ method: 'PUT',token: ids.tokenManager,body: { from_name: 'Updated sender' } })).status,200);
  let stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='email_smtp'").get()).value);
  assert.equal(stored.password,'retained-secret');
  assert.equal(stored.host,'smtp.test.local');
  assert.equal(stored.from_name,'Updated sender');
  await api('/api/report-settings/smtp',{ method: 'PUT',token: ids.tokenManager,body: { password: '\u2022'.repeat(8) } });
  stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='email_smtp'").get()).value);
  assert.equal(stored.password,'retained-secret');
  for (const body of [{ enabled: true,day: 7,hour: 9,minute: 0,recipients: [ids.manager] },{ enabled: true,day: 1,hour: 9,minute: 0,recipients: [ids.engineerEnabled] }]) assert.equal((await api('/api/report-settings/schedule',{ method: 'PUT',token: ids.tokenManager,body })).status,400);
});

test('weekly report previews await actual report data on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const preview = await api('/api/report-settings/preview-data',{ token: ids.tokenManager });
  assert.equal(preview.status,200);
  assert.equal(typeof preview.data.stats.activeProjects,'number');
  assert.equal(typeof preview.data.subject,'string');
  const html = await fetch(`${baseUrl}/api/report-settings/preview`,{ headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(html.status,200);
  assert.match(await html.text(),/<!DOCTYPE html>/);
});

test('report schedules enforce ownership, recipient eligibility, versions and rechecked delivery', async () => {
  const owner = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Scheduled owner','scheduled-owner@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
  const peer = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Scheduled peer','scheduled-peer@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
  const token = signJwt({ id: owner }),peerToken = signJwt({ id: peer });
  const body = { name: 'Scheduled fixture',visibility: 'shared',shared_user_ids: [peer],shared_team_ids: [],definition: { source: 'tasks',fields: ['id'] } };
  const report = (await api('/api/reports/custom/saved',{ method: 'POST',token,body })).data;
  const path = `/api/reports/custom/saved/${report.id}/schedule`;
  assert.equal((await api(path,{ token: peerToken })).status,403);
  assert.equal((await api(path,{ token: ids.tokenEnabled })).status,403);
  const schedule = { frequency: 'weekly',day: 1,hour: 9,minute: 0,enabled: true,recipient_ids: [peer],version: 0 };
  for (const change of [{ recipient_ids: [ids.engineerEnabled] },{ day: 7 },{ hour: true },{ recipient_ids: [peer,peer] }]) assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,...change } })).status,400);
  assert.equal((await api(path,{ method: 'PUT',token: peerToken,body: schedule })).status,403);
  assert.equal((await api(path,{ method: 'PUT',token,body: schedule })).data.version,1);
  if (process.env.TEST_DATABASE_URL) assert.equal((await api(path,{ method: 'PUT',token,body: schedule })).status,409);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,version: 1 } })).data.version,2);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,version: 1 } })).status,409);
  assert.equal((await api(path,{ token })).data.schedule.enabled,true);
  const { tick } = require('../customReportScheduler');
  const now = new Date('2040-01-02T10:00:00Z'),sent = [];
  const run = async () => ({ columns: [{ key: 'id',label: 'ID' }],rows: [{ id: 1 }],truncated: false });
  const due = () => db.prepare('UPDATE custom_report_schedules SET next_run=? WHERE report_id=?').run('2000-01-01T00:00:00.000Z',report.id);
  await due();
  await tick({ now,run,send: async mail => sent.push(mail) });
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,'scheduled-peer@test.local');
  assert.match(sent[0].attachments[0].content.toString(),/"ID"/);
  await tick({ now,run,send: async mail => sent.push(mail) });
  assert.equal(sent.length,1,'already claimed slots are not resent');
  await db.prepare("UPDATE users SET role='engineer' WHERE id=?").run(peer);
  await due();
  await tick({ now,run,send: async mail => sent.push(mail) });
  assert.equal(sent.length,1,'demoted recipients receive no report');
  let current = (await api(path,{ token })).data.schedule;
  assert.equal(current.last_status,'blocked');
  assert.equal(current.enabled,false);
  await db.prepare("UPDATE users SET role='manager' WHERE id=?").run(peer);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,version: current.version } })).status,200);
  await due();
  await tick({ now,run: async () => ({ ...(await run()),truncated: true }),send: async mail => sent.push(mail) });
  current = (await api(path,{ token })).data.schedule;
  assert.equal(current.last_status,'failed');
  assert.match(current.last_error,/5000 rows/);
  assert.equal(sent.length,1);
  await due();
  await tick({ now,run: async () => {
    await db.prepare('UPDATE users SET active=0 WHERE id=?').run(peer);
    return run();
  },send: async mail => sent.push(mail) });
  current = (await api(path,{ token })).data.schedule;
  assert.equal(current.last_status,'blocked');
  assert.equal(sent.length,1,'access is checked again after the query and before delivery');
  await db.prepare('UPDATE users SET active=1 WHERE id=?').run(peer);
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,version: current.version } })).status,200);
  await db.prepare("UPDATE saved_custom_reports SET visibility='private' WHERE id=?").run(report.id);
  await due();
  await tick({ now,run,send: async mail => sent.push(mail) });
  current = (await api(path,{ token })).data.schedule;
  assert.equal(current.last_status,'blocked');
  assert.equal(sent.length,1,'unshared reports no longer reach other managers');
  assert.equal((await api(path,{ method: 'PUT',token,body: { ...schedule,version: current.version,enabled: false,recipient_ids: [] } })).status,200);
  assert.equal((await api(`/api/reports/custom/saved/${report.id}`,{ method: 'DELETE',token,body: { version: 1 } })).status,200);
  assert.equal(await db.prepare('SELECT * FROM custom_report_schedules WHERE report_id=?').get(report.id),undefined);
});

test('concurrent schedule creation and edits conflict on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const report = (await api('/api/reports/custom/saved',{ method: 'POST',token: ids.tokenManager,body: { name: 'Concurrent schedule',visibility: 'private',definition: { source: 'tasks',fields: ['id'] } } })).data;
  const path = `/api/reports/custom/saved/${report.id}/schedule`;
  const save = version => api(path,{ method: 'PUT',token: ids.tokenManager,body: { frequency: 'daily',day: 0,hour: 9,minute: 0,enabled: false,recipient_ids: [],version } });
  assert.deepEqual((await Promise.all([save(0),save(0)])).map(row => row.status).sort(),[200,409]);
  assert.deepEqual((await Promise.all([save(1),save(1)])).map(row => row.status).sort(),[200,409]);
});

test('custom report metadata and execution enforce manager access and validate structure', async () => {
  for (const token of [ids.tokenEnabled,ids.tokenDisabled]) {
    assert.equal((await api('/api/reports/custom/sources',{ token })).status,403);
    for (const route of ['preview','export','export-csv']) assert.equal((await api(`/api/reports/custom/${route}`,{ method: 'POST',token,body: { source: 'tasks',fields: ['id'] } })).status,403);
  }
  const sources = await api('/api/reports/custom/sources',{ token: ids.tokenManager });
  assert.equal(sources.status,200);
  assert.equal(sources.data.preview_limit,100);
  for (const body of [null,[],{ source: 'users',fields: ['password'] },{ source: 'tasks',fields: ['secret'] },{ source: 'tasks',fields: ['id'],filters: [{ field: 'id',operator: 'eq',value: '1' }] }]) {
    for (const route of ['preview','export','export-csv']) assert.equal((await api(`/api/reports/custom/${route}`,{ method: 'POST',token: ids.tokenManager,body })).status,400);
  }
});

test('custom reports preview, aggregate and export bounded matching rows on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title,created_by) VALUES (?,?)').run('Custom report fixture',ids.manager)).lastInsertRowid;
  for (let i=0;i<102;i++) await db.prepare('INSERT INTO tasks (title,project_id,created_by,status) VALUES (?,?,?,?)').run(`Custom report task ${i}`,project,ids.manager,i<100 ? 'open' : 'completed');
  const definition = { source: 'tasks',fields: ['id','title','status'],filters: [{ field: 'project_id',operator: 'eq',value: project }] };
  const preview = await api('/api/reports/custom/preview',{ method: 'POST',token: ids.tokenManager,body: definition });
  assert.equal(preview.status,200);
  assert.equal(preview.data.rows.length,100);
  assert.equal(preview.data.truncated,true);
  const grouped = await api('/api/reports/custom/preview',{ method: 'POST',token: ids.tokenManager,body: { ...definition,fields: ['status'],group_by: ['status'],aggregations: [{ field: '*',operation: 'count' }] } });
  assert.equal(grouped.status,200);
  assert.deepEqual(grouped.data.rows,[{ status: 'completed',metric_0: 2 },{ status: 'open',metric_0: 100 }]);
  const excluded = await api('/api/reports/custom/preview',{ method: 'POST',token: ids.tokenManager,body: { ...definition,filters: [...definition.filters,{ field: 'status',operator: 'not_in',value: ['completed'] }] } });
  assert.equal(excluded.status,200);
  assert.equal(excluded.data.rows.length,100);
  assert.equal(excluded.data.truncated,false);
  assert.ok(excluded.data.rows.every(row => row.status==='open'));
  const response = await fetch(`${baseUrl}/api/reports/custom/export`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-SolutionsHub-Request': '1',Authorization: `Bearer ${ids.tokenManager}` },body: JSON.stringify(definition) });
  assert.equal(response.status,200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount,103);
  assert.deepEqual(workbook.worksheets[0].getRow(2).values.slice(1),Object.values(preview.data.rows[0]));
  const csv = await fetch(`${baseUrl}/api/reports/custom/export-csv`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-SolutionsHub-Request': '1',Authorization: `Bearer ${ids.tokenManager}` },body: JSON.stringify(definition) });
  assert.equal(csv.status,200);
  assert.match(csv.headers.get('content-type'),/text\/csv/);
  const lines = (await csv.text()).trim().split('\r\n');
  assert.equal(lines.length,103);
  assert.equal(lines[1],Object.values(preview.data.rows[0]).map(require('../customReports').csvCell).join(','));
  await db.exec(`INSERT INTO tasks (title,project_id,created_by) SELECT 'Report budget fixture',${project},${ids.manager} FROM generate_series(1,5001);`);
  const oversized = await api('/api/reports/custom/export',{ method: 'POST',token: ids.tokenManager,body: definition });
  assert.equal(oversized.status,413);
  assert.match(oversized.data.error,/5000 rows/);
  assert.equal((await api('/api/reports/custom/export-csv',{ method: 'POST',token: ids.tokenManager,body: definition })).status,413);
});

test('workload planning validates inputs, scopes roles and rejects conflicting input saves', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by,deadline) VALUES (?,?,?,?)').run('Estimated task',ids.engineerEnabled,ids.manager,'2026-09-18')).lastInsertRowid;
  for (const token of [ids.tokenEnabled,ids.tokenDisabled]) {
    assert.equal((await api('/api/workload/planning', { token })).status,403);
    assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token,body: { kind: 'task',id: task,version: 0,remaining_hours: 2 } })).status,403);
  }
  for (const query of ['as_of=2026-02-29','as_of=','as_of=2026-09-18&as_of=2026-09-19']) assert.equal((await api(`/api/workload/planning?${query}`, { token: ids.tokenManager })).status,400);
  const estimate = { kind: 'task',id: task,version: 0,remaining_hours: 2 };
  for (const extra of [{ kind: 'users' },{ id: true },{ version: -1 },{ remaining_hours: '2' },{ remaining_hours: -1 },{ remaining_hours: 10001 }]) assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token: ids.tokenManager,body: { ...estimate,...extra } })).status,400);
  assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token: ids.tokenManager,body: estimate })).status,200);
  // pg-mem incorrectly returns an existing row for DO NOTHING RETURNING.
  if (process.env.TEST_DATABASE_URL) assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token: ids.tokenManager,body: estimate })).status,409);
  assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token: ids.tokenManager,body: { ...estimate,version: 1,remaining_hours: 3 } })).data.version,2);
  assert.equal((await api('/api/workload/planning/estimate', { method: 'PUT',token: ids.tokenManager,body: { ...estimate,version: 1,remaining_hours: 99 } })).status,409);
  const availability = { user_id: ids.engineerEnabled,week_start: '2026-09-14',version: 0,available_hours: 30 };
  for (const extra of [{ week_start: '2026-09-15' },{ user_id: ids.manager },{ available_hours: '30' },{ available_hours: 169 },{ version: null }]) assert.equal((await api('/api/workload/planning/availability', { method: 'PUT',token: ids.tokenManager,body: { ...availability,...extra } })).status,400);
  assert.equal((await api('/api/workload/planning/availability', { method: 'PUT',token: ids.tokenManager,body: availability })).status,200);
  if (process.env.TEST_DATABASE_URL) assert.equal((await api('/api/workload/planning/availability', { method: 'PUT',token: ids.tokenManager,body: availability })).status,409);
  assert.equal((await api('/api/workload/planning/availability', { method: 'PUT',token: ids.tokenManager,body: { ...availability,version: 1,available_hours: 0 } })).data.version,2);
  assert.equal((await api('/api/workload/planning/availability', { method: 'PUT',token: ids.tokenManager,body: { ...availability,version: 1,available_hours: 99 } })).status,409);
});

test('workload input creation and updates detect simultaneous changes on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const task = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by) VALUES (?,?,?)').run('Concurrent effort input',ids.engineerEnabled,ids.manager)).lastInsertRowid;
  const inputs = [
    ['estimate',{ kind: 'task',id: task,version: 0,remaining_hours: 1 }],
    ['availability',{ user_id: ids.engineerEnabled,week_start: '2050-01-03',version: 0,available_hours: 20 }],
  ];
  for (const [endpoint,body] of inputs) {
    const save = version => api(`/api/workload/planning/${endpoint}`, { method: 'PUT',token: ids.tokenManager,body: { ...body,version } });
    assert.deepEqual((await Promise.all([save(0),save(0)])).map(row => row.status).sort(),[200,409]);
    assert.deepEqual((await Promise.all([save(1),save(1)])).map(row => row.status).sort(),[200,409]);
  }
});

test('workload planning calculates known coverage, per-engineer visits and recorded availability on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const engineer = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Capacity fixture','capacity@test.local',bcrypt.hashSync('pw',4),'engineer')).lastInsertRowid;
  const peer = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Capacity peer','capacity-peer@test.local',bcrypt.hashSync('pw',4),'engineer')).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by,deadline) VALUES (?,?,?,?)').run('Capacity task',engineer,ids.manager,'2045-01-03')).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Capacity visit',ids.customer,'2045-01-03',ids.manager)).lastInsertRowid;
  for (const user of [engineer,peer]) await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit,user);
  const save = (endpoint,body) => api(`/api/workload/planning/${endpoint}`, { method: 'PUT',token: ids.tokenManager,body });
  await save('estimate',{ kind: 'task',id: task,version: 0,remaining_hours: 15 });
  await save('estimate',{ kind: 'visit',id: visit,version: 0,remaining_hours: 5 });
  await save('availability',{ user_id: engineer,week_start: '2045-01-02',version: 0,available_hours: 10 });
  const response = await api('/api/workload/planning?as_of=2045-01-03', { token: ids.tokenManager });
  assert.equal(response.status,200);
  const week = response.data.engineers.find(row => row.id === engineer).weeks[0];
  assert.equal(week.estimated_hours,20);
  assert.equal(week.capacity_percent,200);
  assert.equal(week.unknown_estimates,0);
  assert.equal(week.items.length,2);
  assert.equal(response.data.engineers.find(row => row.id === peer).weeks[0].items.find(row => row.kind === 'visit' && row.id === visit).remaining_hours,5);
  const missing = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by,deadline) VALUES (?,?,?,?)').run('Unknown capacity task',engineer,ids.manager,'2045-01-03')).lastInsertRowid;
  const partial = await api('/api/workload/planning?as_of=2045-01-03', { token: ids.tokenManager });
  assert.equal(partial.data.engineers.find(row => row.id === engineer).weeks[0].capacity_percent,null);
  assert.equal(partial.data.engineers.find(row => row.id === engineer).weeks[0].unknown_estimates,1);
  await db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(missing);
});

test('customer recommendations validate references, preserve history and reject stale edits', async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Recommendation customer')).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Recommendation source', customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const foreign = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Foreign source', ids.customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const path = `/api/customers/${customer}/recommendations`;
  const body = { finding: 'Obsolete equipment', recommendation: 'Replace equipment', source_visit_id: visit, owner_id: ids.engineerEnabled, risk_level: 'high', due_date: '2026-10-01' };
  assert.equal((await api(path, { token:ids.tokenDisabled })).status,403);
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit,ids.engineerEnabled);
  assert.equal((await api(path,{ token:ids.tokenEnabled })).status,200);
  const engineerCreated=await api(path,{ method:'POST',token:ids.tokenEnabled,body:{ ...body,owner_id:ids.manager,finding:'Engineer finding' } });
  assert.equal(engineerCreated.status,201);
  assert.equal(engineerCreated.data.owner_id,ids.engineerEnabled);
  let plannerToken,plannerCreated;
  for (const role of ['planner','pm']) {
    const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Recommendation ${role}`, `recommendation-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api(path, { token })).status,role==='planner' ? 200 : 403);
    const response=await api(path,{ method:'POST',token,body:{ ...body,finding:`${role} finding` } });
    assert.equal(response.status,role==='planner' ? 201 : 403);
    if(role==='planner'){plannerToken=token;plannerCreated=response.data;}
    assert.equal((await api(`${path}/999/convert-to-project`, { method: 'POST', token, body: { version: 1, title: 'Denied conversion' } })).status, 403);
  }
  for (const query of ['page=0','page=1&page=2','page[x]=1','status=unknown','status=open&status=closed']) assert.equal((await api(`${path}?${query}`, { token: ids.tokenManager })).status, 400);
  for (const extra of [{ finding: '' }, { recommendation: 1 }, { finding: 'x'.repeat(10001) }, { due_date: '2026-02-29' }, { owner_id: true }, { source_visit_id: foreign }, { owner_id: 99999999 }, { status: 'converted_to_project' }, { risk_level: 'invalid' }]) assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...body, ...extra } })).status, 400);
  const created = await api(path, { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 201);
  assert.equal(created.data.version, 1);
  assert.equal(created.data.status, 'open');
  const id = created.data.id;
  const updated = await api(`${path}/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 1, status: 'accepted', follow_up_notes: 'Customer accepted the proposal' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.version, 2);
  assert.equal(updated.data.finding, body.finding);
  const stale = await api(`${path}/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 1, status: 'rejected' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'RECOMMENDATION_CONFLICT');
  assert.equal((await api(`/api/customers/${ids.customer}/recommendations/${id}`, { method: 'PUT', token: ids.tokenManager, body: { version: 2, status: 'closed' } })).status, 404);
  assert.deepEqual((await db.prepare('SELECT action,status,version FROM recommendation_history WHERE recommendation_id=? ORDER BY id').all(id)), [{ action: 'created', status: 'open', version: 1 }, { action: 'updated', status: 'accepted', version: 2 }]);
  const converted = await api(`${path}/${id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 2, title: 'Equipment replacement' } });
  assert.equal(converted.status, 201);
  assert.equal(converted.data.status, 'converted_to_project');
  const project = await db.prepare('SELECT customer_id,deadline,description FROM projects WHERE id=?').get(converted.data.related_project_id);
  assert.equal(project.customer_id, customer);
  assert.equal(project.deadline, body.due_date);
  assert.ok(project.description.includes(body.finding) && project.description.includes(body.recommendation));
  assert.ok(await db.prepare('SELECT user_id FROM project_assignments WHERE project_id=? AND user_id=?').get(converted.data.related_project_id, ids.engineerEnabled));
  const taskProject=(await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run('Recommendation task project',customer,ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(taskProject,ids.engineerEnabled);
  const taskConversion=await api(`${path}/${plannerCreated.id}/convert-to-task`,{ method:'POST',token:plannerToken,body:{ version:1,title:'Replace equipment task',project_id:taskProject,assigned_to:ids.engineerEnabled,priority:'high',deadline:'2026-10-01' } });
  assert.equal(taskConversion.status,201);
  const task=await db.prepare('SELECT project_id,assigned_to,title FROM tasks WHERE id=?').get(taskConversion.data.task_id);
  assert.deepEqual(task,{ project_id:taskProject,assigned_to:ids.engineerEnabled,title:'Replace equipment task' });
  const engineerTask=await api(`${path}/${engineerCreated.data.id}/convert-to-task`,{ method:'POST',token:ids.tokenEnabled,body:{ version:1,title:'Engineer remediation',project_id:taskProject,assigned_to:ids.engineerEnabled } });
  assert.equal(engineerTask.status,201);
  assert.equal((await api(`${path}/${engineerCreated.data.id}/convert-to-task`,{ method:'POST',token:plannerToken,body:{ version:2,title:'Unauthorized',project_id:taskProject,assigned_to:ids.engineerEnabled } })).status,403);
  assert.equal((await api(`/api/projects/${taskProject}`,{ method:'PUT',token:ids.tokenManager,body:{ customer_id:ids.customer } })).status,409);
  assert.equal((await api(`${path}/${id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 3, title: 'Duplicate conversion' } })).status, 409);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE customer_id=?').get(customer)).total), 2);
});

test('recommendation conversion rolls back its project and version if history fails on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager, body: { finding: 'Atomic conversion fixture', recommendation: 'History must persist' } });
  assert.equal(created.status, 201);
  const originalTransaction = db.transaction;
  try {
    db.transaction = callback => originalTransaction(tx => callback({ ...tx, prepare(sql) {
      if (sql.startsWith('INSERT INTO recommendation_history')) throw new Error('Simulated recommendation history failure');
      return tx.prepare(sql);
    } }));
    const response = await api(`/api/customers/${ids.customer}/recommendations/${created.data.id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 1, title: 'Atomic conversion should roll back' } });
    assert.equal(response.status, 500);
  } finally { db.transaction = originalTransaction; }
  const stored = await db.prepare('SELECT version,status,related_project_id FROM customer_recommendations WHERE id=?').get(created.data.id);
  assert.deepEqual(stored, { version: 1, status: 'open', related_project_id: null });
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE title=?').get('Atomic conversion should roll back')).total), 0);
});

test('recommendations enforce customer links and concurrent conversions on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Concurrent recommendation customer')).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by) VALUES (?,?,?,?)').run('Retained recommendation source', customer, '2026-09-18', ids.manager)).lastInsertRowid;
  const path = `/api/customers/${customer}/recommendations`;
  const created = await api(path, { method: 'POST', token: ids.tokenManager, body: { finding: 'Concurrent finding', recommendation: 'One project', source_visit_id: visit } });
  assert.equal(created.status, 201);
  const responses = await Promise.all([1,2].map(i => api(`${path}/${created.data.id}/convert-to-project`, { method: 'POST', token: ids.tokenManager, body: { version: 1, title: `Concurrent conversion ${i}` } })));
  assert.deepEqual(responses.map(row => row.status).sort(), [201,409]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS total FROM projects WHERE customer_id=?').get(customer)).total), 1);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customer } })).status, 409);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { method: 'DELETE', token: ids.tokenManager })).status, 409);
  const converted = responses.find(row => row.status === 201).data;
  assert.equal((await api(`/api/projects/${converted.related_project_id}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customer } })).status, 409);
  assert.equal((await api(`/api/customers/${customer}`, { method: 'DELETE', token: ids.tokenManager })).status, 409);
  const list = await api(`${path}?status=converted_to_project`, { token: ids.tokenManager });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.rows[0].source_visit_title, 'Retained recommendation source');
  assert.equal((await api(`${path}?page=0`, { token: ids.tokenManager })).status, 400);
  const overview = await api(`/api/customers/${customer}/overview`, { token: ids.tokenManager });
  assert.equal(overview.data.timeline.filter(row => row.kind === 'recommendation').length, 2);
});

test('customer overview rejects unauthorized roles and malformed inputs', async () => {
  for (const user of [ids.engineerEnabled, ids.engineerDisabled]) assert.equal((await api(`/api/customers/${ids.customer}/overview`, { token: signJwt({ id: user }) })).status, 403);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Overview ${role}`, `customer-overview-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    assert.equal((await api(`/api/customers/${ids.customer}/overview`, { token: signJwt({ id: user }) })).status, 403);
  }
  for (const id of ['0', '-1', '1abc', '9007199254740992']) assert.equal((await api(`/api/customers/${id}/overview`, { token: ids.tokenManager })).status, 400);
  for (const query of ['page=0', 'page=1.5', 'page=1&page=2', 'page[x]=1', 'page=9007199254740991']) assert.equal((await api(`/api/customers/${ids.customer}/overview?${query}`, { token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/customers/99999999/overview', { token: ids.tokenManager })).status, 404);
});

test('customer overview bounds sections, isolates customers and pages recorded events on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Customer 360 fixture')).lastInsertRowid;
  const projectIds = [];
  for (let i = 0; i < 27; i++) projectIds.push((await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run(`Customer project ${i}`, customer, ids.manager)).lastInsertRowid);
  const foreign = (await db.prepare('INSERT INTO projects (title,customer_id,created_by) VALUES (?,?,?)').run('Foreign customer project', ids.customer, ids.manager)).lastInsertRowid;
  for (const project of [projectIds[0], foreign]) await db.prepare('INSERT INTO tasks (title,project_id,created_by) VALUES (?,?,?)').run(`Customer task ${project}`, project, ids.manager);
  await db.prepare('INSERT INTO attachments (project_id,original_name,stored_name,uploaded_by) VALUES (?,?,?,?)').run(projectIds[0], 'Customer document.pdf', 'private-storage-name', ids.manager);
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,scheduled_date,created_by,report_sent,report_sent_at) VALUES (?,?,?,?,?,?)').run('Customer visit', customer, '2026-09-18', ids.manager, 1, '2026-09-18 10:00:00')).lastInsertRowid;
  await db.prepare('INSERT INTO project_activity (project_id,user_id,action,detail) VALUES (?,?,?,?)').run(projectIds[0], ids.manager, 'closure_requested', 'Recorded review');
  const response = await api(`/api/customers/${customer}/overview`, { token: ids.tokenManager });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.counts, { projects: 27, tasks: 1, visits: 1, documents: 1, assets: 0 });
  assert.equal(response.data.projects.length, 25);
  assert.equal(response.data.projects.some(row => row.id === foreign), false);
  assert.equal(response.data.documents[0].stored_name, undefined);
  assert.equal(JSON.stringify(response.data).includes('private-storage-name'), false);
  assert.equal(response.data.total, 32);
  const second = await api(`/api/customers/${customer}/overview?page=2`, { token: ids.tokenManager });
  const events = [...response.data.timeline, ...second.data.timeline];
  assert.equal(events.length, 32);
  assert.equal(new Set(events.map(row => `${row.kind}:${row.entity_id}`)).size, 32);
  assert.ok(events.some(row => row.kind === 'visit_report' && row.entity_id === visit && row.event_at === '2026-09-18 10:00:00'));
  assert.ok(events.some(row => row.kind === 'project_event' && row.action === 'closure_requested'));
});

test('maintenance list and export reject malformed filters consistently', async () => {
  for (const query of ['month=', 'month=2026-13', 'month=1899-12', 'month=2026-01&month=2026-02', 'engineer_id=0', 'engineer_id=1.5', 'customer_id=9007199254740992', 'customer_id[x]=1', 'pending_report=true', 'review_pending=', 'not_completed=2', 'overview=1&overview=0', 'filter=unknown', 'filter=all&filter=past', 'as_of=2026-02-29', 'search[x]=bad', `search=${'x'.repeat(501)}`]) {
    for (const route of ['maintenance-visits', 'maintenance-visits/export']) {
      assert.equal((await api(`/api/${route}?${query}`, { token: ids.tokenManager })).status, 400, `${route}: ${query}`);
    }
  }
  for (const token of [ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api('/api/maintenance-visits/export', { token })).status, 403);
    assert.equal((await api(`/api/maintenance-visits/export?token=${signJwt({ id: token === ids.tokenEnabled ? ids.engineerEnabled : ids.engineerDisabled, download: true })}`)).status, 403);
  }
});

test('maintenance workbook and list share filters, literal decrypted search and assignment scope on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const previousKey = process.env.CUSTOMER_FIELD_KEY;
  process.env.CUSTOMER_FIELD_KEY = 'a'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.CUSTOMER_FIELD_KEY;
    else process.env.CUSTOMER_FIELD_KEY = previousKey;
  });
  const { encrypt, isEncrypted } = require('../fieldCipher');
  const encryptedName = encrypt('Filter customer %_\\');
  assert.equal(isEncrypted(encryptedName), true);
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run(encryptedName)).lastInsertRowid;
  const fixture = [];
  for (const [status, date, sent, forwarded, owner] of [
    ['scheduled', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['scheduled', '2043-12-30', 0, 0, ids.engineerEnabled],
    ['completed', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['in_progress', '2043-12-31', 1, 0, ids.engineerEnabled],
    ['completed', '2043-12-31', 1, 1, ids.engineerEnabled],
    ['cancelled', '2043-12-31', 0, 0, ids.engineerEnabled],
    ['completed', '2044-01-01', 0, 0, ids.engineerDisabled],
  ]) {
    const title = `Visit export fixture ${fixture.length}`;
    const id = (await db.prepare('INSERT INTO maintenance_visits (title,customer_id,status,scheduled_date,report_sent,report_sent_to_customer,created_by) VALUES (?,?,?,?,?,?,?)')
      .run(title, customer, status, date, sent, forwarded, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(id, owner);
    fixture.push({ id, title });
  }
  const planner = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)')
    .run('Export planner', 'export-planner@test.local', bcrypt.hashSync('pw', 4), 'planner')).lastInsertRowid;
  for (const extra of ['filter=all', 'filter=upcoming', 'filter=past', 'filter=report_pending', 'filter=awaiting_review', 'filter=cancelled', 'month=2043-12', 'month=2044-01', 'pending_report=0', 'pending_report=1', 'review_pending=1', 'not_completed=1', `engineer_id=${ids.engineerDisabled}&pending_report=1`, 'search=%25_', 'search=no-match', 'search=Visit%20export%20fixture%202']) {
    const query = `customer_id=${customer}&as_of=2043-12-31&${extra}`;
    for (const user of [ids.manager, planner]) {
      const list = await api(`/api/maintenance-visits?${query}`, { token: signJwt({ id: user }) });
      assert.equal(list.status, 200);
      const response = await fetch(`${baseUrl}/api/maintenance-visits/export?${query}&token=${signJwt({ id: user, download: true })}`);
      assert.equal(response.status, 200);
      const workbook = new (require('exceljs').Workbook)();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const titles = [];
      workbook.worksheets[0].eachRow((row, index) => { if (index > 1) { titles.push(row.getCell(1).value); assert.equal(row.getCell(2).value, 'Filter customer %_\\'); } });
      assert.deepEqual(titles, list.data.map(row => row.title), extra);
    }
  }
  const read = async extra => (await api(`/api/maintenance-visits?customer_id=${customer}&as_of=2043-12-31&${extra}`, { token: ids.tokenManager })).data.map(row => row.id);
  assert.deepEqual(await read('filter=upcoming'), [fixture[0].id]);
  assert.deepEqual(await read('filter=report_pending'), [fixture[2].id, fixture[6].id]);
  assert.deepEqual(await read('filter=awaiting_review'), [fixture[3].id]);
  assert.equal((await read('pending_report=0&review_pending=0&not_completed=0&overview=0')).length, 7);
  assert.equal((await read('search=%25_')).length, 7, 'encrypted customer search treats wildcards literally');
  const own = await api(`/api/maintenance-visits?customer_id=${customer}&engineer_id=${ids.engineerDisabled}&pending_report=1`, { token: ids.tokenEnabled });
  assert.deepEqual(own.data.map(row => row.id), [fixture[2].id], 'engineer filter cannot replace ownership');
});

test('task list and export consistently reject malformed filters', async () => {
  for (const query of ['filter=unknown', 'filter=', 'filter=open&filter=done', 'project_id=abc', 'assigned_to=0', 'priority=urgent', 'search[x]=bad', 'as_of=2035-02-29', 'as_of=', 'adhoc=true', 'sort=__proto__', 'direction=DROP', 'page=0', 'page=-1', 'page=1.5', 'page=1&page=2', 'page_size=101', 'page_size=', 'page=9007199254740991&page_size=100', `search=${'a'.repeat(501)}`]) {
    for (const route of ['tasks', 'tasks/export']) assert.equal((await api(`/api/${route}?${query}`, { token: ids.tokenManager })).status, 400);
  }
});

test('project detail and timeline reject malformed IDs before querying', async () => {
  for (const id of ['invalid', '0', '-1', '1.2', '9007199254740992']) {
    for (const suffix of ['', '/activity']) assert.equal((await api(`/api/projects/${id}${suffix}`, { token: ids.tokenManager })).status, 400);
  }
  assert.equal((await api('/api/projects/99999999', { token: ids.tokenManager })).status, 404);
});

test('task relationships protect dependency details, mentions and comment deletion after reassignment', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title,assigned_to,created_by) VALUES (?,?,?)').run('Task relationship privacy fixture', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const hidden = (await db.prepare('INSERT INTO tasks (title,assigned_to,deadline,created_by) VALUES (?,?,?,?)').run('Confidential other task', ids.engineerDisabled, '2036-06-17', ids.manager)).lastInsertRowid;
  const path = `/api/tasks/${task}`;
  assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: hidden } })).status, 200);
  const deps = await api(`${path}/dependencies`, { token: ids.tokenEnabled });
  assert.equal(deps.status, 200);
  assert.deepEqual(deps.data, [{ id: hidden, title: 'Restricted task', restricted: true, is_blocking: true }]);
  const management = await api(`${path}/dependencies`, { token: ids.tokenManager });
  assert.equal(management.data[0].title, 'Confidential other task');
  assert.equal(management.data[0].deadline, '2036-06-17');
  await db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(hidden);
  assert.equal((await api(`${path}/dependencies`, { token: ids.tokenEnabled })).data[0].is_blocking, false);
  assert.equal((await api(`/api/tasks/${hidden}/dependencies`, { token: ids.tokenEnabled })).status, 403);
  const tokens = [];
  for (const [role, name] of [['planner', 'GuardPlanner'], ['pm', 'GuardPM']]) {
    const id = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(name, `${name}@test.local`, 'not-used', role)).lastInsertRowid;
    tokens.push(signJwt({ id }));
  }
  const comment = await api(`${path}/comments`, { method: 'POST', token: ids.tokenManager, body: { message: '@EngineerEnabled @EngineerDisabled @GuardPlanner @GuardPM confidential handover' } });
  assert.equal(comment.status, 200);
  const recipients = await db.prepare("SELECT user_id,link FROM notifications WHERE type='mention' AND body LIKE ?").all('%Task relationship privacy fixture%');
  assert.deepEqual(recipients, [{ user_id: ids.engineerEnabled, link: '/tasks' }]);
  assert.equal((await api(`${path}/comments/${comment.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403);
  const ownComment = await api(`${path}/comments`, { method: 'POST', token: ids.tokenEnabled, body: { message: 'My comment before reassignment' } });
  assert.equal(ownComment.status, 200);
  await db.prepare('UPDATE tasks SET assigned_to=? WHERE id=?').run(ids.engineerDisabled, task);
  assert.equal((await api(`${path}/comments/${ownComment.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403);
  assert.ok(await db.prepare('SELECT id FROM task_comments WHERE id=?').get(ownComment.data.id));
  assert.equal((await api(`${path}/comments/${ownComment.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  for (const token of tokens) {
    for (const route of ['comments', 'dependencies']) assert.equal((await api(`${path}/${route}`, { token })).status, 403);
    assert.equal((await api(`${path}/comments/${comment.data.id}`, { method: 'DELETE', token })).status, 403);
  }
  for (const id of ['invalid', '0', '-1', '1.2', '9007199254740992']) {
    assert.equal((await api(`/api/tasks/${id}/comments`, { token: ids.tokenManager })).status, 400);
    assert.equal((await api(`/api/tasks/${id}/dependencies`, { token: ids.tokenManager })).status, 400);
    assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: id } })).status, 400);
  }
  assert.equal((await api(`${path}/comments/invalid`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`${path}/dependencies/invalid`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`${path}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: 99999999 } })).status, 404);
  assert.equal((await api(`/api/tasks/99999999/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: task } })).status, 404);
  assert.equal((await api(`/api/tasks/${hidden}/dependencies`, { method: 'POST', token: ids.tokenManager, body: { depends_on_id: task } })).status, 400, 'cycle guard remains effective');
});

test('calendar validates real month boundaries and matches module role visibility', async () => {
  const mkUser = async role => (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run(`Calendar ${role}`, `calendar-${role}@test.local`, 'not-used', role)).lastInsertRowid;
  const planner = await mkUser('planner');
  const pm = await mkUser('pm');
  const project = (await db.prepare('INSERT INTO projects (title, deadline, created_by) VALUES (?,?,?)').run('Calendar unassigned project', '2038-12-31', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title, deadline, assigned_to, created_by) VALUES (?,?,?,?)').run('Calendar own task', '2038-12-31', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const hiddenTask = (await db.prepare('INSERT INTO tasks (title, deadline, assigned_to, created_by) VALUES (?,?,?,?)').run('Calendar legacy PM task', '2038-12-30', pm, ids.manager)).lastInsertRowid;
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id,title,scheduled_date,created_by) VALUES (?,?,?,?)').run(ids.customer, 'Calendar visit', '2038-12-31', ids.manager)).lastInsertRowid;
  const next = (await db.prepare('INSERT INTO projects (title,deadline,created_by) VALUES (?,?,?)').run('Next year boundary', '2039-01-01', ids.manager)).lastInsertRowid;
  const get = token => api('/api/calendar?month=2038-12', { token });
  const own = await get(ids.tokenEnabled);
  assert.equal(own.status, 200);
  assert.ok(own.data.tasks.some(row => row.id === task));
  assert.ok(!own.data.tasks.some(row => row.id === hiddenTask));
  assert.ok(!own.data.projects.some(row => row.id === project));
  assert.ok(!own.data.visits.some(row => row.id === visit));
  const planning = await get(signJwt({ id: planner }));
  assert.deepEqual(planning.data.tasks, []);
  assert.deepEqual(planning.data.projects, []);
  assert.ok(planning.data.visits.some(row => row.id === visit));
  const readOnly = await get(signJwt({ id: pm }));
  assert.deepEqual(readOnly.data.tasks, []);
  assert.ok(readOnly.data.projects.some(row => row.id === project));
  assert.ok(readOnly.data.visits.some(row => row.id === visit));
  assert.equal((await api(`/api/maintenance-visits/${visit}/report-sent`, { method: 'POST', token: signJwt({ id: pm }) })).status, 403);
  const management = await get(ids.tokenManager);
  assert.ok(management.data.projects.some(row => row.id === project));
  assert.ok(!management.data.projects.some(row => row.id === next));
  await db.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(project, ids.engineerEnabled);
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit, ids.engineerEnabled);
  const assigned = await get(ids.tokenEnabled);
  assert.ok(assigned.data.projects.some(row => row.id === project));
  assert.ok(assigned.data.visits.some(row => row.id === visit));
  for (const query of ['', 'month=2038-00', 'month=2038-13', 'month=1899-12', 'month=9999-01', 'month=2038-1', 'month=2038-12&month=2039-01', 'month[x]=2038-12']) {
    assert.equal((await api(`/api/calendar?${query}`, { token: ids.tokenManager })).status, 400);
  }
});

test('calendar follow-ups honor ownership, feature enablement and linked task completion', async () => {
  const resolved = (await db.prepare("INSERT INTO tasks (title,status,created_by) VALUES (?,'completed',?)").run('Calendar resolved follow-up', ids.manager)).lastInsertRowid;
  const rows = [];
  for (const [label, owner, status, task, date] of [
    ['Pending completed activity', ids.engineerEnabled, 'completed', null, '2040-02-29'],
    ['Resolved linked task', ids.engineerEnabled, 'completed', resolved, '2040-02-29'],
    ['Cancelled activity', ids.engineerEnabled, 'cancelled', null, '2040-02-29'],
    ['Other owner', ids.engineerDisabled, 'completed', null, '2040-02-29'],
    ['Next month', ids.engineerEnabled, 'completed', null, '2040-03-01'],
  ]) {
    rows.push((await db.prepare(`INSERT INTO service_activities
      (activity_reference,customer_id,team_id,engineer_id,activity_date,category_id,title,status,follow_up_required,follow_up_date,follow_up_task_id,created_by)
      VALUES (?,?,?,?,?,?,?, ?,1,?,?,?)`).run(`ACT-2040-${900000 + rows.length}`, ids.customer, ids.teamEnabled, owner, '2039-01-01', ids.category, label, status, date, task, owner)).lastInsertRowid);
  }
  const path = `/api/calendar?month=2040-02&engineer_id=${ids.engineerDisabled}`;
  const own = await api(path, { token: ids.tokenEnabled });
  assert.equal(own.status, 200);
  assert.equal(own.data.service_enabled, true);
  assert.deepEqual(own.data.followUps.map(row => row.id), [rows[0]]);
  assert.equal(own.data.followUps[0].date, '2040-02-29');
  assert.equal(own.data.followUps[0].reference, 'ACT-2040-900000');
  const disabled = await api(path, { token: ids.tokenDisabled });
  assert.equal(disabled.data.service_enabled, false);
  assert.deepEqual(disabled.data.followUps, []);
  const management = await api(path, { token: ids.tokenManager });
  assert.deepEqual(management.data.followUps.map(row => row.id), [rows[0], rows[3]]);
  const pm = (await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Follow-up PM', 'follow-up-pm@test.local', 'not-used', 'pm')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id,user_id) VALUES (?,?)').run(ids.teamEnabled, pm);
  await db.prepare('UPDATE service_activities SET engineer_id=? WHERE id=?').run(pm, rows[3]);
  const pmData = await api(path, { token: signJwt({ id: pm }) });
  assert.equal(pmData.data.service_enabled, true);
  assert.deepEqual(pmData.data.followUps.map(row => row.id), [rows[3]]);
});

test('calendar pending reports use scoped visit dates and exclude scheduled or sent reports', async () => {
  const pending = [];
  for (const [status, report, owner] of [['completed', 0, ids.engineerEnabled], ['in_progress', 0, ids.engineerEnabled], ['scheduled', 0, ids.engineerEnabled], ['completed', 1, ids.engineerEnabled], ['cancelled', 0, ids.engineerEnabled], ['completed', 0, ids.engineerDisabled]]) {
    const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id,title,scheduled_date,status,report_sent,created_by) VALUES (?,?,?,?,?,?)').run(ids.customer, 'Calendar report fixture', '2041-03-02', status, report, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id,user_id) VALUES (?,?)').run(visit, owner);
    if (owner === ids.engineerEnabled && !report && ['completed', 'in_progress'].includes(status)) pending.push(visit);
  }
  const response = await api('/api/calendar?month=2041-03', { token: ids.tokenEnabled });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.reports.map(row => row.id), pending);
  assert.ok(response.data.reports.every(row => row.type === 'report' && row.date === '2041-03-02' && row.engineer_names === 'Engineer Enabled'));
});

test('ordinary project edits cannot bypass closure requests or reviews', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Protected closure', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const edit = body => api(path, { method: 'PUT', token: ids.tokenManager, body });
  assert.equal((await edit({ status: 'pending_approval' })).data.code, 'CLOSURE_REVIEW_REQUIRED');
  assert.equal((await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
  for (const status of ['closed', 'reopened', 'in_progress', 'cancelled']) {
    const result = await edit({ status });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'CLOSURE_REVIEW_REQUIRED');
  }
  assert.equal((await edit({ title: 'Metadata remains editable', status: 'pending_approval' })).status, 200);
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.title, 'Metadata remains editable');
  assert.equal(stored.closure_decision, null);
  assert.equal(stored.closure_requested_by, ids.manager);
});

test('an edit started before a closure request cannot overwrite its state', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Concurrent metadata edit', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const originalPrepare = db.prepare;
  let release, read;
  const gate = new Promise(resolve => { release = resolve; });
  const snapshotRead = new Promise(resolve => { read = resolve; });
  let held = false;
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql);
    if (sql !== 'SELECT * FROM projects WHERE id = ?') return statement;
    return { ...statement, get: async (...args) => {
      const snapshot = await statement.get(...args);
      if (!held && Number(args[0]) === project) {
        held = true;
        read();
        await gate;
      }
      return snapshot;
    } };
  };
  let pending;
  try {
    pending = api(path, { method: 'PUT', token: ids.tokenManager, body: { title: 'Stale edit', status: 'in_progress' } });
    await snapshotRead;
    assert.equal((await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
    release();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'PROJECT_CONFLICT');
  } finally {
    release();
    if (pending) await pending;
    db.prepare = originalPrepare;
  }
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.title, 'Concurrent metadata edit');
  assert.equal(stored.closure_request_version, 1);
});

test('project closure rejection records a complete decision and protects newer requests', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Closure revision flow', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(request.status, 200);
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.closure_requested_by, ids.engineerEnabled);
  assert.equal(stored.closure_request_version, request.data.request_version);
  for (const comment of ['', '   ', {}, 'x'.repeat(2001)]) {
    assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment } })).status, 400);
  }
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenEnabled, body: { comment: 'Unauthorized' } })).status, 403);
  const rejection = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Finish the handover documents', request_version: stored.closure_request_version } });
  assert.equal(rejection.status, 200);
  const rejected = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(rejected.status, 'reopened');
  assert.equal(rejected.closure_reviewed_by, ids.manager);
  assert.equal(rejected.closure_decision, 'rejected');
  assert.equal(rejected.closure_review_comment, 'Finish the handover documents');
  assert.ok(rejected.closure_reviewed_at);
  assert.equal(rejected.closed_at, null);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM project_activity WHERE project_id=? AND action='closure_rejected'").get(project)).n), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND entity_type='project' AND action='closure_rejected'").get(project)).n), 1);
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Repeat' } })).status, 409);
  const notification = await db.prepare("SELECT body FROM notifications WHERE user_id=? AND type='project.closure_rejected' AND link=?").get(ids.engineerEnabled, path.replace('/api', ''));
  assert.match(notification.body, /handover documents/);
  const second = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(second.data.request_version, stored.closure_request_version + 1);
  assert.equal((await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: stored.closure_request_version } })).status, 409);
  const approved = await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: second.data.request_version, comment: 'Handover reviewed' } });
  assert.equal(approved.status, 200);
  const detail = await api(path, { token: ids.tokenEnabled });
  assert.equal(detail.data.closure_requested_by_name, 'Engineer Enabled');
  assert.equal(detail.data.closure_reviewed_by_name, 'Manager One');
  assert.equal(detail.data.status, 'closed');
  assert.equal(detail.data.closure_decision, 'approved');
  assert.equal(detail.data.closure_review_comment, 'Handover reviewed');
  assert.equal(detail.data.updates.length, 4);
});

test('approval backlog and review endpoints are management-only with validated inputs', async () => {
  for (const token of [ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
  }
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(`Approval ${role}`, `approval-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
    assert.equal((await api(`/api/projects/1/reject-closure`, { method: 'POST', token, body: { comment: 'Denied' } })).status, 403);
  }
  for (const query of ['page=0', 'page=1x', 'page_size=101', 'page=9007199254740991', 'page=1&page=2']) {
    assert.equal((await api(`/api/projects/approvals?${query}`, { token: ids.tokenManager })).status, 400);
  }
  const project = (await db.prepare("INSERT INTO projects (title, status, created_by) VALUES (?, 'pending_approval', ?)").run('Legacy approval request', ids.manager)).lastInsertRowid;
  const backlog = await api('/api/projects/approvals?page_size=1', { token: ids.tokenManager });
  assert.equal(backlog.status, 200);
  assert.ok(backlog.data.total >= 1);
  assert.equal(backlog.data.rows.length, 1);
  for (const review of [{ request_version: '0' }, { comment: {} }]) {
    assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: review })).status, 400);
  }
  assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200, 'existing clients may still approve without a version');
});

test('concurrent approval and rejection write exactly one decision on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Opposing closure decisions', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const body = { request_version: request.data.request_version, comment: 'Review decision' };
  const results = await Promise.all(['approve-closure', 'reject-closure'].map(action => api(`${path}/${action}`, { method: 'POST', token: ids.tokenManager, body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM project_status_updates WHERE project_id=?').get(project)).n), 2);
  const stored = await db.prepare('SELECT status, closure_decision FROM projects WHERE id=?').get(project);
  assert.ok((stored.status === 'closed' && stored.closure_decision === 'approved') || (stored.status === 'reopened' && stored.closure_decision === 'rejected'));
});


test('closure review rolls back when its history cannot be recorded on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Closure history rollback', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const originalTransaction = db.transaction;
  try {
    db.transaction = callback => originalTransaction(tx => callback({ ...tx, prepare(sql) {
      if (sql.startsWith('INSERT INTO project_status_updates')) throw new Error('Simulated review history failure');
      return tx.prepare(sql);
    } }));
    const response = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Review must persist', request_version: request.data.request_version } });
    assert.equal(response.status, 500);
  } finally { db.transaction = originalTransaction; }
  const stored = await db.prepare('SELECT status, closure_decision, closure_reviewed_by FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.closure_decision, null);
  assert.equal(stored.closure_reviewed_by, null);
});


test('operational overview scopes work and aggregates more than one activity page', async () => {
  const engineer = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Overview Engineer', 'overview-engineer@test.local', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, engineer);
  const token = signJwt({ id: engineer });
  const ownProject = (await db.prepare('INSERT INTO projects (title, deadline, updated_at, created_by) VALUES (?, ?, ?, ?)').run('Overview own project', '2026-09-18', '2026-09-01 00:00:00', ids.manager)).lastInsertRowid;
  const privateProject = (await db.prepare('INSERT INTO projects (title, deadline, created_by) VALUES (?, ?, ?)').run('Overview private project', '2026-09-15', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(ownProject, engineer);
  for (const [title, assigned, deadline] of [['Own overdue', engineer, '2026-09-16'], ['Own today', engineer, '2026-09-17'], ['Private overdue', ids.engineerEnabled, '2026-09-01']]) {
    await db.prepare('INSERT INTO tasks (title, assigned_to, deadline, created_by) VALUES (?, ?, ?, ?)').run(title, assigned, deadline, ids.manager);
  }
  const resolved = (await db.prepare("INSERT INTO tasks (title, status, assigned_to, created_by) VALUES (?, 'completed', ?, ?)").run('Resolved follow-up', engineer, ids.manager)).lastInsertRowid;
  for (const [title, assigned, status, date] of [['Own report', engineer, 'completed', '2026-09-16'], ['Own upcoming', engineer, 'scheduled', '2026-09-20'], ['Private report', ids.engineerEnabled, 'completed', '2026-09-15']]) {
    const visit = (await db.prepare('INSERT INTO maintenance_visits (title, customer_id, status, scheduled_date, created_by) VALUES (?, ?, ?, ?, ?)').run(title, ids.customer, status, date, ids.manager)).lastInsertRowid;
    await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, assigned);
  }
  await db.transaction(async tx => {
    for (let i = 0; i < 102; i++) await tx.prepare(`INSERT INTO service_activities
      (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, duration_minutes,
       status, follow_up_required, follow_up_date, follow_up_task_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`ACT-2026-${800000 + i}`, ids.customer, ids.teamEnabled, engineer, i === 101 ? '2026-08-01' : '2026-09-17', ids.category,
        `Overview activity ${i}`, 60, i === 3 ? 'cancelled' : 'completed', i < 4 || i === 101 ? 1 : 0,
        i === 2 ? '2026-09-18' : '2026-09-16', i === 1 ? resolved : null, engineer);
  });
  const result = await api(`/api/operations/overview?as_of=2026-09-17&engineer_id=${ids.engineerEnabled}&team_id=${ids.teamDisabled}`, { token });
  assert.equal(result.status, 200);
  const overview = result.data;
  assert.equal(overview.scope, 'personal');
  assert.equal(overview.tasks.open, 2);
  assert.equal(overview.tasks.overdue, 1);
  assert.equal(overview.tasks.due_today, 1);
  assert.ok(overview.tasks.attention.every(task => !task.title.includes('Private')));
  assert.equal(overview.projects.active, 1);
  assert.equal(overview.projects.stale, 1);
  assert.ok(overview.projects.commitments.every(project => project.id === ownProject));
  assert.equal(overview.visits.reports_pending, 1);
  assert.equal(overview.visits.upcoming, 1);
  assert.deepEqual(overview.visits.reports.map(visit => visit.title), ['Own report']);
  assert.equal(overview.service.enabled, true);
  assert.equal(overview.service.today, 101);
  assert.equal(overview.service.week, 101);
  assert.equal(overview.service.hours, 101);
  assert.equal(overview.service.customers, 1);
  assert.equal(overview.service.pending, 3, 'completed activities may still need follow-up; completed tasks and cancelled activities do not');
  assert.equal(overview.service.due, 2, 'include due follow-ups from outside the current week');
  assert.equal(overview.service.follow_ups.length, 2);
  assert.equal(overview.service.recent.length, 5);
  assert.equal(overview.week_from, '2026-09-14');
  assert.equal(overview.week_to, '2026-09-20');
  for (const section of [overview.tasks.attention, overview.projects.commitments, overview.visits.reports, overview.visits.upcoming_items, overview.service.follow_ups]) assert.ok(section.length <= 5);
  const management = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenManager });
  assert.equal(management.status, 200);
  assert.equal(management.data.scope, 'management');
  assert.ok(management.data.projects.active > overview.projects.active);
  assert.ok(management.data.tasks.overdue > overview.tasks.overdue);
});

test('operational overview validates dates, honors disabled teams and rejects unauthorized roles', async () => {
  assert.equal((await api('/api/operations/overview')).status, 401);
  for (const asOf of ['bad', '2026-02-30', '2026-13-01', '1800-01-01', '9999-01-01', '2026-09-17&as_of=2026-09-18']) {
    assert.equal((await api(`/api/operations/overview?as_of=${asOf}`, { token: ids.tokenManager })).status, 400);
  }
  const disabled = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
  assert.equal(disabled.status, 200);
  assert.deepEqual(disabled.data.service, { enabled: false });
  for (const role of ['planner', 'pm']) {
    const user = await db.prepare('SELECT id FROM users WHERE email=?').get(`approval-${role}@test.local`);
    assert.equal((await api('/api/operations/overview', { token: signJwt({ id: user.id }) })).status, 403);
  }
  const boundary = await api('/api/operations/overview?as_of=2027-01-01', { token: ids.tokenDisabled });
  assert.equal(boundary.status, 200);
  assert.equal(boundary.data.week_from, '2026-12-28');
  assert.equal(boundary.data.week_to, '2027-01-03');
});


test('operational priorities honor configured terminal task statuses', async () => {
  const before = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
  const setting = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  const config = JSON.parse(setting.value);
  config.task.push({ value: 'overview_archived', label: 'Archived', is_terminal: true });
  const task = (await db.prepare('INSERT INTO tasks (title, status, assigned_to, deadline, created_by) VALUES (?, ?, ?, ?, ?)').run('Archived operational work', 'overview_archived', ids.engineerDisabled, '2026-09-01', ids.manager)).lastInsertRowid;
  try {
    await db.prepare("UPDATE settings SET value=? WHERE key='status_config'").run(JSON.stringify(config));
    const after = await api('/api/operations/overview?as_of=2026-09-17', { token: ids.tokenDisabled });
    assert.equal(after.status, 200);
    assert.equal(after.data.tasks.open, before.data.tasks.open);
    assert.equal(after.data.tasks.overdue, before.data.tasks.overdue);
    assert.ok(after.data.tasks.attention.every(item => item.id !== task));
    const calendar = await api('/api/calendar?month=2026-09', { token: ids.tokenDisabled });
    assert.equal(calendar.status, 200);
    assert.ok(calendar.data.tasks.every(item => item.id !== task), 'calendar excludes configured terminal tasks');
  } finally { await db.prepare("UPDATE settings SET value=? WHERE key='status_config'").run(setting.value); }
});
