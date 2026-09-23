const db=require('./db');
const ticketingSettings=require('./ticketingSettings');
const jobs=require('./backgroundJobs');

let timer=null,initialTimer=null,running=false;

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
    const interval=Math.max(15,Math.min(1440,Number(settings.sync_interval_minutes) || 60))*60*1000;
    const mappings=await db.prepare("SELECT customer_id,last_successful_sync_at FROM customer_ticketing_configurations WHERE provider_type='request_tracker' AND enabled=1 ORDER BY last_successful_sync_at NULLS FIRST,customer_id").all();
    const due=mappings.filter(mapping => Date.now()-timestamp(mapping.last_successful_sync_at)>=interval).slice(0,5);
    for (const mapping of due) {
      try { await jobs.enqueue('ticket_sync',{ customer_id:mapping.customer_id },{ dedupeKey:`ticket-sync:${mapping.customer_id}`,maxAttempts:4 }); }
      catch(error) { if (error.status!==409) console.error(`[ticket-sync] customer ${mapping.customer_id}:`,error.message); }
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
