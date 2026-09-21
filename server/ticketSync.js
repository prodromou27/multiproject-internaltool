const db=require('./db');
const ticketingSettings=require('./ticketingSettings');
const { createTicketingProvider }=require('./ticketing');
const { DEFAULTS,loadMappings }=require('./ticketMappings');

function normalizeDate(value) {
  if (!value) return null;
  const text=String(value).trim().replace(/^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})/,'$1T$2');
  const date=new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStatus(value,mappings=DEFAULTS) {
  const external=String(value || 'unknown').trim();
  const mapped=mappings.statuses.find(item => item.external.toLowerCase()===external.toLowerCase());
  return { external,normalized:mapped?.normalized || external || 'Unknown',group:mapped?.group || 'open' };
}

function normalizePriority(value,mappings=DEFAULTS) {
  if (value===null || value===undefined || value==='') return { external:null,normalized:null };
  const external=String(value).trim();const lower=external.toLowerCase();const numeric=Number(external);
  const mapped=mappings.priorities.find(item => item.external.toLowerCase()===lower);
  if (mapped) return { external,normalized:mapped.normalized };
  if (Number.isFinite(numeric)) return { external,normalized:numeric>=90?'Critical':numeric>=70?'High':numeric>=30?'Normal':'Low' };
  if (lower.includes('critical') || lower.includes('urgent')) return { external,normalized:'Critical' };
  if (lower.includes('high')) return { external,normalized:'High' };
  if (lower.includes('low')) return { external,normalized:'Low' };
  return { external,normalized:'Normal' };
}

function ticketRecord(ticket,mapping,baseUrl,now=new Date(),mappings=DEFAULTS) {
  const id=String(ticket.id ?? '');
  if (!/^\d+$/.test(id)) throw Object.assign(new Error('Request Tracker returned an invalid ticket identifier'),{ status:502 });
  const status=normalizeStatus(ticket.Status || ticket.status,mappings);
  const priority=normalizePriority(ticket.Priority ?? ticket.priority,mappings);
  const owner=ticket.Owner && typeof ticket.Owner==='object' ? ticket.Owner : {};
  const created=normalizeDate(ticket.Created || ticket.created);
  const updated=normalizeDate(ticket.LastUpdated || ticket.Updated || ticket.updated);
  const resolved=normalizeDate(ticket.Resolved || ticket.resolved);
  const due=normalizeDate(ticket.Due || ticket.due);
  return {
    customer_id:mapping.customer_id,provider_type:'request_tracker',external_queue_id:String(mapping.external_queue_id),external_queue_name:mapping.external_queue_name,
    external_ticket_id:id,ticket_number:id,subject:String(ticket.Subject || ticket.subject || `Ticket ${id}`).slice(0,2000),
    external_status:status.external,normalized_status:status.normalized,status_group:status.group,external_priority:priority.external,normalized_priority:priority.normalized,
    owner_external_id:owner.id ? String(owner.id).slice(0,500) : null,owner_name:owner.Name ? String(owner.Name).slice(0,500) : (owner.id ? String(owner.id).slice(0,500) : null),
    created_at_external:created,updated_at_external:updated,resolved_at_external:resolved,closed_at_external:status.group==='closed' ? resolved : null,
    sla_due_at:due,sla_breached:!!(due && status.group==='open' && new Date(due)<now),external_url:`${String(baseUrl).replace(/\/+$/,'').replace(/\/REST\/2\.0$/i,'')}/Ticket/Display.html?id=${encodeURIComponent(id)}`,
  };
}

