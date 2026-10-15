const db=require('./db');
const ticketingSettings=require('./ticketingSettings');
const jobs=require('./backgroundJobs');

let timer=null,initialTimer=null,running=false,engineersQueuedAt=0;

function timestamp(value) {
  if (!value) return 0;
  const parsed=Date.parse(String(value).includes('T') ? value : `${String(value).replace(' ','T')}Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function runDueSyncs() {
  if (running) return;
  running=true;
  try {
    const settings=await ticketingSettings.storedSettings();
    if (!settings.enabled) return;
    const interval=Math.max(5,Math.min(1440,Number(settings.sync_interval_minutes) || 5))*60*1000;
    const mappings=await db.prepare("SELECT customer_id,last_successful_sync_at,last_sync_status,updated_at FROM customer_ticketing_configurations WHERE provider_type='request_tracker' AND enabled=1 ORDER BY last_successful_sync_at NULLS FIRST,customer_id").all();
    // A failing customer is retried one interval after its last attempt, not every minute.
    const lastTry=mapping => Math.max(timestamp(mapping.last_successful_sync_at),mapping.last_sync_status==='failed' ? timestamp(mapping.updated_at) : 0);
    const due=mappings.filter(mapping => Date.now()-lastTry(mapping)>=interval).slice(0,25);
    for (const mapping of due) {
      try { await jobs.enqueue('ticket_sync',{ customer_id:mapping.customer_id },{ dedupeKey:`ticket-sync:${mapping.customer_id}`,maxAttempts:4 }); }
      catch(error) { if (error.status!==409) console.error(`[ticket-sync] customer ${mapping.customer_id}:`,error.message); }
    }
    // Engineers' own tickets (every queue), at most every 15 minutes.
    const oldest=await db.prepare('SELECT ticketing_synced_at FROM users WHERE active=1 AND ticketing_username IS NOT NULL ORDER BY ticketing_synced_at NULLS FIRST LIMIT 1').get();
    const every=Math.max(interval,15*60*1000);
    // Failing reads leave the time empty, so also wait between attempts.
    if (oldest && Date.now()-timestamp(oldest.ticketing_synced_at)>=every && Date.now()-engineersQueuedAt>=every) {
      engineersQueuedAt=Date.now();
      try { await jobs.enqueue('engineer_ticket_sync',{},{ dedupeKey:'engineer-ticket-sync',maxAttempts:2 }); }
      catch(error) { if (error.status!==409) console.error('[ticket-sync] engineers:',error.message); }
    }
  } catch(error) { console.error('[ticket-sync] scheduler:',error.message); }
  finally { running=false; }
}

function start() {
  if (timer) return;
  timer=setInterval(runDueSyncs,60*1000);timer.unref?.();
  initialTimer=setTimeout(() => { initialTimer=null;runDueSyncs(); },5000);initialTimer.unref?.();
}

function stop() { if (timer) clearInterval(timer);if (initialTimer) clearTimeout(initialTimer);timer=null;initialTimer=null; }

module.exports={ timestamp,runDueSyncs,start,stop };
