import { useCallback,useEffect,useRef,useState } from 'react';
import { AlertTriangle,CheckCircle2,ChevronDown,ExternalLink,Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Toggle,ToggleRow } from '../pages/admin/shared';

const DEFAULTS={ managed_services_enabled:false,service_activity_tracking_enabled:false,task_reporting_enabled:true,project_reporting_enabled:true,maintenance_visit_reporting_enabled:true,recommendation_tracking_enabled:true,include_in_managed_services_reports:true,responsible_team_id:null,service_manager_id:null,reporting_frequency:'',default_report_template_id:null,ticket_integration_enabled:false,ticket_include_in_reporting:true,ticket_write_back_enabled:false,ticket_write_back_status:'',external_queue_id:'',external_queue_name:'',version:0 };
const TRACKING=[
  ['service_activity_tracking_enabled','Service activity tracking','Log engineer time and work against this customer.'],
  ['maintenance_visit_reporting_enabled','Maintenance visits','Include visits in reports.'],
  ['project_reporting_enabled','Projects','Include project status in reports.'],
  ['task_reporting_enabled','Tasks','Include task progress in reports.'],
  ['recommendation_tracking_enabled','Recommendations','Include recommendations in reports.'],
];

/* Collapsed by default: only the master switch and the team are needed to
   run a managed customer. Everything else is optional and out of the way. */
function Optional({ title,hint,children,defaultOpen=false }) {
  const [open,setOpen]=useState(defaultOpen);
  return <section className="msc-optional">
    <button type="button" className="msc-optional-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><strong>{title}</strong><small>{hint}</small></span><ChevronDown size={16} className={open ? 'is-open' : ''} aria-hidden="true" />
    </button>
    {open && <div className="msc-optional-body">{children}</div>}
  </section>;
}

function SaveStatus({ status,message,onRetry }) {
  if (status==='saving') return <span className="msc-save is-saving"><Loader2 size={13} className="spin" /> Saving…</span>;
  if (status==='error') return <span className="msc-save is-error" role="alert"><AlertTriangle size={13} /> {message} <button type="button" onClick={onRetry}>Retry</button></span>;
  if (status==='saved') return <span className="msc-save is-saved"><CheckCircle2 size={13} /> All changes saved</span>;
  return <span className="msc-save" />;
}