async function syncCustomer(customerId,{ provider,triggeredBy=null,store=db }={}) {
  const mapping=await store.prepare("SELECT * FROM customer_ticketing_configurations WHERE customer_id=? AND provider_type='request_tracker' AND enabled=1").get(customerId);
  if (!mapping) throw Object.assign(new Error('No enabled RT queue mapping exists for this customer'),{ status:400 });
  const cutoff=new Date(Date.now()-60*60*1000).toISOString().slice(0,19).replace('T',' ');
  await store.prepare("UPDATE ticket_sync_runs SET status='failed',completed_at=app_now(),errors=1,error_message='Synchronization was interrupted' WHERE customer_id=? AND status='running' AND started_at<?").run(customerId,cutoff);
  let runId;
  try { runId=(await store.prepare("INSERT INTO ticket_sync_runs (status,customer_id,queue_id,triggered_by) VALUES ('running',?,?,?)").run(customerId,mapping.external_queue_id,triggeredBy)).lastInsertRowid; }
  catch(error) { if (error.code==='23505') throw Object.assign(new Error('A ticket synchronization is already running for this customer'),{ status:409 });throw error; }
  try {
    const settings=await ticketingSettings.storedSettings(store);
    if (!settings.enabled) throw Object.assign(new Error('Request Tracker integration is disabled'),{ status:409 });
    const runtime=ticketingSettings.runtimeSettings(settings);
    const client=provider || createTicketingProvider('request_tracker',runtime);
    let updatedAfter=null;
    if (mapping.last_successful_sync_at) {
      const last=new Date(String(mapping.last_successful_sync_at).replace(' ','T')+'Z');
      if (!Number.isNaN(last.getTime())) updatedAfter=new Date(last.getTime()-5*60*1000).toISOString();
    }
    const tickets=await client.getTickets(mapping.external_queue_id,{ updatedAfter });
    const mappingConfig=await loadMappings(store);
    const records=tickets.map(ticket => ticketRecord(ticket,mapping,runtime.base_url,new Date(),mappingConfig));
    const existing=new Set((await store.prepare("SELECT external_ticket_id FROM external_tickets WHERE provider_type='request_tracker' AND customer_id=?").all(customerId)).map(row => String(row.external_ticket_id)));
    let created=0,updated=0;
    await store.transaction(async tx => {
      const upsert=tx.prepare(`INSERT INTO external_tickets
        (customer_id,provider_type,external_queue_id,external_queue_name,external_ticket_id,ticket_number,subject,external_status,normalized_status,status_group,
         external_priority,normalized_priority,owner_external_id,owner_name,created_at_external,updated_at_external,resolved_at_external,closed_at_external,sla_due_at,sla_breached,external_url,last_synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,app_now())
        ON CONFLICT (provider_type,external_ticket_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,external_queue_id=EXCLUDED.external_queue_id,
          external_queue_name=EXCLUDED.external_queue_name,ticket_number=EXCLUDED.ticket_number,subject=EXCLUDED.subject,external_status=EXCLUDED.external_status,
          normalized_status=EXCLUDED.normalized_status,status_group=EXCLUDED.status_group,external_priority=EXCLUDED.external_priority,
          normalized_priority=EXCLUDED.normalized_priority,owner_external_id=EXCLUDED.owner_external_id,owner_name=EXCLUDED.owner_name,
          created_at_external=EXCLUDED.created_at_external,updated_at_external=EXCLUDED.updated_at_external,resolved_at_external=EXCLUDED.resolved_at_external,
          closed_at_external=EXCLUDED.closed_at_external,sla_due_at=EXCLUDED.sla_due_at,sla_breached=EXCLUDED.sla_breached,
          external_url=EXCLUDED.external_url,last_synced_at=app_now()`);
      for (const record of records) {
        await upsert.run(record.customer_id,record.provider_type,record.external_queue_id,record.external_queue_name,record.external_ticket_id,record.ticket_number,
          record.subject,record.external_status,record.normalized_status,record.status_group,record.external_priority,record.normalized_priority,record.owner_external_id,
          record.owner_name,record.created_at_external,record.updated_at_external,record.resolved_at_external,record.closed_at_external,record.sla_due_at,record.sla_breached?1:0,record.external_url);
        if (existing.has(record.external_ticket_id)) updated++;else created++;
      }
      await tx.prepare("UPDATE customer_ticketing_configurations SET last_successful_sync_at=app_now(),last_sync_status='success',updated_at=app_now() WHERE id=?").run(mapping.id);
      await tx.prepare("UPDATE ticket_sync_runs SET completed_at=app_now(),status='success',tickets_found=?,tickets_created=?,tickets_updated=? WHERE id=?").run(records.length,created,updated,runId);
    });
    const completed=await store.prepare('SELECT completed_at FROM ticket_sync_runs WHERE id=?').get(runId);
    return { run_id:runId,completed_at:completed?.completed_at || null,tickets_found:records.length,tickets_created:created,tickets_updated:updated };
  } catch(error) {
    const safeError=error.status ? String(error.message).slice(0,2000) : 'Ticket synchronization failed';
    await store.prepare("UPDATE ticket_sync_runs SET completed_at=app_now(),status='failed',errors=1,error_message=? WHERE id=?").run(safeError,runId);
    await store.prepare("UPDATE customer_ticketing_configurations SET last_sync_status='failed',updated_at=app_now() WHERE id=?").run(mapping.id);
    throw error;
  }
}

async function applyMappingsToStoredTickets(config,store=db) {
  const apply=async runner => {
    const rows=await runner.prepare('SELECT id,external_status,external_priority FROM external_tickets ORDER BY id').all();
    const update=runner.prepare('UPDATE external_tickets SET normalized_status=?,status_group=?,normalized_priority=? WHERE id=?');
    for (const row of rows) {
      const status=normalizeStatus(row.external_status,config),priority=normalizePriority(row.external_priority,config);
      await update.run(status.normalized,status.group,priority.normalized,row.id);
    }
    return rows.length;
  };
  return typeof store.transaction==='function' ? store.transaction(apply) : apply(store);
}

module.exports={ normalizeDate,normalizeStatus,normalizePriority,ticketRecord,syncCustomer,applyMappingsToStoredTickets };
