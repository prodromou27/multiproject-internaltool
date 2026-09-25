const { test, assert, api, db, ids, createActivity, bcrypt, signJwt,  } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');

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
  const exportResponse=await fetch(`${suiteFixture.baseUrl}${base}/export?search=gw01`,{ headers:{ Authorization:`Bearer ${ids.tokenManager}` } });
  assert.equal(exportResponse.status,200);
  const ExcelJS=require('exceljs'),exportBook=new ExcelJS.Workbook();await exportBook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  assert.equal(exportBook.worksheets[0].getRow(2).getCell(1).value,'Primary Gateway');
  const importBook=new ExcelJS.Workbook(),importSheet=importBook.addWorksheet('Assets');
  importSheet.addRow(['name*','asset_type*','asset_tag','technology','hostname','ip_address','coverage_type']);
  importSheet.addRow(['Imported host','Server','IMPORT-1','Firewall','imported.example.local','2001:db8::1','support']);
  const form=new FormData();form.append('file',new Blob([await importBook.xlsx.writeBuffer()],{ type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),'assets.xlsx');
  const importedResponse=await fetch(`${suiteFixture.baseUrl}${base}/import`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'X-SolutionsHub-Request':'1' },body:form });
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
    return fetch(`${suiteFixture.baseUrl}${filesPath}`,{ method:'POST',headers:{ Authorization:`Bearer ${token}`,'X-SolutionsHub-Request':'1' },body:form });
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
    const download=await fetch(`${suiteFixture.baseUrl}${filesPath}/${result.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenManager}` } });
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
    return fetch(`${suiteFixture.baseUrl}${path}`,{ method:'POST',headers:{ Authorization:`Bearer ${token}`,'X-SolutionsHub-Request':'1' },body:form });
  };
  assert.equal((await sendFile(ids.tokenPm)).status,403);
  const uploaded=await sendFile(ids.tokenManager);assert.equal(uploaded.status,201);const attachment=await uploaded.json();
  const list=await api(path,{ token:ids.tokenPlanner });
  assert.equal(list.status,200);assert.equal(list.data.length,1);assert.equal(list.data[0].stored_name,undefined);assert.equal(list.data[0].enc_iv,undefined);
  assert.equal((await api(`${path}/download/${attachment.id}`,{ token:ids.tokenDisabled })).status,403);
  const pmDownload=await fetch(`${suiteFixture.baseUrl}${path}/download/${attachment.id}`,{ headers:{ Authorization:`Bearer ${ids.tokenPm}` } });
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

test('managed-services team engineers can list and add assets for customers their team serves, and nothing else', async () => {
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Managed assets fixture')).lastInsertRowid;
  const path = `/api/customers/${customer}/assets`;
  const body = { name: 'Edge firewall', asset_type: 'Firewall', environment: 'production', criticality: 'high', lifecycle_status: 'active', coverage_type: 'managed' };
  const setCapability = value => db.prepare('UPDATE teams SET managed_service_operations=? WHERE id=?').run(value, ids.teamEnabled);
  try {
    await setCapability(1);
    // The team isn't assigned to this customer yet: no access to its assets.
    assert.equal((await api(path, { token: ids.tokenEnabled })).status, 403);
    await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customer, ids.teamEnabled);
    const added = await api(path, { method: 'POST', token: ids.tokenEnabled, body });
    assert.equal(added.status, 201);
    const listed = await api(path, { token: ids.tokenEnabled });
    assert.equal(listed.status, 200);
    assert.ok(listed.data.rows.some(row => row.id === added.data.id));
    const assetPath = `${path}/${added.data.id}`;
    // Adding is all they get: no edit, delete, import/export or files.
    assert.equal((await api(assetPath, { method: 'PUT', token: ids.tokenEnabled, body: { ...body, name: 'Renamed', version: 1 } })).status, 403);
    assert.equal((await api(assetPath, { method: 'DELETE', token: ids.tokenEnabled, body: { version: 1 } })).status, 403);
    assert.equal((await api(`${path}/export`, { token: ids.tokenEnabled })).status, 403);
    assert.equal((await api(`${path}/${added.data.id}/attachments`, { token: ids.tokenEnabled })).status, 403);
    // The Customer 360 summary tells the page which asset access this viewer has.
    assert.equal((await api(`/api/customers/${customer}/operations/summary`, { token: ids.tokenEnabled })).data.assets_access, 'team');
    assert.equal((await api(`/api/customers/${customer}/operations/summary`, { token: ids.tokenManager })).data.assets_access, 'full');
    // Other teams and other customers are refused.
    assert.equal((await api(path, { token: ids.tokenDisabled })).status, 403);
    assert.equal((await api(`/api/customers/${ids.customerUnassigned}/assets`, { token: ids.tokenEnabled })).status, 403);
    // Without the managed-services capability the same team member has no asset access.
    await setCapability(0);
    assert.equal((await api(path, { token: ids.tokenEnabled })).status, 403);
    // Managers keep full control throughout.
    assert.equal((await api(assetPath, { method: 'DELETE', token: ids.tokenManager, body: { version: 1 } })).status, 200);
  } finally { await setCapability(0); }
});

