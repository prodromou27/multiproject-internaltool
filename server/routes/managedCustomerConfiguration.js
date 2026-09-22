const router=require('express').Router({ mergeParams:true });
const db=require('../db');
const { requireManager,requirePermission }=require('../middleware/auth');
const { logAudit }=require('../auditLog');
const ticketingSettings=require('../ticketingSettings');
const { createTicketingProvider }=require('../ticketing');

const FREQUENCIES=new Set(['monthly','quarterly','semiannual','annual']);
const BOOLEAN_FIELDS=['managed_services_enabled','service_activity_tracking_enabled','task_reporting_enabled','project_reporting_enabled','maintenance_visit_reporting_enabled','recommendation_tracking_enabled','include_in_managed_services_reports','ticket_integration_enabled','ticket_include_in_reporting','ticket_write_back_enabled'];
const ALLOWED_FIELDS=new Set([...BOOLEAN_FIELDS,'responsible_team_id','service_manager_id','reporting_frequency','default_report_template_id','external_queue_id','external_queue_name','ticket_write_back_status','version']);
const fail=(message,status=400) => { throw Object.assign(new Error(message),{ status }); };
const integerOrNull=(value,label) => {
  if (value===null || value===undefined || value==='') return null;
  const parsed=Number(value);
  if (!Number.isSafeInteger(parsed) || parsed<1) fail(`${label} must be a positive integer or null`);
  return parsed;
};

async function customerId(req) {
  const id=integerOrNull(req.params.id,'Customer ID');
  if (!id) fail('Invalid customer ID');
  if (!await db.prepare('SELECT 1 FROM customers WHERE id=?').get(id)) fail('Customer not found',404);
  return id;
}

function responseShape(customer,managed={},ticket={}) {
  return {
    customer_id:customer.id,
    managed_services_enabled:!!managed.managed_services_enabled,
    service_activity_tracking_enabled:!!customer.service_activity_enabled,
    task_reporting_enabled:managed.task_reporting_enabled===undefined ? true : !!managed.task_reporting_enabled,
    project_reporting_enabled:managed.project_reporting_enabled===undefined ? true : !!managed.project_reporting_enabled,
    maintenance_visit_reporting_enabled:managed.maintenance_visit_reporting_enabled===undefined ? true : !!managed.maintenance_visit_reporting_enabled,
    recommendation_tracking_enabled:managed.recommendation_tracking_enabled===undefined ? true : !!managed.recommendation_tracking_enabled,
    include_in_managed_services_reports:managed.include_in_managed_services_reports===undefined ? true : !!managed.include_in_managed_services_reports,
    responsible_team_id:managed.responsible_team_id || null,
    service_manager_id:managed.service_manager_id || null,
    reporting_frequency:managed.reporting_frequency || '',
    default_report_template_id:managed.default_report_template_id || null,
    ticket_integration_enabled:!!ticket.enabled,
    ticket_include_in_reporting:ticket.include_in_reporting===undefined ? true : !!ticket.include_in_reporting,
    ticket_write_back_enabled:!!ticket.write_back_enabled,
    ticket_write_back_status:ticket.write_back_status || '',
    external_queue_id:ticket.external_queue_id || '',
    external_queue_name:ticket.external_queue_name || '',
    last_successful_sync_at:ticket.last_successful_sync_at || null,
    last_sync_status:ticket.last_sync_status || null,
    version:Number(managed.version || 0),
  };
}

