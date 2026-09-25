const { afterSeed, seedCustomerWork, test, assert, api, db, ids, bcrypt, signJwt,  } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');

afterSeed(seedCustomerWork);

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
  assert.equal(['healthy','attention','awaiting_sync','activity_only'].includes(list.data.rows.find(row => row.id===ids.customer).service_status),true);
  assert.equal((await api(`/api/managed-customers/${ids.customer}/overview?from=bad&to=2026-09-21`,{ token:ids.tokenManager })).status,400);
  const overview=await api(`/api/managed-customers/${ids.customer}/overview?from=2026-09-01&to=2026-09-30`,{ token:ids.tokenManager });
  assert.equal(overview.status,200);assert.equal(overview.data.customer.id,ids.customer);
  assert.equal(overview.data.tickets.open_now>=1,true);assert.equal(overview.data.tickets.created_period>=2,true);
  assert.equal(typeof overview.data.activities.hours,'number');assert.equal(overview.data.period.from,'2026-09-01');
});

test('my-managed-customers scopes to the requesting user\'s own team, not the full managed customer list',async () => {
  await db.prepare('UPDATE managed_customer_configurations SET responsible_team_id=? WHERE customer_id=?').run(ids.teamEnabled,ids.customer);
  const owned=await api('/api/operations/my-managed-customers',{ token:ids.tokenEnabled }); // engineerEnabled is on teamEnabled
  assert.equal(owned.status,200);
  assert.equal(owned.data.rows.some(row => row.id===ids.customer),true);
  const ownedRow=owned.data.rows.find(row => row.id===ids.customer);
  assert.equal(ownedRow.responsible_team,'Security Team');
  assert.equal(typeof ownedRow.open_tickets,'number');
  const unowned=await api('/api/operations/my-managed-customers',{ token:ids.tokenDisabled }); // engineerDisabled is on teamDisabled, not teamEnabled
  assert.equal(unowned.status,200);
  assert.equal(unowned.data.rows.some(row => row.id===ids.customer),false);
  const manager=await api('/api/operations/my-managed-customers',{ token:ids.tokenManager }); // not on any team at all
  assert.equal(manager.status,200);
  assert.deepEqual(manager.data.rows,[]);
  assert.equal((await api('/api/operations/my-managed-customers')).status,401);
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
  assert.equal(result.data.trend.bucket_days,1);assert.equal(result.data.trend.points.length,30);
  assert.equal(result.data.trend.points.reduce((sum,row) => sum+row.created,0),2);assert.equal(result.data.trend.points.reduce((sum,row) => sum+row.resolved,0),1);
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
  const path=`/api/managed-customers/${ids.customer}/report-preview`,body={ from:'2026-09-01',to:'2026-09-30',sections:['service_activities','executive_summary','ticket_summary'],narratives:{ executive_summary:'  Customer-facing summary  ',risks_concerns:'No material risks.' } };
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
  const documentResponse=await fetch(`${suiteFixture.baseUrl}${path.replace('report-preview','report.docx')}`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify(body) });
  assert.equal(documentResponse.status,200);assert.match(documentResponse.headers.get('content-type'),/wordprocessingml/);assert.match(documentResponse.headers.get('content-disposition'),/Acme_Corp_2026-09-01_2026-09-30\.docx/);
  const documentBuffer=Buffer.from(await documentResponse.arrayBuffer());assert.equal(documentBuffer.subarray(0,2).toString(),'PK');
  const archive=await require('jszip').loadAsync(documentBuffer),documentXml=await archive.file('word/document.xml').async('string');
  assert.match(documentXml,/Managed Services Report/);assert.match(documentXml,/Customer-facing summary/);assert.doesNotMatch(documentXml,/internal_notes/);
  assert.equal(documentXml.indexOf('Service Activities')<documentXml.indexOf('Executive Summary'),true);assert.equal(documentXml.indexOf('Executive Summary')<documentXml.indexOf('Ticket Summary'),true);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='managed_customer_word_report_generated'").get()).count,1);
  const workbookResponse=await fetch(`${suiteFixture.baseUrl}${path.replace('report-preview','report.xlsx')}`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify(body) });
  assert.equal(workbookResponse.status,200);assert.match(workbookResponse.headers.get('content-type'),/spreadsheetml/);
  const workbook=new (require('exceljs').Workbook)();await workbook.xlsx.load(Buffer.from(await workbookResponse.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name),['Summary','Charts','Activities']);assert.equal(workbook.getWorksheet('Summary').getCell('B2').value,'Acme Corp');assert.equal(workbook.getWorksheet('Charts').getCell('A1').value,'Ticket Throughput Trend');
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='managed_customer_excel_report_generated'").get()).count,1);
  assert.equal((await api(path.replace('report-preview','report.docx'),{ method:'POST',token:ids.tokenManager,body:{ ...body,status:'published' } })).status,400);
  assert.equal((await api(`/api/managed-customers/${ids.customer}/reports`,{ token:ids.tokenEnabled })).status,403);
  const history=await api(`/api/managed-customers/${ids.customer}/reports`,{ token:ids.tokenManager });
  assert.equal(history.status,200);assert.equal(history.data.rows.length,2);
  assert.deepEqual(history.data.rows.map(row => row.output_format).sort(),['docx','xlsx']);
  assert.equal(history.data.rows.every(row => row.report_version===1 && row.status==='draft'),true);
  assert.equal(history.data.rows.every(row => row.stored_name===undefined && row.enc_iv===undefined && row.enc_tag===undefined),true);
  const wordHistory=history.data.rows.find(row => row.output_format==='docx');
  const archived=await fetch(`${suiteFixture.baseUrl}/api/managed-customers/${ids.customer}/reports/${wordHistory.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenManager}`,'X-SolutionsHub-Request':'1' } });
  assert.equal(archived.status,200);assert.match(archived.headers.get('content-disposition'),/Acme_Corp_2026-09-01_2026-09-30\.docx/);
  assert.equal(Buffer.from(await archived.arrayBuffer()).subarray(0,2).toString(),'PK');
  const secondDocument=await fetch(`${suiteFixture.baseUrl}${path.replace('report-preview','report.docx')}`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify({ ...body,status:'draft' }) });
  assert.equal(secondDocument.status,200);assert.equal(secondDocument.headers.get('x-report-version'),'2');
  const updatedHistory=await api(`/api/managed-customers/${ids.customer}/reports`,{ token:ids.tokenManager });
  assert.equal(updatedHistory.data.rows[0].report_version,2);assert.equal(updatedHistory.data.rows[0].status,'draft');
  const pdfResponse=await fetch(`${suiteFixture.baseUrl}${path.replace('report-preview','report.pdf')}`,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify({ ...body,status:'draft' }) });
  assert.equal(pdfResponse.status,200);assert.match(pdfResponse.headers.get('content-type'),/application\/pdf/);assert.match(pdfResponse.headers.get('content-disposition'),/Acme_Corp_2026-09-01_2026-09-30\.pdf/);
  const pdfBuffer=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(pdfBuffer.subarray(0,5).toString(),'%PDF-');
  const pdfHistory=await api(`/api/managed-customers/${ids.customer}/reports`,{ token:ids.tokenManager });
  assert.equal(pdfHistory.data.rows[0].output_format,'pdf');assert.equal(pdfHistory.data.rows[0].report_version,1);assert.equal(pdfHistory.data.rows[0].status,'draft');
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='managed_customer_pdf_report_generated'").get()).count,1);
});