export default function ManagedCustomerConfiguration({ customerId }) {
  const [form,setForm]=useState(DEFAULTS),[allTeams,setAllTeams]=useState([]),[queues,setQueues]=useState([]),[queueError,setQueueError]=useState(''),[reportTemplates,setReportTemplates]=useState([]);
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[status,setStatus]=useState('idle'),[saveError,setSaveError]=useState(''),[busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [creatingTeam,setCreatingTeam]=useState(false),[newTeamName,setNewTeamName]=useState(''),[teamError,setTeamError]=useState('');
  const [engineers,setEngineers]=useState([]),[members,setMembers]=useState([]);

  // Autosave plumbing. The latest form lives in a ref so a save always sends
  // the newest edits; only one save runs at a time and edits made during a
  // save trigger exactly one follow-up save (each success bumps `version`).
  const formRef=useRef(DEFAULTS),timer=useRef(null),running=useRef(false),again=useRef(false),assignedRef=useRef([]);

  const flush=useCallback(async () => {
    if (running.current) { again.current=true; return; }
    running.current=true;setStatus('saving');setSaveError('');
    try {
      do {
        again.current=false;
        const sent=formRef.current;
        const saved=await api.saveManagedCustomerConfiguration(customerId,sent);
        // Adopt server-owned fields only; never overwrite what's being typed.
        formRef.current={ ...formRef.current,version:saved.version,last_successful_sync_at:saved.last_successful_sync_at,last_sync_status:saved.last_sync_status };
        setForm(formRef.current);
      } while (again.current);
      setStatus('saved');
    } catch(failure) { setStatus('error');setSaveError(failure.message); }
    finally { running.current=false; }
  },[customerId]);

  const update=useCallback((changes,{ delay=350 }={}) => {
    formRef.current={ ...formRef.current,...changes };
    setForm(formRef.current);setStatus('saving');
    clearTimeout(timer.current);timer.current=setTimeout(() => { timer.current=null;flush(); },delay);
  },[flush]);
  // Leaving the tab with an edit still waiting on its debounce must not lose it:
  // flush whatever is pending on the way out instead of just cancelling the timer.
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current);flushRef.current(); } },[]);

  useEffect(() => {
    const controller=new AbortController();setLoading(true);setLoadError('');
    Promise.all([api.managedCustomerConfiguration(customerId,{ signal:controller.signal }),api.customerTeams(customerId),api.teams({ signal:controller.signal }),api.managedReportTemplates({ signal:controller.signal }),api.users({ signal:controller.signal })])
      .then(([configuration,assigned,teams,templates,users]) => {
        if (controller.signal.aborted) return;
        formRef.current={ ...DEFAULTS,...configuration };setForm(formRef.current);
        assignedRef.current=(assigned || []).map(team => team.id);
        setAllTeams(teams || []);setEngineers((users || []).filter(user => user.role==='engineer' && user.active!==0));setReportTemplates((templates.rows || []).filter(template => template.active));
      })
      .catch(failure => { if (!controller.signal.aborted) setLoadError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[customerId]);

  // Members of the chosen team, managed right here so setup never needs a
  // trip to Settings.
  const teamId=form.responsible_team_id;
  useEffect(() => {
    if (!teamId) { setMembers([]); return undefined; }
    const controller=new AbortController();
    api.team(teamId).then(team => { if (!controller.signal.aborted) setMembers((team.members || []).map(member => member.id)); }).catch(() => {});
    return () => controller.abort();
  },[teamId]);

  async function setTeamMembers(ids) {
    const previous=members;setMembers(ids);setTeamError('');
    try { await api.setTeamMembers(teamId,ids); } catch(failure) { setMembers(previous);setTeamError(failure.message); }
  }

  async function createTeam(event) {
    event.preventDefault();
    const name=newTeamName.trim();if (!name) return;
    setTeamError('');
    try {
      const created=await api.createTeam({ name,service_activity_enabled:false });
      setAllTeams(current => [...current,{ id:created.id,name }]);
      setCreatingTeam(false);setNewTeamName('');
      await chooseTeam(String(created.id));
    } catch(failure) { setTeamError(failure.message); }
  }

  async function chooseTeam(value) {
    if (value==='__new__') { setCreatingTeam(true);return; }
    const teamId=value ? Number(value) : null;
    try {
      // Picking a team is the whole job: if it isn't yet assigned to this
      // customer, assign it here instead of sending the manager elsewhere.
      if (teamId && !assignedRef.current.includes(teamId)) {
        assignedRef.current=[...assignedRef.current,teamId];
        await api.setCustomerTeams(customerId,assignedRef.current);
      }
      update({ responsible_team_id:teamId },{ delay:0 });
    } catch(failure) { setStatus('error');setSaveError(failure.message); }
  }

  async function loadQueues() {
    setBusy('queues');setQueueError('');
    try { const result=await api.ticketingQueues();setQueues(result.rows || []); }
    catch(failure) { setQueueError(failure.message); } finally { setBusy(''); }
  }

  function chooseQueue(value) {
    const queue=queues.find(item => String(item.id)===value);
    // A queue IS the ticketing connection: choosing one turns it on, clearing turns it off.
    update(value
      ? { external_queue_id:value,external_queue_name:queue?.name || formRef.current.external_queue_name,ticket_integration_enabled:true }
      : { external_queue_id:'',external_queue_name:'',ticket_integration_enabled:false,ticket_write_back_enabled:false },{ delay:0 });
  }

  async function syncTickets() {
    setBusy('sync');setMessage('');
    try { const result=await api.syncManagedCustomerTickets(customerId);setMessage(`Synced: ${result.tickets_created} new, ${result.tickets_updated} updated.`); }
    catch(failure) { setMessage(failure.message); } finally { setBusy(''); }
  }

  if (loading) return <div className="card msc-shell"><p role="status" className="text-muted">Loading…</p></div>;
  if (loadError) return <div className="error-msg" role="alert">{loadError}</div>;

  const enabled=form.managed_services_enabled;
  const hasTeam=!!form.responsible_team_id;
  const storedQueueMissing=form.external_queue_id && !queues.some(queue => String(queue.id)===String(form.external_queue_id));
  const syncBad=form.ticket_integration_enabled && form.last_sync_status && form.last_sync_status!=='success';

  return <div className="msc">
    <div className="card msc-shell">
      <header className="msc-shell-head">
        <div>
          <h2>Managed Services</h2>
          <p>{enabled ? 'This customer is a managed customer.' : 'Turn on to track this customer as a managed customer.'}</p>
        </div>
        <div className="msc-head-side">
          <SaveStatus status={status} message={saveError} onRetry={flush} />
          <Toggle checked={enabled} onChange={value => update({ managed_services_enabled:value,...(value ? {} : { ticket_integration_enabled:false,ticket_write_back_enabled:false }) },{ delay:0 })} label={enabled ? 'On' : 'Off'} />
        </div>
      </header>

      {enabled && <>
        <section className="msc-group">
          <label className="msc-field msc-field-primary">
            <span>Responsible team</span>
            <select value={form.responsible_team_id || ''} onChange={event => chooseTeam(event.target.value)}>
              <option value="">Select a team…</option>
              {allTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              <option value="__new__">+ Create a new team…</option>
            </select>
            {!hasTeam && <small className="msc-hint">Choose the team that owns this customer — that's the only required step.</small>}
          </label>
          {creatingTeam && <form className="msc-inline-form" onSubmit={createTeam}>
            <input autoFocus value={newTeamName} onChange={event => setNewTeamName(event.target.value)} placeholder="New team name" maxLength={120} />
            <button className="btn btn-primary btn-sm" disabled={!newTeamName.trim()}>Create &amp; use</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreatingTeam(false);setNewTeamName(''); }}>Cancel</button>
          </form>}
          {teamError && <p className="msc-hint" role="alert">{teamError}</p>}
          {hasTeam && <div className="msc-members">
            <span className="msc-members-label">Team members</span>
            <div className="flex gap-6 flex-wrap items-center">
              {members.map(id => <span key={id} className="badge badge-open inline-flex items-center gap-4">{engineers.find(user => user.id===id)?.name || `User ${id}`}<button type="button" aria-label="Remove member" onClick={() => setTeamMembers(members.filter(item => item!==id))}>×</button></span>)}
              <select value="" aria-label="Add engineer to team" onChange={event => { const id=Number(event.target.value); if (id) setTeamMembers([...members,id]); }}>
                <option value="">{members.length ? 'Add another engineer…' : 'Add an engineer…'}</option>
                {engineers.filter(user => !members.includes(user.id)).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
          </div>}
          {hasTeam && !syncBad && <p className="msc-ok"><CheckCircle2 size={14} /> Set up. <Link to={`/managed-customers/${customerId}`}>Open the Managed Customers dashboard <ExternalLink size={12} /></Link></p>}
          {syncBad && <p className="msc-hint"><AlertTriangle size={13} /> The last ticket sync failed — check Request Tracker under Settings → Integrations.</p>}
        </section>

        <Optional title="Ticketing" hint="Optional — connect a Request Tracker queue to see this customer's tickets" defaultOpen={!!form.external_queue_id}>
          <label className="msc-field">
            <span>Request Tracker queue</span>
            <select value={form.external_queue_id} onFocus={() => { if (!queues.length && !busy) loadQueues(); }} onChange={event => chooseQueue(event.target.value)}>
              <option value="">No ticketing</option>
              {storedQueueMissing && <option value={form.external_queue_id}>{form.external_queue_name} ({form.external_queue_id})</option>}
              {queues.map(queue => <option key={queue.id} value={queue.id} disabled={!!queue.mapping && Number(queue.mapping.customer_id)!==Number(customerId)}>{queue.name} ({queue.id}){queue.mapping && Number(queue.mapping.customer_id)!==Number(customerId) ? ` — used by ${queue.mapping.customer_name}` : ''}</option>)}
            </select>
            {busy==='queues' && <small>Loading queues…</small>}
            {queueError && <small className="msc-hint">{queueError}</small>}
          </label>
          {form.external_queue_id && <>
            <p className="text-sm text-muted">Last sync: {form.last_successful_sync_at || 'not yet'}{form.last_sync_status ? ` (${form.last_sync_status})` : ''}</p>
            <ToggleRow label="Include tickets in reports" value={form.ticket_include_in_reporting} onChange={value => update({ ticket_include_in_reporting:value })} />
            <ToggleRow label="Update the RT ticket when an activity is completed" description="Set the matched ticket to the status below." value={form.ticket_write_back_enabled} onChange={value => update({ ticket_write_back_enabled:value })} />
            {form.ticket_write_back_enabled && <label className="msc-field"><span>RT status to set</span><input value={form.ticket_write_back_status} maxLength={100} placeholder="e.g. resolved" onChange={event => update({ ticket_write_back_status:event.target.value },{ delay:900 })} /></label>}
            <div className="flex gap-8 msc-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || status==='saving'} onClick={syncTickets}>{busy==='sync' ? 'Syncing…' : 'Sync tickets now'}</button>
              {message && <span className="text-sm text-muted">{message}</span>}
            </div>
          </>}
        </Optional>

        <Optional title="Reporting" hint="Optional — how often and in what format reports are prepared">
          <div className="msc-group-body">
            <label className="msc-field"><span>Frequency</span>
              <select value={form.reporting_frequency} onChange={event => update({ reporting_frequency:event.target.value },{ delay:0 })}>
                <option value="">Not scheduled</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannual">Twice yearly</option><option value="annual">Annual</option>
              </select>
            </label>
            <label className="msc-field"><span>Default template</span>
              <select value={form.default_report_template_id || ''} onChange={event => update({ default_report_template_id:event.target.value ? Number(event.target.value) : null },{ delay:0 })}>
                <option value="">No default</option>{reportTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          </div>
          <ToggleRow label="Include this customer in managed reports" value={form.include_in_managed_services_reports} onChange={value => update({ include_in_managed_services_reports:value })} />
        </Optional>

        <Optional title="What is tracked" hint="Optional — all on by default except service activity">
          {TRACKING.map(([key,label,description]) => <ToggleRow key={key} label={label} description={description} value={form[key]} onChange={value => update({ [key]:value })} />)}
        </Optional>
      </>}
    </div>
  </div>;
}