test('upgrade-style categories require naming the asset, and an optional version is recorded per asset', async () => {
  const category = (await db.prepare('INSERT INTO activity_categories (name, require_asset) VALUES (?, 1)').run('Upgrade fixture')).lastInsertRowid;
  const today = new Date().toISOString().slice(0, 10);
  const create = extra => api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: today, category_id: category, title: 'Firmware upgrade', status: 'planned', ...extra } });
  const asset = await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager,
    body: { name: 'Upgrade target', asset_tag: 'UPG-1', asset_type: 'Switch', environment: 'production', criticality: 'medium', lifecycle_status: 'active', coverage_type: 'managed' } });
  assert.equal(asset.status, 201);
  const other = await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager,
    body: { name: 'Not selected', asset_tag: 'UPG-2', asset_type: 'Switch', environment: 'production', criticality: 'medium', lifecycle_status: 'active', coverage_type: 'managed' } });

  const missing = await create({});
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /select the asset/);
  assert.equal((await create({ asset_ids: [asset.data.id], asset_versions: { [other.data.id]: '1.0' } })).status, 400); // version for an unselected asset
  assert.equal((await create({ asset_ids: [asset.data.id], asset_versions: { [asset.data.id]: 'x'.repeat(101) } })).status, 400);
  assert.equal((await create({ asset_ids: [asset.data.id], asset_versions: [] })).status, 400);

  const made = await create({ asset_ids: [asset.data.id], asset_versions: { [asset.data.id]: ' 12.4.1 ' } });
  assert.equal(made.status, 200);
  const detail = await api(`/api/service-activities/${made.data.id}`, { token: ids.tokenEnabled });
  assert.equal(detail.data.assets[0].version, '12.4.1'); // trimmed
  // The version is optional: an upgrade with the asset but no version is fine.
  const noVersion = await create({ asset_ids: [asset.data.id] });
  assert.equal(noVersion.status, 200);
  assert.equal((await api(`/api/service-activities/${noVersion.data.id}`, { token: ids.tokenEnabled })).data.assets[0].version, null);
  // Editing without resending versions keeps the recorded one; sending a new one replaces it.
  assert.equal((await api(`/api/service-activities/${made.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { asset_ids: [asset.data.id], version: detail.data.version } })).status, 200);
  const kept = await api(`/api/service-activities/${made.data.id}`, { token: ids.tokenEnabled });
  assert.equal(kept.data.assets[0].version, '12.4.1');
  assert.equal((await api(`/api/service-activities/${made.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { asset_ids: [asset.data.id], asset_versions: { [asset.data.id]: '12.5.0' }, version: kept.data.version } })).status, 200);
  assert.equal((await api(`/api/service-activities/${made.data.id}`, { token: ids.tokenEnabled })).data.assets[0].version, '12.5.0');

  // A customer with no assets yet isn't a dead end: the rule only bites when there is something to choose.
  const bare = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('No assets yet')).lastInsertRowid;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(bare, ids.teamEnabled);
  assert.equal((await create({ customer_id: bare })).status, 200);
});

test('a completed upgrade keeps the asset inventory version current, and never rolls it backwards', async () => {
  const { decrypt } = require('../fieldCipher');
  const category = (await db.prepare('INSERT INTO activity_categories (name, require_asset) VALUES (?, 1)').run('Upgrade sync fixture')).lastInsertRowid;
  const asset = await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager,
    body: { name: 'Sync target', asset_tag: 'SYNC-1', asset_type: 'Firewall', software_version: '1.0', environment: 'production', criticality: 'medium', lifecycle_status: 'active', coverage_type: 'managed' } });
  assert.equal(asset.status, 201);
  const inventory = async () => decrypt((await db.prepare('SELECT software_version FROM customer_assets WHERE id=?').get(asset.data.id)).software_version);
  const log = (date, status, version) => api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: date, category_id: category, title: 'Upgrade', status, asset_ids: [asset.data.id], asset_versions: { [asset.data.id]: version } } });
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  assert.equal((await log(day(0), 'planned', '2.0')).status, 200);
  assert.equal(await inventory(), '1.0', 'a planned upgrade does not change the inventory');
  assert.equal((await log(day(0), 'completed', '2.0')).status, 200);
  assert.equal(await inventory(), '2.0');
  assert.equal((await log(day(-30), 'completed', '1.5')).status, 200);
  assert.equal(await inventory(), '2.0', 'back-filling an older upgrade must not roll the inventory back');
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
