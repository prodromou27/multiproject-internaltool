import { useCallback, useEffect, useState } from 'react';
import { DraftBanner, useFormDraft } from '../hooks/useFormDraft';
import { EditConflict, useEditVersion, yesNo } from '../hooks/useEditVersion';
import { Link, useLocation } from 'react-router-dom';
import { Archive, ArchiveRestore, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import { Modal, fmtDate } from '../components/Shared';
import ImportModal from '../components/ImportModal';
import { HeaderMenu, PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch, ResultContext } from '../components/ListWorkspace';
import { DataTable,MetricStrip,Pagination,Surface,ToneBadge } from '../components/EnterpriseUI';
import { ReportDueBadge } from '../components/ReportDue';
import { useAuth } from '../App';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useLiveRefresh } from '../live';

/* Customer 360 → Edit details: the same form as on Customers, for one customer. */
export function EditCustomerDialog({ customer, onSaved, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user?.role === 'manager';
  const [initial, setInitial] = useState(null), [teams, setTeams] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      isManager ? api.teams({ signal: controller.signal }).catch(() => []) : [],
      isManager ? api.customerTeams(customer.id).catch(() => []) : [],
    ]).then(([allTeams, customerTeams]) => {
      if (controller.signal.aborted) return;
      setTeams(allTeams);
      setInitial({ ...customer, ...(isManager ? { team_ids: customerTeams.map(team => team.id) } : {}) });
    });
    return () => controller.abort();
  }, [customer, isManager]);
  if (!initial) return null;
  return <Modal title="Edit Customer" onClose={onClose}>
    <CustomerForm initial={initial} teams={isManager ? teams : null}
      onSave={async data => { await api.updateCustomer(customer.id, data); toast.success('Customer updated'); return customer.id; }}
      onSaveTeams={isManager ? async (id, teamIds) => { await api.setCustomerTeams(id, teamIds); } : null}
      onCreateTeam={isManager ? async name => { const created = await api.createTeam({ name, service_activity_enabled: false }); setTeams(current => [...current, { id: created.id, name }]); return created.id; } : null}
      onClose={() => { onSaved(); onClose(); }} />
  </Modal>;
}

const CUSTOMER_FIELDS = [
  ['name', 'Name'], ['project_name', 'Project name'], ['active', 'Active', yesNo], ['is_internal', 'Internal', yesNo],
  ['contact_name', 'Contact'], ['contact_email', 'Email'], ['contact_phone', 'Phone'], ['primary_contact', 'Primary contact'],
  ['address', 'Address'], ['location', 'Location'], ['notes', 'Notes'], ['contract_type', 'Contract type'],
  ['contract_start_date', 'Contract start'], ['contract_end_date', 'Contract end'], ['reporting_frequency', 'Reporting'],
  ['service_notes', 'Service notes'],
];

