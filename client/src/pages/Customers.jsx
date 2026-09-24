import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Upload } from 'lucide-react';
import { api } from '../api';
import { Modal } from '../components/Shared';
import ImportModal from '../components/ImportModal';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch, ResultContext } from '../components/ListWorkspace';
import { DataTable,Pagination,Surface,ToneBadge } from '../components/EnterpriseUI';
import { useAuth } from '../App';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

function CustomerForm({ initial, teams, onSave, onSaveTeams, onCreateTeam, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(initial || {
    name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '',
    customer_code: '', active: true, service_activity_enabled: false, primary_contact: '', location: '',
    contract_type: '', contract_start_date: '', contract_end_date: '', reporting_frequency: '',
    included_hours: '', contract_hour_period: '', service_notes: '',
    require_duration: false, require_ticket_reference: false, require_technology: false,
    require_category: false, require_notes: false, require_billable_classification: false,
  });
  const [selectedTeams, setSelectedTeams] = useState(() => (initial?.team_ids) || []);
  const [newTeam, setNewTeam] = useState(null); // null = not creating; string = name being typed
  const [showService, setShowService] = useState(!!initial?.service_activity_enabled);
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setBool = k => e => setForm(f => ({ ...f, [k]: e.target.checked }));

  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try {
      const id = await onSave(form);
      if (onSaveTeams) await onSaveTeams(initial?.id || id, selectedTeams);
      onClose();
    } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="form-group"><label>Customer Name *</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="form-row">
        <div className="form-group"><label>Customer Code</label><input value={form.customer_code} onChange={set('customer_code')} placeholder="Internal reference" /></div>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, marginTop: 22 }}>
            <input type="checkbox" checked={!!form.active} onChange={setBool('active')} style={{ width: 'auto' }} /> Active
          </label>
        </div>
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

      <details className="column-picker" open={showService} onToggle={e => setShowService(e.target.open)} style={{ marginTop: 4 }}>
        <summary className="btn btn-ghost btn-sm" style={{ display: 'inline-block' }}>Service Activity Tracking</summary>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gray-100)' }}>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" checked={!!form.service_activity_enabled} onChange={setBool('service_activity_enabled')} style={{ width: 'auto' }} />
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
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>×</button>
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
            <div className="form-group"><label>Support / MSP Contract</label><input value={form.contract_type} onChange={set('contract_type')} /></div>
            <div className="form-group"><label>Reporting Frequency</label><input value={form.reporting_frequency} onChange={set('reporting_frequency')} placeholder="e.g. Monthly" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Contract Start</label><input type="date" value={form.contract_start_date} onChange={set('contract_start_date')} /></div>
            <div className="form-group"><label>Contract End</label><input type="date" value={form.contract_end_date} onChange={set('contract_end_date')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Included Hours</label><input type="number" min="0" step="0.5" value={form.included_hours} onChange={set('included_hours')} /></div>
            <div className="form-group"><label>Hour Period</label>
              <select value={form.contract_hour_period} onChange={set('contract_hour_period')}>
                <option value="">Not applicable</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label>Service Notes</label><textarea value={form.service_notes} onChange={set('service_notes')} rows={2} /></div>

          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: .5 }}>Activity Requirements</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
            {[
              ['require_duration', 'Require Duration'], ['require_ticket_reference', 'Require Ticket Reference'],
              ['require_technology', 'Require Technology'], ['require_category', 'Require Category'],
              ['require_notes', 'Require Notes'], ['require_billable_classification', 'Require Billable Classification'],
            ].map(([k, label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={!!form[k]} onChange={setBool(k)} style={{ width: 'auto' }} /> {label}
              </label>
            ))}
          </div>
        </div>
      </details>

      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

const CUSTOMER_COLUMNS = ['name*', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes'];

export default function Customers() {
  const { user } = useAuth();
  const toast    = useToast();
  const confirm  = useConfirm();
  const isManager  = user?.role === 'manager';
  const isPlanner  = user?.role === 'planner';
  const canCreate  = isManager || isPlanner;   // add & edit customers
  const [customers,   setCustomers]   = useState([]);
  const [teams,       setTeams]       = useState([]);
  const [showForm,    setShowForm]    = useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [search,      setSearch]      = useState('');
  const [view,        setView]        = useState('all');
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState('');
  const [page,        setPage]        = useState(1);
  const [total,       setTotal]       = useState(0);
  const [counts,      setCounts]      = useState({ all:0,active:0,tracked:0,inactive:0 });

  const load = useCallback(async options => {
    setLoading(true); setLoadError('');
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

  async function handleDelete(id) {
    const ok = await confirm('Delete this customer and all their maintenance visits?', { title: 'Delete Customer' });
    if (!ok) return;
    try { await api.deleteCustomer(id); toast.success('Customer deleted'); load(); } catch (e) { toast.error(e.message); }
  }

  const columns = [
    { key:'customer',label:'Customer',render:c => <div className="customer-identity">
      {isManager ? <Link to={`/customers/${c.id}/service-profile`}>{c.name}</Link> : <strong>{c.name}</strong>}
      <span>{c.customer_code || 'No customer code'} · {c.active ? 'Active' : 'Inactive'}</span>
      {c.notes && <small title={c.notes}>{c.notes}</small>}
    </div> },
    { key:'coverage',label:'Coverage',render:c => c.service_activity_enabled ? <ToneBadge tone="success">Tracked</ToneBadge> : <ToneBadge>Standard</ToneBadge> },
    { key:'contract',label:'Contract',render:c => <><strong className="text-sm">{c.contract_type || 'No contract'}</strong>{c.contract_end_date && <div className="text-muted text-sm">Ends {c.contract_end_date}</div>}</> },
    { key:'contact',label:'Primary contact',render:c => <>{c.contact_name || c.primary_contact || '—'}{c.contact_email && <div><a className="text-sm" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></div>}</> },
    { key:'location',label:'Location',className:'text-sm',render:c => c.location || c.address || '—' },
    { key:'visits',label:'Visits',numeric:true,render:c => c.visit_count ?? 0 },
    { key:'actions',label:'Actions',render:c => <div className="table-actions">
      {isManager && <Link className="btn btn-sm btn-ghost" to={`/customers/${c.id}/service-profile`}>Customer 360</Link>}
      {canCreate && <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>Edit</button>}
      {canCreate && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>}
    </div> },
  ];

  return (
    <div className="page">
      <PageHeader eyebrow="Management" title="Customers" description="Customer records, service coverage, contracts and operational access." actions={
        <div className="flex gap-8 flex-wrap">
          <button className="btn btn-ghost" onClick={() => load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          {canCreate && <button className="btn btn-ghost inline-flex items-center gap-6" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>}
          {canCreate && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Customer</button>}
        </div>
      } />

      <Surface title="Directory filters" description="Search customer records and narrow the operational coverage view.">
        <ListSearch value={search} onChange={setSearch} label="Search customers" placeholder="Search customers, contacts, email, or location…" />
        <FilterGroup label="View">
          {[
            ['all', 'All', counts.all || 0],
            ['active', 'Active', counts.active || 0],
            ['tracked', 'Service tracking', counts.tracked || 0],
            ['inactive', 'Inactive', counts.inactive || 0],
          ].map(([key, label, count]) => <button key={key} className={`filter-pill${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
            {label} <span style={{ opacity: .7 }}>({count})</span>
          </button>)}
        </FilterGroup>
      </Surface>

      {!loading && !loadError && <ResultContext shown={filtered.length} total={total} noun="customers"
        activeFilters={(search.trim() ? 1 : 0) + (view !== 'all' ? 1 : 0)}
        onClear={() => { setSearch(''); setView('all'); }} />}

      <DataTable columns={columns} rows={filtered} loading={loading} error={loadError} onRetry={() => load()}
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

      {showImport && (
        <ImportModal
          title="Import Customers"
          templateUrl={api.customersTemplateUrl()}
          importFn={api.importCustomers}
          columns={CUSTOMER_COLUMNS}
          onClose={() => setShowImport(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
