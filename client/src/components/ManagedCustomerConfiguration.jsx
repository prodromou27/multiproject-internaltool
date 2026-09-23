import { useEffect,useState } from 'react';
import { AlertTriangle,Building2,CheckCircle2,ExternalLink,FileText,RefreshCw,Save,Settings2,ShieldCheck,Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Toggle,ToggleRow } from '../pages/admin/shared';

const DEFAULTS={ managed_services_enabled:false,service_activity_tracking_enabled:false,task_reporting_enabled:true,project_reporting_enabled:true,maintenance_visit_reporting_enabled:true,recommendation_tracking_enabled:true,include_in_managed_services_reports:true,responsible_team_id:null,service_manager_id:null,reporting_frequency:'',default_report_template_id:null,ticket_integration_enabled:false,ticket_include_in_reporting:true,ticket_write_back_enabled:false,ticket_write_back_status:'',external_queue_id:'',external_queue_name:'',version:0 };
const DELIVERY=[
  ['service_activity_tracking_enabled','Service activity tracking','Log engineer time and work against this customer.'],
  ['maintenance_visit_reporting_enabled','Maintenance visits','Include scheduled and completed visits in managed reporting.'],
  ['project_reporting_enabled','Projects','Include project delivery status in managed reporting.'],
  ['task_reporting_enabled','Tasks','Include task progress in managed reporting.'],
  ['recommendation_tracking_enabled','Recommendations','Include open and resolved recommendations in managed reporting.'],
];

/* Mirrors the state vocabulary the server already uses for the health-strip
   card (not_enabled / setup_required / sync_attention / active), computed
   here against the live, unsaved form so the banner updates as the manager
   edits — and lists exactly what's missing, which the server-side state
   alone doesn't need to. */
function configState(form) {
  if (!form.managed_services_enabled) return { state:'not_enabled',missing:[] };
  const missing=[];
  if (!form.responsible_team_id) missing.push('No responsible team is assigned');
  if (!form.service_manager_id) missing.push('No service manager is assigned');
  if (!form.ticket_integration_enabled) missing.push('Ticketing integration is not enabled');
  else if (!form.external_queue_id) missing.push('No Request Tracker queue is selected');
  const syncFailed=form.ticket_integration_enabled && !!form.external_queue_id && form.last_sync_status && form.last_sync_status!=='success';
  if (syncFailed) missing.push('The last ticket synchronization failed');
  if (!missing.length) return { state:'active',missing:[] };
  return { state: syncFailed && missing.length===1 ? 'sync_attention' : 'setup_required',missing };
}

const BANNER_COPY={
  not_enabled:{ icon:Settings2,tone:'neutral',title:'Managed Services is not enabled',body:'Turn it on below to assign a responsible team, connect ticketing and include this customer in managed-service reporting.' },
  setup_required:{ icon:AlertTriangle,tone:'warning',title:'Managed Services is enabled, but setup is incomplete',body:'This customer won’t report correctly until the following is finished:' },
  sync_attention:{ icon:AlertTriangle,tone:'danger',title:'Managed Services needs attention',body:'Everything is configured, but the ticket connection needs a check.' },
  active:{ icon:CheckCircle2,tone:'success',title:'Managed Services is fully configured',body:'This customer is enrolled, ticketing is connected and reporting is set up.' },
};

function ConfigStateBanner({ config,customerId }) {
  const copy=BANNER_COPY[config.state];
  return <div className={`msc-banner msc-banner-${copy.tone}`} role="status">
    <copy.icon size={18} aria-hidden="true" />
    <div className="msc-banner-body">
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      {config.missing.length>0 && <ul>{config.missing.map(item => <li key={item}>{item}</li>)}</ul>}
    </div>
    {config.state==='active' && <Link className="btn btn-primary btn-sm" to={`/managed-customers/${customerId}`}><ExternalLink size={13} /> Open Managed Services Dashboard</Link>}
  </div>;
}

