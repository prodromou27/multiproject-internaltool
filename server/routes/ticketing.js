const router=require('express').Router();
const db=require('../db');
const { requireManager }=require('../middleware/auth');
const { assertPublicHttpUrl }=require('../security');
const { logAudit }=require('../auditLog');
const settings=require('../ticketingSettings');
const { createTicketingProvider }=require('../ticketing');

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
  catch(error) { res.status(error.status || 502).json({ error:error.message }); }
});

router.get('/queues',async (req,res) => {
  try { res.json({ rows:await (await provider()).getQueues() }); }
  catch(error) { res.status(error.status || 502).json({ error:error.message }); }
});

module.exports=router;