test('managed reports follow a conflict-safe reviewed workflow with an audit trail',async () => {
  const reports=(await api(`/api/managed-customers/${ids.customer}/reports`,{ token:ids.tokenManager })).data.rows;
  const report=reports.find(item => item.output_format==='pdf');assert.ok(report);assert.equal(report.workflow_version,1);
  const endpoint=`/api/managed-customers/${ids.customer}/reports/${report.id}/workflow`;
  assert.equal((await api(endpoint,{ method:'PUT',token:ids.tokenEnabled,body:{ action:'submit',version:1 } })).status,403);
  await db.prepare(`INSERT INTO user_permission_overrides (user_id,permission_key,allowed,updated_by) VALUES (?,'managed_reports.review',1,?)`).run(ids.planner,ids.manager);
  const submitted=await api(endpoint,{ method:'PUT',token:ids.tokenManager,body:{ action:'submit',version:1 } });
  assert.equal(submitted.status,200);assert.equal(submitted.data.report.status,'in_review');assert.equal(submitted.data.report.workflow_version,2);
  assert.equal((await api(endpoint,{ method:'PUT',token:ids.tokenManager,body:{ action:'submit',version:1 } })).status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND type='managed_report.submitted'").get(ids.planner)).count,1);
  assert.equal((await db.prepare("SELECT link FROM notifications WHERE user_id=? AND type='managed_report.submitted'").get(ids.planner)).link,'/approvals?view=reports');
  assert.equal((await api('/api/managed-customers/report-reviews',{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api('/api/managed-customers/report-reviews?status=bad',{ token:ids.tokenPlanner })).status,400);
  assert.equal((await api('/api/managed-customers/report-reviews?page=0',{ token:ids.tokenPlanner })).status,400);
  const reviewQueue=await api('/api/managed-customers/report-reviews',{ token:ids.tokenPlanner });
  assert.equal(reviewQueue.status,200);assert.equal(reviewQueue.data.total,1);assert.equal(reviewQueue.data.rows[0].id,report.id);
  assert.equal(reviewQueue.data.rows[0].customer_name,'Acme Corp');assert.equal(reviewQueue.data.rows[0].status,'in_review');
  const reviewDownload=await fetch(`${suiteFixture.baseUrl}/api/managed-customers/report-reviews/${report.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenPlanner}`,'X-SolutionsHub-Request':'1' } });
  assert.equal(reviewDownload.status,200);assert.match(reviewDownload.headers.get('content-type'),/application\/pdf/);
  assert.equal((await api(`/api/managed-customers/report-reviews/${report.id}`,{ method:'PUT',token:ids.tokenEnabled,body:{ action:'approve',version:2 } })).status,403);
  const approved=await api(`/api/managed-customers/report-reviews/${report.id}`,{ method:'PUT',token:ids.tokenPlanner,body:{ action:'approve',version:2,comment:'Reviewed against the source data.' } });
  assert.equal(approved.status,200);assert.equal(approved.data.report.status,'approved');
  const readyToFinalize=await api('/api/managed-customers/report-reviews?status=approved',{ token:ids.tokenPlanner });
  assert.equal(readyToFinalize.status,200);assert.equal(readyToFinalize.data.total,1);assert.equal(readyToFinalize.data.rows[0].workflow_version,3);
  const finalized=await api(endpoint,{ method:'PUT',token:ids.tokenManager,body:{ action:'finalize',version:3 } });
  assert.equal(finalized.status,200);assert.equal(finalized.data.report.status,'final');assert.equal(finalized.data.report.workflow_version,4);
  assert.equal((await api('/api/managed-customers/report-reviews',{ token:ids.tokenPlanner })).data.total,0);
  assert.equal((await fetch(`${suiteFixture.baseUrl}/api/managed-customers/report-reviews/${report.id}/download`,{ headers:{ Authorization:`Bearer ${ids.tokenPlanner}`,'X-SolutionsHub-Request':'1' } })).status,404);
  assert.equal((await api(endpoint,{ method:'PUT',token:ids.tokenManager,body:{ action:'reopen',version:4 } })).status,400);
  const reopened=await api(endpoint,{ method:'PUT',token:ids.tokenManager,body:{ action:'reopen',version:4,comment:'Customer scope changed.' } });
  assert.equal(reopened.status,200);assert.equal(reopened.data.report.status,'draft');
  const trail=await api(endpoint,{ token:ids.tokenManager });assert.equal(trail.status,200);assert.deepEqual(trail.data.rows.map(item => item.action),['generated','submitted','approved','finalized','reopened']);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'managed_report_%' AND entity_id=?").get(report.id)).count>=4,true);
  await db.prepare("DELETE FROM user_permission_overrides WHERE user_id=? AND permission_key='managed_reports.review'").run(ids.planner);
});

test('managed report templates are manager-only, validated and versioned',async () => {
  assert.equal((await api('/api/managed-report-templates',{ token:ids.tokenEnabled })).status,403);
  const seeded=await api('/api/managed-report-templates',{ token:ids.tokenManager });assert.equal(seeded.status,200);assert.equal(seeded.data.rows.length>=3,true);
  assert.equal((await api('/api/managed-report-templates',{ method:'POST',token:ids.tokenManager,body:{ name:'Bad',description:'',sections:['unknown'],default_narratives:{},active:true } })).status,400);
  const created=await api('/api/managed-report-templates',{ method:'POST',token:ids.tokenManager,body:{ name:'Customer Security Review',description:'Reusable security review',sections:['executive_summary','ticket_summary','risks'],default_narratives:{ executive_summary:'Security services review.' },active:true } });
  assert.equal(created.status,201);assert.equal(created.data.version,1);assert.deepEqual(created.data.sections,['executive_summary','ticket_summary','risks']);
  const editable={ name:'Customer Security Review Updated',description:created.data.description,sections:created.data.sections,default_narratives:created.data.default_narratives,active:true,version:created.data.version };
  const updated=await api(`/api/managed-report-templates/${created.data.id}`,{ method:'PUT',token:ids.tokenManager,body:editable });
  assert.equal(updated.status,200);assert.equal(updated.data.version,2);
  assert.equal((await api(`/api/managed-report-templates/${created.data.id}`,{ method:'PUT',token:ids.tokenManager,body:{ ...editable,name:'Stale' } })).status,409);
  assert.equal((await api(`/api/managed-report-templates/${created.data.id}`,{ method:'DELETE',token:ids.tokenManager })).status,200);
});

test('permission administration supports versioned role and user overrides',async () => {
  const path='/api/permissions',permission_key='managed_customers.view';
  assert.equal((await api(path,{ token:ids.tokenPlanner })).status,403);
  const matrix=await api(path,{ token:ids.tokenManager });assert.equal(matrix.status,200);assert.equal(matrix.data.definitions.some(item => item.key===permission_key),true);
  assert.equal(matrix.data.definitions.some(item => item.key==='kpis.view' && item.eligible_roles?.includes('manager')),true);
  assert.equal(matrix.data.definitions.some(item => item.key==='reports.access' && item.eligible_roles?.includes('planner')),true);
  assert.equal(matrix.data.definitions.some(item => item.key==='service_activities.access' && item.eligible_roles?.includes('engineer')),true);
  const engineerKpiRule={ scope:'user',user_id:ids.engineerEnabled,permission_key:'kpis.view',allowed:true,version:0 };
  const rejectedEngineerKpi=await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:engineerKpiRule });
  assert.equal(rejectedEngineerKpi.status,400);assert.match(rejectedEngineerKpi.data.error,/not eligible/i);
  const roleBody={ scope:'role',role:'planner',permission_key,allowed:true,version:0 };
  const role=await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:roleBody });assert.equal(role.status,200);assert.equal(role.data.rule.version,1);
  assert.equal((await api('/api/auth/permissions',{ token:ids.tokenPlanner })).data.permissions[permission_key],true);
  const delegated=await api('/api/managed-customers',{ token:ids.tokenPlanner });assert.equal(delegated.status,200);
  const delegatedTemplates=await api('/api/managed-report-templates',{ token:ids.tokenPlanner });assert.equal(delegatedTemplates.status,200);
  const delegatedExport=await api(`/api/managed-customers/${ids.customer}/report.docx`,{ method:'POST',token:ids.tokenPlanner,body:{ from:'2026-09-01',to:'2026-09-30',sections:['executive_summary'],narratives:{},status:'draft' } });assert.equal(delegatedExport.status,403);
  const me=await api('/api/auth/me',{ token:ids.tokenPlanner });assert.equal(me.status,200);assert.equal(me.data.permissions[permission_key],true);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...roleBody,allowed:false } })).status,409);
  const userBody={ scope:'user',user_id:ids.planner,permission_key,allowed:false,version:0 };
  const user=await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:userBody });assert.equal(user.status,200);assert.equal(user.data.rule.version,1);
  assert.equal((await api('/api/auth/permissions',{ token:ids.tokenPlanner })).data.permissions[permission_key],false);
  const permissionService=require('../permissions');assert.equal(await permissionService.hasPermission({ id:ids.planner,role:'planner' },permission_key),false);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...userBody,allowed:null,version:1 } })).status,200);
  assert.equal(await permissionService.hasPermission({ id:ids.planner,role:'planner' },permission_key),true);
  assert.equal((await api('/api/auth/permissions',{ token:ids.tokenPlanner })).data.permissions[permission_key],true);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...roleBody,allowed:null,version:1 } })).status,200);
  assert.equal(await permissionService.hasPermission({ id:ids.planner,role:'planner' },permission_key),false);
  assert.equal((await api('/api/auth/permissions',{ token:ids.tokenPlanner })).data.permissions[permission_key],false);
  const customerRule={ scope:'user',user_id:ids.planner,permission_key:'customers.access',allowed:false,version:0 };
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:customerRule })).status,200);
  assert.equal((await api(`/api/customers/${ids.customer}`,{ token:ids.tokenPlanner })).status,403);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...customerRule,allowed:null,version:1 } })).status,200);
  assert.notEqual((await api(`/api/customers/${ids.customer}`,{ token:ids.tokenPlanner })).status,403);
  const assetRule={ scope:'user',user_id:ids.planner,permission_key:'assets.access',allowed:true,version:0 };
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:assetRule })).status,200);
  assert.equal((await api(`/api/customers/${ids.customer}/assets`,{ token:ids.tokenPlanner })).status,200);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...assetRule,allowed:null,version:1 } })).status,200);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ scope:'user',user_id:ids.engineerEnabled,permission_key:'assets.access',allowed:true,version:0 } })).status,400);
  const reportsRule={ scope:'user',user_id:ids.planner,permission_key:'reports.access',allowed:true,version:0 };
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:reportsRule })).status,200);
  assert.equal((await api('/api/reports/summary',{ token:ids.tokenPlanner })).status,200);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...reportsRule,allowed:null,version:1 } })).status,200);
  const reportsDeny={ scope:'user',user_id:ids.manager,permission_key:'reports.access',allowed:false,version:0 };
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:reportsDeny })).status,200);
  assert.equal((await api('/api/reports/summary',{ token:ids.tokenManager })).status,403);
  assert.equal((await api('/api/reports/service-activity/export',{ token:ids.tokenManager })).status,403);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...reportsDeny,allowed:null,version:1 } })).status,200);
  const activityRule={ scope:'user',user_id:ids.engineerEnabled,permission_key:'service_activities.access',allowed:false,version:0 };
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:activityRule })).status,200);
  assert.equal((await api('/api/service-activities/meta',{ token:ids.tokenEnabled })).status,403);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ ...activityRule,allowed:null,version:1 } })).status,200);
  assert.equal((await api(`${path}/rule`,{ method:'PUT',token:ids.tokenManager,body:{ scope:'user',user_id:ids.planner,permission_key:'service_activities.access',allowed:true,version:0 } })).status,400);
});

