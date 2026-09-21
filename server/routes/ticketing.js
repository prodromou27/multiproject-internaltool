const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const { assertPublicHttpUrl }=require('../security');
const { logAudit }=require('../auditLog');
const { decrypt }=require('../fieldCipher');
const settings=require('../ticketingSettings');
const { createTicketingProvider }=require('../ticketing');
const { syncCustomer,applyMappingsToStoredTickets }=require('../ticketSync');
const mappings=require('../ticketMappings');

router.use(requireManager);

async function provider() {
  const stored=await settings.storedSettings();
  return createTicketingProvider('request_tracker',settings.runtimeSettings(stored));
}

router.get('/settings',async (req,res) => res.json(settings.publicSettings(await settings.storedSettings())));

router.put('/settings',async (req,res) => {
  let next;
  try {
    const current=await settings.storedSettings();next=settings.mergeSettings(current,req.body);
    if (next.base_url) await assertPublicHttpUrl(next.base_url,{ label:'RT base URL',allowPrivate:process.env.ALLOW_PRIVATE_TICKETING_URLS==='true' });
  } catch(error) { return res.status(error.status || 400).json({ error:error.message }); }
  await settings.saveSettings(next);
  await logAudit(db,req,'settings','ticketing_rt','Request Tracker','ticketing_settings_updated',`enabled=${next.enabled}; sync_interval_minutes=${next.sync_interval_minutes}; token_set=${!!next.api_token}`);
  res.json(settings.publicSettings(next));
});

router.post('/test',async (req,res) => {
  try { const result=await (await provider()).testConnection();res.json({ ...result,message:`Connected to Request Tracker; ${result.queue_count} visible queue(s)` }); }
  catch(error) { res.status(error.status || 502).json({ error:error.status ? error.message : 'Could not test the Request Tracker connection' }); }
});

router.get('/queues',async (req,res) => {
  try {
    const rows=await (await provider()).getQueues();
    const mappings=await db.prepare(`SELECT ctc.external_queue_id,ctc.customer_id,c.name AS customer_name
      FROM customer_ticketing_configurations ctc JOIN customers c ON c.id=ctc.customer_id
      WHERE ctc.provider_type='request_tracker'`).all();
    const byQueue=new Map(mappings.map(mapping => [String(mapping.external_queue_id),{ customer_id:mapping.customer_id,customer_name:decrypt(mapping.customer_name) }]));
    res.json({ rows:rows.map(queue => ({ ...queue,mapping:byQueue.get(String(queue.id)) || null })) });
  }
  catch(error) { res.status(error.status || 502).json({ error:error.status ? error.message : 'Could not retrieve Request Tracker queues' }); }
});

router.get('/mappings',async (req,res) => res.json(await mappings.loadMappings()));

