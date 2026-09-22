import { useEffect,useState } from 'react';
import { CheckCircle2,RefreshCw,Save,Settings2,ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { Toggle } from '../pages/admin/shared';

const DEFAULTS={ managed_services_enabled:false,service_activity_tracking_enabled:false,task_reporting_enabled:true,project_reporting_enabled:true,maintenance_visit_reporting_enabled:true,recommendation_tracking_enabled:true,include_in_managed_services_reports:true,responsible_team_id:null,service_manager_id:null,reporting_frequency:'',default_report_template_id:null,ticket_integration_enabled:false,ticket_include_in_reporting:true,ticket_write_back_enabled:false,ticket_write_back_status:'',external_queue_id:'',external_queue_name:'',version:0 };
const REPORTING=[['task_reporting_enabled','Tasks'],['project_reporting_enabled','Projects'],['maintenance_visit_reporting_enabled','Maintenance visits'],['recommendation_tracking_enabled','Recommendations']];

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
    try { const saved=await api.saveManagedCustomerConfiguration(customerId,form);setForm({ ...DEFAULTS,...saved });setSavedMapping({ enabled:!!saved.ticket_integration_enabled,queueId:String(saved.external_queue_id || '') });setMessage('Managed customer configuration saved.'); }
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

  if (loading) return <div className="card managed-config"><p role="status" className="text-muted">Loading managed customer configuration...</p></div>;
  const storedQueueMissing=form.external_queue_id && !queues.some(queue => String(queue.id)===String(form.external_queue_id));
  return <div className="managed-config">
    {error && <div className="error-msg" role="alert">{error}</div>}
    {message && <div className="alert alert-success" role="status"><CheckCircle2 size={15} /> {message}</div>}

    <section className="card managed-config-section">
      <div className="managed-config-heading"><Settings2 size={20} /><div><h2>Managed Services</h2><p>Controls whether this customer appears in the Managed Customers module and which operational data can be reported.</p></div><Toggle checked={form.managed_services_enabled} onChange={value => setForm(current => ({ ...current,managed_services_enabled:value,ticket_integration_enabled:value ? current.ticket_integration_enabled : false,ticket_write_back_enabled:value ? current.ticket_write_back_enabled : false }))} label={form.managed_services_enabled ? 'Enabled' : 'Disabled'} /></div>
      <div className="managed-config-grid">
        <label>Responsible team<select value={form.responsible_team_id || ''} onChange={event => set('responsible_team_id',event.target.value ? Number(event.target.value) : null)}><option value="">Not assigned</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select><small>Only teams already assigned to this customer are available.</small></label>
        <label>Service manager<select value={form.service_manager_id || ''} onChange={event => set('service_manager_id',event.target.value ? Number(event.target.value) : null)}><option value="">Not assigned</option>{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
        <label>Reporting frequency<select value={form.reporting_frequency} onChange={event => set('reporting_frequency',event.target.value)}><option value="">Not scheduled</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannual">Twice yearly</option><option value="annual">Annual</option></select></label>
        <label>Default report template<select value={form.default_report_template_id || ''} onChange={event => set('default_report_template_id',event.target.value?Number(event.target.value):null)}><option value="">No default</option>{reportTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      </div>
      <div className="managed-config-options">
        <Toggle checked={form.service_activity_tracking_enabled} onChange={value => set('service_activity_tracking_enabled',value)} label="Service activity tracking" />
        <Toggle checked={form.include_in_managed_services_reports} onChange={value => set('include_in_managed_services_reports',value)} label="Include in managed-service reports" />
        {REPORTING.map(([key,label]) => <Toggle key={key} checked={form[key]} onChange={value => set(key,value)} label={`${label} reporting`} />)}
      </div>
    </section>

    <section className="card managed-config-section">
      <div className="managed-config-heading"><ShieldCheck size={20} /><div><h2>Request Tracker queue</h2><p>Each managed customer can use one RT queue, and a queue cannot be assigned to another customer.</p></div><Toggle checked={form.ticket_integration_enabled} onChange={value => setForm(current => ({ ...current,ticket_integration_enabled:value,managed_services_enabled:value ? true : current.managed_services_enabled,ticket_write_back_enabled:value ? current.ticket_write_back_enabled : false }))} label={form.ticket_integration_enabled ? 'Enabled' : 'Disabled'} /></div>
      <div className="managed-config-grid">
        <label>RT queue<select value={form.external_queue_id} onChange={event => selectQueue(event.target.value)}><option value="">No queue mapped</option>{storedQueueMissing && <option value={form.external_queue_id}>{form.external_queue_name} ({form.external_queue_id})</option>}{queues.map(queue => <option key={queue.id} value={queue.id} disabled={!!queue.mapping && Number(queue.mapping.customer_id)!==Number(customerId)}>{queue.name} ({queue.id}){queue.mapping ? ` — mapped to ${queue.mapping.customer_name}` : ''}</option>)}</select></label>
        <label>Queue ID<input value={form.external_queue_id} readOnly placeholder="Discover and select a queue" /></label>
        <label>Last successful sync<input value={form.last_successful_sync_at || 'No successful sync yet'} readOnly /></label>
      </div>
      <div className="managed-config-options"><Toggle checked={form.ticket_include_in_reporting} onChange={value => set('ticket_include_in_reporting',value)} label="Include tickets in reports" /></div>
      <div className="managed-config-options">
        <Toggle checked={form.ticket_write_back_enabled} onChange={value => setForm(current => ({ ...current,ticket_write_back_enabled:value }))} label="Update the RT ticket status when a matching activity is completed" disabled={!form.ticket_integration_enabled} />
      </div>
      {form.ticket_write_back_enabled && (
        <div className="managed-config-grid">
          <label>
            RT status to set on completion
            <input value={form.ticket_write_back_status} onChange={event => set('ticket_write_back_status',event.target.value)} placeholder="e.g. resolved" maxLength={100} />
          </label>
        </div>
      )}
      {form.ticket_write_back_enabled && <p className="text-sm text-muted" style={{ marginTop:-8 }}>
        An engineer's Ticket Reference on a service activity is matched against this customer's synced RT tickets (by number, ignoring any "RT#"/"#" prefix). When that activity is marked Completed, the matched ticket's Status is set to the value above.
      </p>}
      <div className="flex gap-8 managed-config-actions">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={discoverQueues}><RefreshCw size={14} /> {busy==='queues' ? 'Discovering...' : 'Discover queues'}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy || !savedMapping.enabled || !savedMapping.queueId || savedMapping.queueId!==String(form.external_queue_id)} onClick={testMapping}>{busy==='test' ? 'Testing...' : 'Test saved mapping'}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy || !savedMapping.enabled || !savedMapping.queueId || savedMapping.queueId!==String(form.external_queue_id)} onClick={syncTickets}>{busy==='sync' ? 'Synchronizing...' : 'Sync tickets now'}</button>
      </div>
    </section>

    <button type="button" className="btn btn-primary" disabled={!!busy} onClick={save}><Save size={14} /> {busy==='save' ? 'Saving...' : 'Save configuration'}</button>
  </div>;
}