test('team directory paging validates filters while preserving the legacy roster',async () => {
  const legacy=await api('/api/auth/users',{ token:ids.tokenManager });
  assert.equal(legacy.status,200);assert.equal(Array.isArray(legacy.data),true);
  const paged=await api('/api/auth/users?paged=1&page=1&page_size=2&role=engineer&search=Engineer',{ token:ids.tokenManager });
  assert.equal(paged.status,200);assert.equal(paged.data.page,1);assert.equal(paged.data.page_size,2);
  assert.equal(paged.data.rows.length<=2,true);assert.equal(paged.data.rows.every(user => user.role==='engineer'),true);
  assert.equal(paged.data.total,paged.data.counts.engineer);assert.equal(paged.data.counts.all>=paged.data.total,true);
  const engineerView=await api('/api/auth/users?paged=1&page_size=2',{ token:ids.tokenEnabled });
  assert.equal(engineerView.status,200);assert.equal(engineerView.data.rows.every(user => !Object.hasOwn(user,'email') && !Object.hasOwn(user,'last_login')),true);
  assert.equal((await api('/api/auth/users?paged=1&search=%25',{ token:ids.tokenManager })).data.total,0,'wildcards are searched literally');
  for (const query of ['page=0','page=1&page=2','page_size=101','role=owner','unknown=1']) {
    assert.equal((await api(`/api/auth/users?paged=1&${query}`,{ token:ids.tokenManager })).status,400,query);
  }
});

