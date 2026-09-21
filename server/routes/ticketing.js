const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const { assertPublicHttpUrl }=require('../security');
const { logAudit }=require('../auditLog');
const { decrypt }=require('../fieldCipher');
const settings=require('../ticketingSettings');
const { createTicketingProvider }=require('../ticketing');
const { syncCustomer }=require('../ticketSync');

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

router.get('/sync-runs',async (req,res) => {
  const customerId=req.query.customer_id===undefined ? null : Number(req.query.customer_id);
  if (customerId!==null && (!Number.isSafeInteger(customerId) || customerId<1)) return res.status(400).json({ error:'Invalid customer ID' });
  const rows=customerId===null
    ? await db.prepare('SELECT * FROM ticket_sync_runs ORDER BY started_at DESC,id DESC LIMIT 100').all()
    : await db.prepare('SELECT * FROM ticket_sync_runs WHERE customer_id=? ORDER BY started_at DESC,id DESC LIMIT 100').all(customerId);
  res.json({ rows });
});

module.exports=router;