router.put('/mappings',async (req,res) => {
  try {
    const valid=mappings.validate(req.body);let reclassified=0;
    await db.transaction(async tx => { await mappings.saveMappings(valid,tx);reclassified=await applyMappingsToStoredTickets(valid,tx); });
    await logAudit(db,req,'settings','ticket_mapping_config','Ticket mappings','ticket_mappings_updated',`statuses=${valid.statuses.length}; priorities=${valid.priorities.length}; reclassified=${reclassified}`);
    res.json({ ...valid,reclassified });
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not save ticket mappings' }); }
});

router.post('/sync/:customerId',async (req,res) => {
  const customerId=Number(req.params.customerId);
  if (!Number.isSafeInteger(customerId) || customerId<1) return res.status(400).json({ error:'Invalid customer ID' });
  try {
    const result=await syncCustomer(customerId,{ triggeredBy:req.user.id });
    await logAudit(db,req,'customer',customerId,`Customer ${customerId}`,'ticket_sync_completed',`run_id=${result.run_id}; found=${result.tickets_found}; created=${result.tickets_created}; updated=${result.tickets_updated}`);
    res.json(result);
  }
  catch(error) { res.status(error.status || 502).json({ error:error.status ? error.message : 'Ticket synchronization failed' }); }
});

router.get('/monitoring',async (req,res) => {
  const publicSettings=settings.publicSettings(await settings.storedSettings());
  const [customers,runSummary,lastSuccess,lastFailure]=await Promise.all([
    db.prepare(`SELECT ctc.customer_id,ctc.external_queue_id,ctc.external_queue_name,ctc.enabled,ctc.last_successful_sync_at,ctc.last_sync_status,
        c.name AS customer_name,c.active AS customer_active,mc.managed_services_enabled,
        COUNT(et.id) AS ticket_count,
        COALESCE(SUM(CASE WHEN et.status_group='open' THEN 1 ELSE 0 END),0) AS open_ticket_count
      FROM customer_ticketing_configurations ctc
      JOIN customers c ON c.id=ctc.customer_id
      LEFT JOIN managed_customer_configurations mc ON mc.customer_id=ctc.customer_id
      LEFT JOIN external_tickets et ON et.customer_id=ctc.customer_id AND et.provider_type=ctc.provider_type
      WHERE ctc.provider_type='request_tracker'
      GROUP BY ctc.customer_id,ctc.external_queue_id,ctc.external_queue_name,ctc.enabled,ctc.last_successful_sync_at,ctc.last_sync_status,c.name,c.active,mc.managed_services_enabled`).all(),
    db.prepare(`SELECT COUNT(*) AS total_runs,
        COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0) AS running_runs,
        COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed_runs
      FROM ticket_sync_runs`).get(),
    db.prepare("SELECT completed_at FROM ticket_sync_runs WHERE status='success' ORDER BY completed_at DESC,id DESC LIMIT 1").get(),
    db.prepare("SELECT completed_at,error_message FROM ticket_sync_runs WHERE status='failed' ORDER BY completed_at DESC,id DESC LIMIT 1").get(),
  ]);
  const rows=customers.map(row => ({
    ...row,
    customer_name:decrypt(row.customer_name),
    customer_active:!!row.customer_active,
    enabled:!!row.enabled,
    managed_services_enabled:!!row.managed_services_enabled,
    ticket_count:Number(row.ticket_count),
    open_ticket_count:Number(row.open_ticket_count),
    mapping_problem:!row.customer_active ? 'Customer is inactive' : !row.managed_services_enabled ? 'Managed Services is disabled for this customer' : !row.enabled ? 'Ticket synchronization is disabled for this mapping' : null,
  })).sort((a,b) => a.customer_name.localeCompare(b.customer_name));
  res.json({
    integration:{ enabled:publicSettings.enabled,configured:!!(publicSettings.base_url && publicSettings.api_token_set),sync_interval_minutes:publicSettings.sync_interval_minutes },
    summary:{ mapped_customers:rows.length,total_tickets:rows.reduce((sum,row) => sum+row.ticket_count,0),total_runs:Number(runSummary.total_runs),running_runs:Number(runSummary.running_runs),failed_runs:Number(runSummary.failed_runs),mapping_problems:rows.filter(row => row.mapping_problem).length,last_successful_sync_at:lastSuccess?.completed_at || null,last_failed_sync_at:lastFailure?.completed_at || null,last_error:lastFailure?.error_message || null },
    customers:rows,
  });
});

router.get('/sync-runs',async (req,res) => {
  const customerId=req.query.customer_id===undefined ? null : Number(req.query.customer_id);
  if (customerId!==null && (!Number.isSafeInteger(customerId) || customerId<1)) return res.status(400).json({ error:'Invalid customer ID' });
  const sql=`SELECT tsr.*,c.name AS customer_name,u.name AS triggered_by_name FROM ticket_sync_runs tsr
    LEFT JOIN customers c ON c.id=tsr.customer_id LEFT JOIN users u ON u.id=tsr.triggered_by`;
  const rows=customerId===null
    ? await db.prepare(`${sql} ORDER BY tsr.started_at DESC,tsr.id DESC LIMIT 100`).all()
    : await db.prepare(`${sql} WHERE tsr.customer_id=? ORDER BY tsr.started_at DESC,tsr.id DESC LIMIT 100`).all(customerId);
  res.json({ rows:rows.map(row => ({ ...row,customer_name:row.customer_name ? decrypt(row.customer_name) : null })) });
});

module.exports=router;