test('concurrent report exports allocate unique versions on PostgreSQL', { skip:!process.env.TEST_DATABASE_URL },async () => {
  const endpoint=`${suiteFixture.baseUrl}/api/managed-customers/${ids.customer}/report.docx`,body={ from:'2026-08-01',to:'2026-08-31',sections:['executive_summary'],narratives:{ executive_summary:'Concurrent version allocation test.' },status:'draft' };
  const responses=await Promise.all(Array.from({ length:4 },() => fetch(endpoint,{ method:'POST',headers:{ Authorization:`Bearer ${ids.tokenManager}`,'Content-Type':'application/json','X-SolutionsHub-Request':'1' },body:JSON.stringify(body) })));
  assert.equal(responses.every(response => response.status===200),true);
  const versions=responses.map(response => Number(response.headers.get('x-report-version'))).sort((a,b) => a-b);
  assert.deepEqual(versions,[1,2,3,4]);await Promise.all(responses.map(response => response.arrayBuffer()));
  const rows=await db.prepare(`SELECT report_version,stored_name FROM managed_report_history
    WHERE customer_id=? AND period_start=? AND period_end=? AND output_format='docx' ORDER BY report_version`).all(ids.customer,body.from,body.to);
  assert.deepEqual(rows.map(row => row.report_version),[1,2,3,4]);assert.equal(new Set(rows.map(row => row.stored_name)).size,4);
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
  const html = await fetch(`${suiteFixture.baseUrl}/api/report-settings/preview`,{ headers: { Authorization: `Bearer ${ids.tokenManager}` } });
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

test('queued custom report exports remain encrypted and private to their owner',async () => {
  const previousKey=process.env.ATTACHMENT_KEY;
  const fs=require('node:fs'),path=require('node:path'),{ exportRoot }=require('../customReportExport');
  let jobId,filePath;
  process.env.ATTACHMENT_KEY='ab'.repeat(32);
  try {
    const owner=(await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Export owner','export-owner@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
    const peer=(await db.prepare('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Export peer','export-peer@test.local',bcrypt.hashSync('pw',4),'manager')).lastInsertRowid;
    const token=signJwt({ id:owner }),peerToken=signJwt({ id:peer });
    const queued=await api('/api/reports/custom/exports',{ method:'POST',token,body:{ format:'csv',definition:{ source:'tasks',fields:['id','title'] } } });
    assert.equal(queued.status,202);assert.equal(queued.data.status,'queued');jobId=queued.data.id;
    assert.equal((await api(`/api/reports/custom/exports/${jobId}`,{ token:peerToken })).status,404);
    assert.equal((await api(`/api/reports/custom/exports/${jobId}`,{ token:ids.tokenEnabled })).status,403);
    await db.prepare("UPDATE users SET role='engineer' WHERE id=?").run(owner);
    await assert.rejects(require('../customReportExport').generate({ format:'csv',definition:{ source:'tasks',fields:['id'] } },{ id:jobId,created_by:owner }),/no longer has permission/);
    await db.prepare("UPDATE users SET role='manager' WHERE id=?").run(owner);
    const fileCipher=require('../cipher');
    const plain=Buffer.from('ID,Title\n1,Private result\n'),encrypted=fileCipher.encrypt(plain),file=`job-${jobId}.bin`;
    filePath=path.join(exportRoot,file);
    await fs.promises.mkdir(exportRoot,{ recursive:true });await fs.promises.writeFile(filePath,encrypted.data);
    await db.prepare("UPDATE background_jobs SET status='completed',artifact_name='custom-report.csv',artifact_path=?,artifact_type='text/csv',artifact_iv=?,artifact_tag=?,artifact_expires_at='2999-01-01 00:00:00',completed_at=app_now() WHERE id=?").run(file,encrypted.iv,encrypted.tag,jobId);
    const download=await fetch(`${suiteFixture.baseUrl}/api/reports/custom/exports/${jobId}/download`,{ headers:{ Authorization:`Bearer ${token}` } });
    assert.equal(download.status,200);assert.equal(Buffer.from(await download.arrayBuffer()).equals(plain),true);
    assert.equal((await fetch(`${suiteFixture.baseUrl}/api/reports/custom/exports/${jobId}/download`,{ headers:{ Authorization:`Bearer ${peerToken}` } })).status,404);
    assert.equal((await api('/api/reports/custom/exports',{ method:'POST',token,body:{ format:'pdf',definition:{ source:'tasks',fields:['id'] } } })).status,400);
  } finally {
    if (filePath) await fs.promises.unlink(filePath).catch(()=>{});
    if (jobId) await db.prepare('DELETE FROM background_jobs WHERE id=?').run(jobId);
    if (previousKey === undefined) delete process.env.ATTACHMENT_KEY; else process.env.ATTACHMENT_KEY=previousKey;
  }
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
  const response = await fetch(`${suiteFixture.baseUrl}/api/reports/custom/export`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-SolutionsHub-Request': '1',Authorization: `Bearer ${ids.tokenManager}` },body: JSON.stringify(definition) });
  assert.equal(response.status,200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount,103);
  assert.deepEqual(workbook.worksheets[0].getRow(2).values.slice(1),Object.values(preview.data.rows[0]));
  const csv = await fetch(`${suiteFixture.baseUrl}/api/reports/custom/export-csv`,{ method: 'POST',headers: { 'Content-Type': 'application/json','X-SolutionsHub-Request': '1',Authorization: `Bearer ${ids.tokenManager}` },body: JSON.stringify(definition) });
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