router.get('/',requirePermission('managed_customers.view'),async (req,res) => {
  try {
    const id=await customerId(req);
    const customer=await db.prepare('SELECT id,service_activity_enabled FROM customers WHERE id=?').get(id);
    const managed=await db.prepare('SELECT * FROM managed_customer_configurations WHERE customer_id=?').get(id);
    const ticket=await db.prepare("SELECT * FROM customer_ticketing_configurations WHERE customer_id=? AND provider_type='request_tracker'").get(id);
    res.json(responseShape(customer,managed,ticket));
  } catch(error) { res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not load managed customer configuration' }); }
});

router.put('/',requireManager,async (req,res) => {
  try {
    const id=await customerId(req);
    if (!req.body || typeof req.body!=='object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !ALLOWED_FIELDS.has(key))) fail('Invalid managed customer configuration');
    for (const field of BOOLEAN_FIELDS) if (typeof req.body[field]!=='boolean') fail(`${field} must be true or false`);
    if (!Number.isSafeInteger(Number(req.body.version)) || Number(req.body.version)<0) fail('A valid configuration version is required');
    const responsibleTeamId=integerOrNull(req.body.responsible_team_id,'Responsible team');
    const serviceManagerId=integerOrNull(req.body.service_manager_id,'Service manager');
    const defaultTemplateId=integerOrNull(req.body.default_report_template_id,'Default report template');
    if (defaultTemplateId && !await db.prepare('SELECT 1 FROM managed_report_templates WHERE id=? AND active=1').get(defaultTemplateId)) fail('Default report template must be an active template');
    const frequency=String(req.body.reporting_frequency || '').trim().toLowerCase();
    if (frequency && !FREQUENCIES.has(frequency)) fail('Reporting frequency must be monthly, quarterly, semiannual, annual, or blank');
    const queueId=String(req.body.external_queue_id || '').trim();
    const queueName=String(req.body.external_queue_name || '').trim();
    if (queueId && !/^\d+$/.test(queueId)) fail('RT queue ID must contain digits only');
    if (queueId && !queueName) fail('RT queue name is required when a queue is selected');
    if (queueName.length>500) fail('RT queue name must be at most 500 characters');
    if (req.body.ticket_integration_enabled && (!queueId || !queueName)) fail('Select an RT queue before enabling ticket integration');
    if (req.body.ticket_integration_enabled && !req.body.managed_services_enabled) fail('Managed Services must be enabled before ticket integration');
    if (req.body.ticket_integration_enabled && !(await ticketingSettings.storedSettings()).enabled) fail('Enable the Request Tracker integration before enabling this customer mapping',409);
    const writeBackStatus=String(req.body.ticket_write_back_status || '').trim();
    if (req.body.ticket_write_back_enabled && !req.body.ticket_integration_enabled) fail('Enable ticket integration before enabling status write-back');
    if (req.body.ticket_write_back_enabled && !writeBackStatus) fail('An RT status value is required to enable status write-back (e.g. resolved)');
    if (writeBackStatus.length>100) fail('RT status value must be at most 100 characters');

    const result=await db.transaction(async tx => {
      const current=await tx.prepare('SELECT * FROM managed_customer_configurations WHERE customer_id=?').get(id);
      if (Number(current?.version || 0)!==Number(req.body.version)) fail('This configuration changed after you opened it. Reload and try again.',409);
      if (responsibleTeamId && !await tx.prepare('SELECT 1 FROM customer_teams WHERE customer_id=? AND team_id=?').get(id,responsibleTeamId)) fail('Responsible team must be assigned to this customer');
      if (serviceManagerId && !await tx.prepare("SELECT 1 FROM users WHERE id=? AND role='manager' AND active=1").get(serviceManagerId)) fail('Service manager must be an active manager');
      if (queueId) {
        const owner=await tx.prepare("SELECT customer_id FROM customer_ticketing_configurations WHERE provider_type='request_tracker' AND external_queue_id=? AND customer_id<>?").get(queueId,id);
        if (owner) fail('This RT queue is already assigned to another managed customer',409);
      }

      const nextVersion=Number(req.body.version)+1;
      if (current) {
        const update=await tx.prepare(`UPDATE managed_customer_configurations SET
          managed_services_enabled=?,task_reporting_enabled=?,project_reporting_enabled=?,maintenance_visit_reporting_enabled=?,
          recommendation_tracking_enabled=?,include_in_managed_services_reports=?,responsible_team_id=?,service_manager_id=?,
          reporting_frequency=?,default_report_template_id=?,version=?,updated_by=?,updated_at=app_now()
          WHERE customer_id=? AND version=?`).run(
          req.body.managed_services_enabled?1:0,req.body.task_reporting_enabled?1:0,req.body.project_reporting_enabled?1:0,
          req.body.maintenance_visit_reporting_enabled?1:0,req.body.recommendation_tracking_enabled?1:0,
          req.body.include_in_managed_services_reports?1:0,responsibleTeamId,serviceManagerId,frequency || null,defaultTemplateId,
          nextVersion,req.user.id,id,Number(req.body.version));
        if (update.changes!==1) fail('This configuration changed after you opened it. Reload and try again.',409);
      } else {
        await tx.prepare(`INSERT INTO managed_customer_configurations
          (customer_id,managed_services_enabled,task_reporting_enabled,project_reporting_enabled,maintenance_visit_reporting_enabled,
           recommendation_tracking_enabled,include_in_managed_services_reports,responsible_team_id,service_manager_id,reporting_frequency,
           default_report_template_id,version,updated_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,req.body.managed_services_enabled?1:0,req.body.task_reporting_enabled?1:0,
          req.body.project_reporting_enabled?1:0,req.body.maintenance_visit_reporting_enabled?1:0,req.body.recommendation_tracking_enabled?1:0,
          req.body.include_in_managed_services_reports?1:0,responsibleTeamId,serviceManagerId,frequency || null,defaultTemplateId,nextVersion,req.user.id);
      }
      await tx.prepare('UPDATE customers SET service_activity_enabled=? WHERE id=?').run(req.body.service_activity_tracking_enabled?1:0,id);

      const existingTicket=await tx.prepare("SELECT * FROM customer_ticketing_configurations WHERE customer_id=? AND provider_type='request_tracker'").get(id);
      if (!queueId) {
        if (req.body.ticket_integration_enabled) fail('Select an RT queue before enabling ticket integration');
        if (existingTicket) await tx.prepare('DELETE FROM customer_ticketing_configurations WHERE id=?').run(existingTicket.id);
      } else if (existingTicket) {
        await tx.prepare(`UPDATE customer_ticketing_configurations SET external_queue_id=?,external_queue_name=?,enabled=?,include_in_reporting=?,
          write_back_enabled=?,write_back_status=?,version=version+1,updated_at=app_now() WHERE id=?`).run(
          queueId,queueName,req.body.ticket_integration_enabled?1:0,req.body.ticket_include_in_reporting?1:0,
          req.body.ticket_write_back_enabled?1:0,writeBackStatus || null,existingTicket.id);
      } else {
        await tx.prepare(`INSERT INTO customer_ticketing_configurations
          (customer_id,provider_type,external_queue_id,external_queue_name,enabled,include_in_reporting,write_back_enabled,write_back_status)
          VALUES (?,'request_tracker',?,?,?,?,?,?)`).run(
          id,queueId,queueName,req.body.ticket_integration_enabled?1:0,req.body.ticket_include_in_reporting?1:0,
          req.body.ticket_write_back_enabled?1:0,writeBackStatus || null);
      }
      return nextVersion;
    });
    await logAudit(db,req,'customer',id,`Customer ${id}`,'managed_services_configuration_updated',`managed=${req.body.managed_services_enabled}; ticketing=${req.body.ticket_integration_enabled}; write_back=${req.body.ticket_write_back_enabled}; queue_id=${queueId || 'none'}; version=${result}`);
    const customer=await db.prepare('SELECT id,service_activity_enabled FROM customers WHERE id=?').get(id);
    const managed=await db.prepare('SELECT * FROM managed_customer_configurations WHERE customer_id=?').get(id);
    const ticket=await db.prepare("SELECT * FROM customer_ticketing_configurations WHERE customer_id=? AND provider_type='request_tracker'").get(id);
    res.json(responseShape(customer,managed,ticket));
  } catch(error) {
    if (error.code==='23505') {
      const message=String(error.constraint || '').includes('managed_customer_configurations')
        ? 'This configuration changed after you opened it. Reload and try again.'
        : 'This RT queue is already assigned to another managed customer';
      return res.status(409).json({ error:message });
    }
    res.status(error.status || 500).json({ error:error.status ? error.message : 'Could not save managed customer configuration' });
  }
});

router.post('/test-mapping',requireManager,async (req,res) => {
  try {
    const id=await customerId(req);
    const mapping=await db.prepare("SELECT * FROM customer_ticketing_configurations WHERE customer_id=? AND provider_type='request_tracker' AND enabled=1").get(id);
    if (!mapping) fail('Enable and save an RT queue mapping before testing it');
    const stored=await ticketingSettings.storedSettings();
    const provider=createTicketingProvider('request_tracker',ticketingSettings.runtimeSettings(stored));
    const queue=await provider.getQueue(mapping.external_queue_id);
    res.json({ ok:true,queue,message:`RT queue ${queue.name} (${queue.id}) is accessible` });
  } catch(error) { res.status(error.status || 502).json({ error:error.status ? error.message : 'Could not test the RT queue mapping' }); }
});

module.exports=router;