function CustomerForm({ initial, teams, onSave, onSaveTeams, onCreateTeam, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(() => initial ? { ...initial, is_internal: !!initial.is_internal } : {
    name: '', project_name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '',
    active: true, service_activity_enabled: false, primary_contact: '', location: '',
    contract_type: '', contract_start_date: '', contract_end_date: '', reporting_frequency: '',
    service_notes: '',
    require_duration: false, require_ticket_reference: false, require_technology: false,
    require_category: false, require_notes: false, require_billable_classification: false,
    is_internal: false,
  });
  const [selectedTeams, setSelectedTeams] = useState(() => (initial?.team_ids) || []);
  const [newTeam, setNewTeam] = useState(null); // null = not creating; string = name being typed
  // Engineers added individually, e.g. from another team (managers, with the teams).
  const [people, setPeople] = useState([]), [selectedEngineers, setSelectedEngineers] = useState(null);
  useEffect(() => {
    if (!teams) return undefined;
    let live = true;
    Promise.all([api.users().catch(() => []), initial?.id ? api.customerEngineers(initial.id).catch(() => []) : Promise.resolve([])])
      .then(([users, current]) => { if (!live) return; setPeople(users.filter(person => person.role === 'engineer' && person.active !== 0 && person.active !== false)); setSelectedEngineers(current.map(person => person.id)); });
    return () => { live = false; };
  }, [!!teams, initial?.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- once per form, not when a team is added
  const [showService, setShowService] = useState(!!initial?.service_activity_enabled);
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setBool = k => e => setForm(f => ({ ...f, [k]: e.target.checked }));

  const draft = useFormDraft({ name: `customer:${initial?.id || 'new'}`, value: form, base: initial?.updated_at ?? null });
  const edit = useEditVersion(initial);
  async function submit(e) {
    e?.preventDefault(); setSaving(true);
    try {
      const id = await onSave(edit.version === undefined ? form : { ...form, version: edit.version });
      if (onSaveTeams) await onSaveTeams(initial?.id || id, selectedTeams);
      if (teams && selectedEngineers) await api.setCustomerEngineers(initial?.id || id, selectedEngineers);
      draft.clear();
      onClose();
    } catch (err) { if (!edit.caught(err)) toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit}>
      <DraftBanner draft={draft} onRestore={data => data && setForm(data)} />
      <EditConflict edit={edit} what="customer" fields={CUSTOMER_FIELDS} mine={form}
        onKeepMine={() => { edit.keepMine(); submit(); }}
        onUseTheirs={() => { const theirs = edit.takeTheirs(); setForm(f => ({ ...f, ...theirs, is_internal: !!theirs.is_internal })); }} />
      <div className="form-group"><label htmlFor="customer-name">Customer Name *</label><input id="customer-name" value={form.name} onChange={set('name')} required /></div>
      <div className="form-group"><label htmlFor="customer-project-name">Project name</label>
        <input id="customer-project-name" value={form.project_name || ''} onChange={set('project_name')} maxLength={120} aria-describedby="customer-project-name-hint" />
        <small id="customer-project-name-hint" className="text-muted">Optional nickname, shown beside the customer's name and found by search.</small></div>
      <div className="form-group">
        <label className="u-7ff4b47">
          <input type="checkbox" checked={!!form.active} onChange={setBool('active')} className="u-30e741d" /> Active
        </label>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Contact Person</label><input value={form.contact_name} onChange={set('contact_name')} /></div>
        <div className="form-group"><label>Contact Email</label><input type="email" value={form.contact_email} onChange={set('contact_email')} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Phone</label><input value={form.contact_phone} onChange={set('contact_phone')} /></div>
        <div className="form-group"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
      </div>
      <div className="form-group"><label>Notes</label><textarea value={form.notes} onChange={set('notes')} /></div>
      <div className="form-group">
        <label className="u-ea06b0c">
          <input type="checkbox" checked={!!form.is_internal} onChange={setBool('is_internal')} className="u-30e741d" />
          This is our own organisation (in-house infrastructure)
        </label>
        <p className="text-muted text-sm">Track work on your own systems here; several entries can be in-house (for example one per site or company). It gets assets, team assignment and activity tracking like any customer, and in-house entries are listed first.</p>
      </div>

      <details className="column-picker u-96ad609" open={showService} onToggle={e => setShowService(e.target.open)}>
        <summary className="btn btn-ghost btn-sm u-60e32dc">Service Activity Tracking</summary>
        <div className="u-ffb3bf2">
          <div className="form-group">
            <label className="u-ea06b0c">
              <input type="checkbox" checked={!!form.service_activity_enabled} onChange={setBool('service_activity_enabled')} className="u-30e741d" />
              Service Activity Tracking Enabled
            </label>
          </div>
          {teams && (
            <div className="form-group"><label htmlFor="customer-team-add">Assigned Team(s)</label>
              <select id="customer-team-add" value="" onChange={e => { if (e.target.value === '__new__') { setNewTeam(''); return; } const id = Number(e.target.value); if (id && !selectedTeams.includes(id)) setSelectedTeams([...selectedTeams, id]); }}>
                <option value="">{selectedTeams.length ? 'Add another team…' : 'Select a team…'}</option>
                {teams.filter(t => !selectedTeams.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                {onCreateTeam && <option value="__new__">+ Create a new team…</option>}
              </select>
              {newTeam !== null && (
                <div className="flex gap-8 mt-8">
                  <input autoFocus value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="New team name" maxLength={120}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextSibling.click(); } }} />
                  <button type="button" className="btn btn-primary btn-sm" disabled={!newTeam.trim()}
                    onClick={async () => { try { const id = await onCreateTeam(newTeam.trim()); setSelectedTeams(current => [...current, id]); setNewTeam(null); } catch (err) { toast.error(err.message); } }}>Create &amp; add</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewTeam(null)}>Cancel</button>
                </div>
              )}
              {selectedTeams.length > 0 && (
                <div className="flex gap-6 flex-wrap mt-8">
                  {selectedTeams.map(id => (
                    <span key={id} className="badge badge-open inline-flex items-center gap-4">
                      {teams.find(t => t.id === id)?.name || `Team ${id}`}
                      <button type="button" aria-label="Remove team" onClick={() => setSelectedTeams(selectedTeams.filter(x => x !== id))}
                        className="u-d7e0c12">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {teams && selectedEngineers && (
            <div className="form-group"><label htmlFor="customer-engineer-add">Engineers from other teams</label>
              <select id="customer-engineer-add" value="" onChange={e => { const id = Number(e.target.value); if (id && !selectedEngineers.includes(id)) setSelectedEngineers([...selectedEngineers, id]); }}>
                <option value="">{selectedEngineers.length ? 'Add another engineer…' : 'Add an engineer…'}</option>
                {people.filter(person => !selectedEngineers.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <small className="text-muted">They work with this customer like its teams' engineers: they see it, its tasks and assets, and log its activities (under their own team).</small>
              {selectedEngineers.length > 0 && (
                <div className="flex gap-6 flex-wrap mt-8">
                  {selectedEngineers.map(id => (
                    <span key={id} className="badge badge-open inline-flex items-center gap-4">
                      {people.find(person => person.id === id)?.name || `Engineer ${id}`}
                      <button type="button" aria-label={`Remove ${people.find(person => person.id === id)?.name || 'engineer'}`} onClick={() => setSelectedEngineers(selectedEngineers.filter(x => x !== id))}
                        className="u-d7e0c12">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="form-row">
            <div className="form-group"><label>Primary Contact</label><input value={form.primary_contact} onChange={set('primary_contact')} /></div>
            <div className="form-group"><label>Location</label><input value={form.location} onChange={set('location')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Reporting Frequency</label><input value={form.reporting_frequency} onChange={set('reporting_frequency')} placeholder="e.g. Monthly" /></div>
          </div>
          <p className="text-muted text-sm">Contracts (reference, dates, contract type and assets) are kept on the customer’s Contracts tab.</p>
          <div className="form-group"><label>Service Notes</label><textarea value={form.service_notes} onChange={set('service_notes')} rows={2} /></div>

          <label className="u-6a565d3">Activity Requirements</label>
          <div className="u-d46a252">
            {[
              ['require_duration', 'Require Duration'], ['require_ticket_reference', 'Require Ticket Reference'],
              ['require_technology', 'Require Technology'], ['require_category', 'Require Category'],
              ['require_notes', 'Require Notes'], ['require_billable_classification', 'Require Billable Classification'],
            ].map(([k, label]) => (
              <label key={k} className="u-d1b8a2e">
                <input type="checkbox" checked={!!form[k]} onChange={setBool(k)} className="u-30e741d" /> {label}
              </label>
            ))}
          </div>
        </div>
      </details>

      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

const CUSTOMER_COLUMNS = ['name*', 'project_name', 'contact_name', 'contact_email', 'contact_phone', 'primary_contact', 'location', 'address', 'notes', 'managed', 'team', 'contract_reference', 'contract_type', 'contract_start', 'contract_end'];

const SERVICE_STATUS = { healthy:['Healthy','success'],attention:['Sync issue','danger'],awaiting_sync:['Awaiting first sync','warning'],activity_only:['No ticket integration','info'] };
// A report owed for the last period and not yet sent; "overdue" once its due date has passed.
const reportOverdue = due => !!due && due.status!=='not_yet_due' && due.status!=='sent' && due.overdue;

const CONTRACT_STATUS = { active: ['success', 'Active'], ending_soon: ['warning', 'Ending soon'], expired: ['danger', 'Expired'], upcoming: ['info', 'Starts later'], renewed: ['neutral', 'Renewed'] };
// The customer's current contract, and "+N more" for its other contracts in force.
function ContractCell({ contract, others = [], link = null }) {
  if (!contract) return <span className="text-muted text-sm">No contract</span>;
  const [tone, text] = CONTRACT_STATUS[contract.status] || ['neutral', contract.status];
  const more = others.length > 0 && (() => {
    const label = `+${others.length} more`, list = others.map(o => `${o.reference} (ends ${fmtDate(o.end_date)})`).join(', ');
    return link ? <Link className="text-sm contract-more" to={link} title={list} aria-label={`${others.length} more contracts in force: ${list}`}>{label}</Link>
      : <span className="text-sm text-muted contract-more" title={list}>{label}</span>;
  })();
  return <><strong className="text-sm">{contract.reference || contract.description || 'Contract'}</strong>{contract.service_level && <span className="text-muted text-sm"> · {contract.service_level}</span>}{more && <> {more}</>}
    <div className="text-sm"><ToneBadge tone={tone}>{text}</ToneBadge> <span className="text-muted">{contract.status === 'upcoming' ? `starts ${fmtDate(contract.start_date)}` : `ends ${fmtDate(contract.end_date)}`}</span></div></>;
}

export default function Customers() {
  const { user } = useAuth();
  const location = useLocation();
  const toast    = useToast();
  const confirm  = useConfirm();
  const isManager  = user?.role === 'manager';
  const isPlanner  = user?.role === 'planner';
  const isEngineer = user?.role === 'engineer'; // sees the customers they work with (server-side) and opens their pages
  const canCreate  = isManager || isPlanner;   // add & edit customers
  const [customers,   setCustomers]   = useState([]);
  const [teams,       setTeams]       = useState([]);
  const [showForm,    setShowForm]    = useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [showExport,  setShowExport]  = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [search,      setSearch]      = useState('');
  // Managed customers are a view of this list (they used to have their own page).
  const canSeeManaged = Object.prototype.hasOwnProperty.call(user?.permissions || {}, 'managed_customers.view') ? user.permissions['managed_customers.view'] === true : isManager;
  const [view,        setView]        = useState(() => new URLSearchParams(location.search).get('view') === 'managed' && canSeeManaged ? 'managed' : 'all');
  const [managed,     setManaged]     = useState(new Map());
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState('');
  const [page,        setPage]        = useState(1);
  const [total,       setTotal]       = useState(0);
  const [counts,      setCounts]      = useState({ all:0,active:0,tracked:0,inactive:0 });

  const load = useCallback(async options => {
    if (!options?.quiet) setLoading(true);
    setLoadError('');
    try { const result=await api.pagedCustomers({ page,page_size:25,search,view },options);setCustomers(result.rows ?? []);setTotal(result.total || 0);setCounts(result.counts || {}); }
    catch (error) { if (error.name !== 'AbortError') setLoadError(error.message || 'Unable to load customers'); }
    finally { if (!options?.signal?.aborted) setLoading(false); }
  }, [page,search,view]);
  useEffect(() => {
    const controller = new AbortController();
    const timer=setTimeout(() => load({ signal: controller.signal }),250);
    return () => { clearTimeout(timer);controller.abort(); };
  }, [load]);
  useEffect(() => {
    if (!isManager) return;
    const controller = new AbortController();
    api.teams({ signal: controller.signal }).then(setTeams).catch(() => {});
    return () => controller.abort();
  }, [isManager]);
  useEffect(() => setPage(1),[search,view]);
  // Service health, tickets and report status for managed customers.
  const [managedVersion, setManagedVersion] = useState(0);
  useEffect(() => {
    if (!canSeeManaged || view !== 'managed') return undefined;
    const controller = new AbortController();
    api.managedCustomers({ signal: controller.signal }).then(result => setManaged(new Map((result.rows || []).map(row => [Number(row.id), row])))).catch(() => {});
    return () => controller.abort();
  }, [canSeeManaged, view, managedVersion]);
  useLiveRefresh(() => { load({ quiet: true }); setManagedVersion(value => value + 1); });

  async function openEdit(customer) {
    setEditing(customer);
    if (isManager) {
      try {
        const customerTeams = await api.customerTeams(customer.id);
        setEditing({ ...customer, team_ids: customerTeams.map(t => t.id) });
      } catch { /* non-fatal */ }
    }
    setShowForm(true);
  }

  const filtered = customers;

  // Archiving keeps everything and can be undone; deleting (archived customers only, managers only) cannot.
  async function handleArchive(c) {
    const ok = await confirm(`Archive ${c.name}? It leaves the customer lists and pickers, but its visits, activities, reports and assets are kept. You can restore it from Archived.`, { title: 'Archive customer', label: 'Archive' });
    if (!ok) return;
    try { await api.archiveCustomer(c.id); toast.success(`${c.name} archived`); load(); } catch (e) { toast.error(e.message); }
  }
  async function handleRestore(c) {
    try { await api.restoreCustomer(c.id); toast.success(`${c.name} restored`); load(); } catch (e) { toast.error(e.message); }
  }
  async function handleDelete(c) {
    const ok = await confirm(`Delete ${c.name} for good, with all its history: activities, assets, contracts, licences, visits, recommendations, tasks, KPIs and customer reports. Its projects are kept, without the customer. This cannot be undone.`,
      { title: 'Delete customer permanently', label: 'Delete permanently', typeToConfirm: c.name });
    if (!ok) return;
    try { await api.deleteCustomer(c.id); toast.success(`${c.name} deleted`); load(); } catch (e) { toast.error(e.message); }
  }

  const managedRows = [...managed.values()];
  const managedColumns = [
    { key:'customer',label:'Customer',render:c => <div className="customer-identity"><Link to={`/customers/${c.id}/service-profile`}>{c.name}</Link>{c.project_name && <span className="customer-project-name">{c.project_name}</span>}<span>{managed.get(Number(c.id))?.responsible_team || 'No responsible team'}</span></div> },
    { key:'report',label:'Customer report',render:c => <ReportDueBadge due={managed.get(Number(c.id))?.report_due} /> },
    { key:'status',label:'Service status',render:c => { const [label, tone] = SERVICE_STATUS[managed.get(Number(c.id))?.service_status] || ['—', 'neutral']; return <ToneBadge tone={tone}>{label}</ToneBadge>; } },
    { key:'tickets',label:'Open tickets',numeric:true,render:c => <Link to={`/customers/${c.id}/service-profile?section=tickets`}>{managed.get(Number(c.id))?.open_tickets ?? 0}</Link> },
    { key:'activities',label:'Activities this month',numeric:true,render:c => managed.get(Number(c.id))?.activities_this_month ?? 0 },
    { key:'manager',label:'Service manager',render:c => managed.get(Number(c.id))?.service_manager || 'Unassigned' },
    { key:'actions',label:'Actions',render:c => <div className="table-actions"><Link className="btn btn-sm btn-ghost" to={`/customers/${c.id}/service-profile?section=reports`}>Reports</Link></div> },
  ];
  const columns = [
    { key:'customer',label:'Customer',render:c => <div className="customer-identity">
      {isManager || isEngineer ? <Link to={`/customers/${c.id}/service-profile`}>{c.name}</Link> : <strong>{c.name}</strong>}
      {c.project_name && <span className="customer-project-name">{c.project_name}</span>}
      {(!!c.is_managed || !!c.is_internal) && <div className="customer-tags">
        {!!c.is_managed && <ToneBadge tone="managed">Managed</ToneBadge>}
        {!!c.is_internal && <ToneBadge tone="info">In-house</ToneBadge>}
      </div>}
      <span>{c.active ? 'Active' : 'Archived'}</span>
      {c.notes && <small title={c.notes}>{c.notes}</small>}
    </div> },
    { key:'coverage',label:'Coverage',render:c => c.service_activity_enabled ? <ToneBadge tone="success">Tracked</ToneBadge> : <ToneBadge>Standard</ToneBadge> },
    { key:'contract',label:'Contract',render:c => <ContractCell contract={c.current_contract} others={c.other_active_contracts} link={isManager || isEngineer ? `/customers/${c.id}/service-profile?section=contracts` : null} /> },
    { key:'contact',label:'Primary contact',render:c => <>{c.contact_name || c.primary_contact || '—'}{c.contact_email && <div><a className="text-sm" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></div>}</> },
    { key:'location',label:'Location',className:'text-sm',render:c => c.location || c.address || '—' },
    { key:'visits',label:'Visits',numeric:true,render:c => c.visit_count ?? 0 },
    { key:'actions',label:'Actions',render:c => <div className="table-actions">
      {(isManager || isEngineer) && <Link className="btn btn-sm btn-ghost" to={`/customers/${c.id}/service-profile`}>Open</Link>}
      {canCreate && <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>Edit</button>}
      {canCreate && (c.active
        ? <button className="btn btn-sm btn-ghost" onClick={() => handleArchive(c)} aria-label={`Archive ${c.name}`} title="Archive customer"><Archive size={14} /></button>
        : <button className="btn btn-sm btn-ghost" onClick={() => handleRestore(c)}><ArchiveRestore size={14} /> Restore</button>)}
      {isManager && !c.active && <button className="btn btn-sm btn-ghost btn-icon-danger" onClick={() => handleDelete(c)} aria-label={`Delete ${c.name} permanently`} title="Delete permanently"><Trash2 size={14} /></button>}
    </div> },
  ];

  return (
    <div className="page">
      <PageHeader title="Customers" actions={
        <div className="flex gap-8 flex-wrap">
          {canCreate && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Customer</button>}
          {/* Customer Responses opens from here rather than the menu. */}
          <HeaderMenu>
            {canCreate && <button type="button" onClick={() => setShowImport(true)}><Upload size={14} aria-hidden="true" /> Import customers</button>}
            {canCreate && <button type="button" onClick={() => setShowExport(true)}><Download size={14} aria-hidden="true" /> Export customers</button>}
            <button type="button" onClick={() => load()} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          </HeaderMenu>
        </div>
      } />

      <Surface label="Directory filters">
        <ListSearch value={search} onChange={setSearch} label="Search customers" placeholder="Search customers, project names, contacts, email, or location…" />
        <FilterGroup label="View">
          {[
            ['all', 'All', counts.all || 0],
            ['active', 'Active', counts.active || 0],
            ['tracked', 'Service tracking', counts.tracked || 0],
            ...(canSeeManaged ? [['managed', 'Managed', counts.managed || 0]] : []),
            ['inactive', 'Archived', counts.inactive || 0],
          ].map(([key, label, count]) => <button key={key} className={`filter-pill${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
            {label} <span className="u-383082b">({count})</span>
          </button>)}
        </FilterGroup>
      </Surface>

      {view === 'managed' && <MetricStrip items={[
        { label:'Reports overdue', value:managedRows.filter(row => reportOverdue(row.report_due)).length, tone:managedRows.some(row => reportOverdue(row.report_due)) ? 'danger' : 'success' },
        { label:'Need attention', value:managedRows.filter(row => row.service_status !== 'healthy').length, tone:'warning' },
        { label:'Open tickets', value:managedRows.reduce((sum, row) => sum + Number(row.open_tickets || 0), 0) },
        { label:'Pending tickets', value:managedRows.reduce((sum, row) => sum + Number(row.pending_tickets || 0), 0) },
        { label:'Activities this month', value:managedRows.reduce((sum, row) => sum + Number(row.activities_this_month || 0), 0) },
      ]} />}

      {!loading && !loadError && <ResultContext shown={filtered.length} total={total} noun="customers"
        activeFilters={(search.trim() ? 1 : 0) + (view !== 'all' ? 1 : 0)}
        onClear={() => { setSearch(''); setView('all'); }} />}

      <DataTable columns={view === 'managed' ? managedColumns : columns} rows={filtered} loading={loading} error={loadError} onRetry={() => load()}
        caption="Customer directory" empty={search.trim() || view!=='all' ? 'No customers match this view' : 'No customers have been added yet'}
        emptyAction={(search.trim() || view!=='all') && <button className="btn btn-ghost btn-sm" onClick={() => { setSearch('');setView('all'); }}>Reset view</button>} />
      <Pagination page={page} total={total} pageSize={25} loading={loading} onPageChange={setPage} label="Customer pages" />

      {showForm && (
        <Modal title={editing ? 'Edit Customer' : 'New Customer'} onClose={() => setShowForm(false)}>
          <CustomerForm
            initial={editing}
            teams={isManager ? teams : null}
            onSave={async data => {
              if (editing) { await api.updateCustomer(editing.id, data); toast.success('Customer updated'); return editing.id; }
              const { id } = await api.createCustomer(data); toast.success('Customer created'); return id;
            }}
            onSaveTeams={isManager ? async (id, teamIds) => { await api.setCustomerTeams(id, teamIds); } : null}
            onCreateTeam={isManager ? async (name) => { const created = await api.createTeam({ name, service_activity_enabled: false }); setTeams(current => [...current, { id: created.id, name }]); return created.id; } : null}
            onClose={() => { setShowForm(false); load(); }}
          />
        </Modal>
      )}

      {showExport && <ExportCustomers onClose={() => setShowExport(false)} />}
      {showImport && (
        <ImportModal
          title="Import Customers"
          templateUrl={api.customersTemplateUrl()}
          previewFn={file => api.previewCustomerImport(file)}
          importFn={(file, { option, previewToken }) => api.importCustomers(file, { updateExisting: option, previewToken })}
          columns={CUSTOMER_COLUMNS}
          hint={<><strong>managed:</strong> yes or no (managers only). <strong>team:</strong> a team name; it is linked to the customer and, for managed customers, becomes the responsible team. <strong>contract_…:</strong> adds a contract (reference, type such as 24x7, start and end dates as YYYY-MM-DD or DD/MM/YYYY); the same reference again updates it. CSV files may use commas or semicolons.</>}
          option={{ label: 'Update customers that already exist', help: 'Matched by name. Filled-in columns replace what is there; empty ones leave it. Otherwise existing customers are skipped.' }}
          noun={['customer', 'customers']}
          onClose={() => setShowImport(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

/* Customers with their contacts to Excel or CSV: the primary contact (one row per customer)
   or every contact (one row per contact). The download is recorded in the audit log. */
function ExportCustomers({ onClose }) {
  const toast = useToast();
  const [format, setFormat] = useState('xlsx'), [contacts, setContacts] = useState('primary'), [archived, setArchived] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function download() {
    setBusy(true); setError('');
    try {
      const { blob, filename } = await api.exportCustomers({ format, contacts, archived });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Customers exported'); onClose();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title="Export customers" onClose={onClose}>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <fieldset className="export-choice"><legend>Contacts</legend>
      <label><input type="radio" name="export-contacts" checked={contacts === 'primary'} onChange={() => setContacts('primary')} /> The primary contact (one row per customer)</label>
      <label><input type="radio" name="export-contacts" checked={contacts === 'all'} onChange={() => setContacts('all')} /> Every contact (one row per contact)</label>
    </fieldset>
    <fieldset className="export-choice"><legend>File</legend>
      <label><input type="radio" name="export-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (.xlsx)</label>
      <label><input type="radio" name="export-format" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV</label>
    </fieldset>
    <label className="export-choice-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Include archived customers</label>
    <p className="text-muted text-sm">The file holds customer contact details: keep it within the company.</p>
    <div className="modal-footer u-cc45258">
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={download}><Download size={14} aria-hidden="true" /> {busy ? 'Exporting…' : 'Download'}</button>
    </div>
  </Modal>;
}