export default function ManagedCustomerConfiguration({ customerId }) {
  const [form,setForm]=useState(DEFAULTS),[teams,setTeams]=useState([]),[managers,setManagers]=useState([]),[queues,setQueues]=useState([]),[reportTemplates,setReportTemplates]=useState([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[savedMapping,setSavedMapping]=useState({ enabled:false,queueId:'' });
  const set=(key,value) => setForm(current => ({ ...current,[key]:value }));

  useEffect(() => {
    const controller=new AbortController();setLoading(true);setError('');
    Promise.all([api.managedCustomerConfiguration(customerId,{ signal:controller.signal }),api.customerTeams(customerId),api.users({ signal:controller.signal }),api.managedReportTemplates({ signal:controller.signal })])
      .then(([configuration,assignedTeams,users,templates]) => { if (!controller.signal.aborted) { setForm({ ...DEFAULTS,...configuration });setSavedMapping({ enabled:!!configuration.ticket_integration_enabled,queueId:String(configuration.external_queue_id || '') });setTeams(assignedTeams || []);setManagers((users || []).filter(user => user.role==='manager' && user.active!==0));setReportTemplates((templates.rows || []).filter(template => template.active)); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[customerId]);

  async function discoverQueues() {
    setBusy('queues');setError('');setMessage('');
    try { const result=await api.ticketingQueues();setQueues(result.rows || []);setMessage(`${result.rows?.length || 0} RT queue(s) discovered.`); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }

  async function save() {
    setBusy('save');setError('');setMessage('');
    try { const saved=await api.saveManagedCustomerConfiguration(customerId,form);setForm({ ...DEFAULTS,...saved });setSavedMapping({ enabled:!!saved.ticket_integration_enabled,queueId:String(saved.external_queue_id || '') });setMessage('Service configuration saved.'); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }

  async function testMapping() {
    setBusy('test');setError('');setMessage('');
    try { const result=await api.testManagedCustomerMapping(customerId);setMessage(result.message); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }

  async function syncTickets() {
    setBusy('sync');setError('');setMessage('');
    try {
      const result=await api.syncManagedCustomerTickets(customerId);
      setForm(current => ({ ...current,last_successful_sync_at:result.completed_at || current.last_successful_sync_at,last_sync_status:'success' }));
      setMessage(`Ticket sync completed: ${result.tickets_created} created and ${result.tickets_updated} updated.`);
    } catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }

  function selectQueue(value) {
    const queue=queues.find(item => String(item.id)===value);
    setForm(current => ({ ...current,external_queue_id:value,external_queue_name:queue?.name || (value===String(current.external_queue_id) ? current.external_queue_name : ''),...(value ? {} : { ticket_integration_enabled:false }) }));
  }

  if (loading) return <div className="card msc-shell"><p role="status" className="text-muted">Loading service configuration...</p></div>;
  const storedQueueMissing=form.external_queue_id && !queues.some(queue => String(queue.id)===String(form.external_queue_id));
  const config=configState(form);
  const mappingUnsaved=savedMapping.queueId!==String(form.external_queue_id);

  return <div className="msc">
    {error && <div className="error-msg" role="alert">{error}</div>}
    {message && <div className="alert alert-success" role="status"><CheckCircle2 size={15} /> {message}</div>}
    <ConfigStateBanner config={config} customerId={customerId} />

    <div className="card msc-shell">
      <header className="msc-shell-head">
        <div><h2>Service Configuration</h2><p>Managed Services enrollment, ticketing integration and reporting for this customer — one save applies everything below.</p></div>
        <Toggle checked={form.managed_services_enabled} onChange={value => setForm(current => ({ ...current,managed_services_enabled:value,ticket_integration_enabled:value ? current.ticket_integration_enabled : false,ticket_write_back_enabled:value ? current.ticket_write_back_enabled : false }))} label={form.managed_services_enabled ? 'Enabled' : 'Disabled'} />
      </header>

      <section className="msc-group">
        <div className="msc-group-head"><Building2 size={16} aria-hidden="true" /><div><h3>Ownership</h3><p>Who is responsible for delivering managed service to this customer.</p></div></div>
        <div className="msc-group-body">
          <label className="msc-field msc-field-primary">
            <span>Responsible team</span>
            <select value={form.responsible_team_id || ''} onChange={event => set('responsible_team_id',event.target.value ? Number(event.target.value) : null)}>
              <option value="">Not assigned</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            {teams.length===0
              ? <small className="msc-hint">No team is assigned to this customer yet. <Link to="/customers">Assign one from Customers</Link>, then choose it here.</small>
              : <small>Only teams already assigned to this customer are available.</small>}
          </label>
          <label className="msc-field">
            <span>Service manager</span>
            <select value={form.service_manager_id || ''} onChange={event => set('service_manager_id',event.target.value ? Number(event.target.value) : null)}>
              <option value="">Not assigned</option>
              {managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="msc-group">
        <div className="msc-group-head"><Ticket size={16} aria-hidden="true" /><div><h3>Ticketing integration</h3><p>Connect a Request Tracker queue so tickets sync automatically. Each queue can only be mapped to one customer.</p></div>
          <Toggle checked={form.ticket_integration_enabled} onChange={value => setForm(current => ({ ...current,ticket_integration_enabled:value,managed_services_enabled:value ? true : current.managed_services_enabled,ticket_write_back_enabled:value ? current.ticket_write_back_enabled : false }))} label={form.ticket_integration_enabled ? 'Enabled' : 'Disabled'} />
        </div>
        <div className="msc-group-body">
          <label className="msc-field">
            <span>RT queue</span>
            <select value={form.external_queue_id} onChange={event => selectQueue(event.target.value)}>
              <option value="">No queue mapped</option>
              {storedQueueMissing && <option value={form.external_queue_id}>{form.external_queue_name} ({form.external_queue_id})</option>}
              {queues.map(queue => <option key={queue.id} value={queue.id} disabled={!!queue.mapping && Number(queue.mapping.customer_id)!==Number(customerId)}>{queue.name} ({queue.id}){queue.mapping ? ` — mapped to ${queue.mapping.customer_name}` : ''}</option>)}
            </select>
          </label>
          <div className="msc-status-pair">
            <div><span>Last successful sync</span><strong>{form.last_successful_sync_at || 'No successful sync yet'}</strong></div>
            <div><span>Last sync status</span><strong className={form.last_sync_status && form.last_sync_status!=='success' ? 'msc-status-bad' : ''}>{form.last_sync_status || 'No sync recorded'}</strong></div>
          </div>
        </div>
        <ToggleRow label="Include tickets in reports" description="Managed-service reports include this customer's ticket activity." value={form.ticket_include_in_reporting} onChange={value => set('ticket_include_in_reporting',value)} />
        <ToggleRow label="Update the RT ticket on completion" description="When a matching service activity is marked Completed, set its RT ticket to the status below." value={form.ticket_write_back_enabled} onChange={value => set('ticket_write_back_enabled',value)} />
        {form.ticket_write_back_enabled && <div className="msc-group-body msc-group-body-tight">
          <label className="msc-field">
            <span>RT status to set on completion</span>
            <input value={form.ticket_write_back_status} onChange={event => set('ticket_write_back_status',event.target.value)} placeholder="e.g. resolved" maxLength={100} />
            <small>Matched by an activity's Ticket Reference against this customer's synced RT tickets (by number, ignoring any "RT#"/"#" prefix).</small>
          </label>
        </div>}
        <div className="flex gap-8 msc-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={discoverQueues}><RefreshCw size={13} /> {busy==='queues' ? 'Discovering...' : 'Discover queues'}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !savedMapping.enabled || !savedMapping.queueId || mappingUnsaved} onClick={testMapping} title={mappingUnsaved ? 'Save this queue mapping first' : undefined}>{busy==='test' ? 'Testing...' : 'Test saved mapping'}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !savedMapping.enabled || !savedMapping.queueId || mappingUnsaved} onClick={syncTickets} title={mappingUnsaved ? 'Save this queue mapping first' : undefined}>{busy==='sync' ? 'Synchronizing...' : 'Sync tickets now'}</button>
        </div>
      </section>

      <section className="msc-group">
        <div className="msc-group-head"><ShieldCheck size={16} aria-hidden="true" /><div><h3>Service delivery</h3><p>What operational activity is tracked and reported for this customer.</p></div></div>
        <div className="msc-group-body msc-group-body-rows">
          {DELIVERY.map(([key,label,description]) => <ToggleRow key={key} label={label} description={description} value={form[key]} onChange={value => set(key,value)} />)}
        </div>
      </section>

      <section className="msc-group">
        <div className="msc-group-head"><FileText size={16} aria-hidden="true" /><div><h3>Reporting</h3><p>How and how often this customer's managed report is prepared.</p></div></div>
        <div className="msc-group-body">
          <label className="msc-field">
            <span>Reporting frequency</span>
            <select value={form.reporting_frequency} onChange={event => set('reporting_frequency',event.target.value)}>
              <option value="">Not scheduled</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semiannual">Twice yearly</option>
              <option value="annual">Annual</option>
            </select>
          </label>
          <label className="msc-field">
            <span>Default report template</span>
            <select value={form.default_report_template_id || ''} onChange={event => set('default_report_template_id',event.target.value?Number(event.target.value):null)}>
              <option value="">No default</option>
              {reportTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
        </div>
        <div className="msc-group-body msc-group-body-rows">
          <ToggleRow label="Customer reporting enabled" description="Include this customer when managed-service reports are generated." value={form.include_in_managed_services_reports} onChange={value => set('include_in_managed_services_reports',value)} />
        </div>
      </section>

      <footer className="msc-shell-foot">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={save}><Save size={14} /> {busy==='save' ? 'Saving...' : 'Save Service Configuration'}</button>
        {config.state==='active' && <Link className="btn btn-ghost" to={`/managed-customers/${customerId}`}><ExternalLink size={14} /> Open Managed Services Dashboard</Link>}
      </footer>
    </div>
  </div>;
}
