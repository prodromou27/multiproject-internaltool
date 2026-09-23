import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, RefreshCw, Upload } from 'lucide-react';
import { api } from '../api';
import { Modal } from '../components/Shared';
import ImportModal from '../components/ImportModal';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch, ResultContext } from '../components/ListWorkspace';
import { useAuth } from '../App';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

function CustomerForm({ initial, teams, onSave, onSaveTeams, onClose }) {
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
            <div className="form-group"><label>Assigned Team(s)</label>
              <select multiple value={selectedTeams.map(String)}
                onChange={e => setSelectedTeams([...e.target.selectedOptions].map(o => Number(o.value)))}
                style={{ minHeight: 80 }}>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
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

  const load = useCallback(async options => {
    setLoading(true); setLoadError('');
    try { setCustomers(await api.customers(options) ?? []); }
    catch (error) { if (error.name !== 'AbortError') setLoadError(error.message || 'Unable to load customers'); }
    finally { if (!options?.signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    if (isManager) api.teams({ signal: controller.signal }).then(setTeams).catch(() => {});
    return () => controller.abort();
  }, [isManager, load]);

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

  const filtered = customers.filter(c => {
    if (view === 'active' && !c.active) return false;
    if (view === 'inactive' && c.active) return false;
    if (view === 'tracked' && !c.service_activity_enabled) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
      (c.contact_name  || '').toLowerCase().includes(q) ||
      (c.contact_email || '').toLowerCase().includes(q) ||
      (c.address       || '').toLowerCase().includes(q) ||
      (c.location      || '').toLowerCase().includes(q) ||
      (c.customer_code || '').toLowerCase().includes(q);
  });

  async function handleDelete(id) {
    const ok = await confirm('Delete this customer and all their maintenance visits?', { title: 'Delete Customer' });
    if (!ok) return;
    try { await api.deleteCustomer(id); toast.success('Customer deleted'); load(); } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="Management" title="Customers" description="Customer records, service coverage, contracts and operational access." actions={
        <div className="flex gap-8 flex-wrap">
          <button className="btn btn-ghost" onClick={() => load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          {canCreate && <button className="btn btn-ghost inline-flex items-center gap-6" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>}
          {canCreate && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Customer</button>}
        </div>
      } />

      <div className="card mb-16">
        <ListSearch value={search} onChange={setSearch} label="Search customers" placeholder="Search customers, contacts, email, or location…" />
        <FilterGroup label="View">
          {[
            ['all', 'All', customers.length],
            ['active', 'Active', customers.filter(customer => !!customer.active).length],
            ['tracked', 'Service tracking', customers.filter(customer => !!customer.service_activity_enabled).length],
            ['inactive', 'Inactive', customers.filter(customer => !customer.active).length],
          ].map(([key, label, count]) => <button key={key} className={`filter-pill${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
            {label} <span style={{ opacity: .7 }}>({count})</span>
          </button>)}
        </FilterGroup>
      </div>

      {!loading && !loadError && <ResultContext shown={filtered.length} total={customers.length} noun="customers"
        activeFilters={(search.trim() ? 1 : 0) + (view !== 'all' ? 1 : 0)}
        onClear={() => { setSearch(''); setView('all'); }} />}

      {loadError ? <div className="error-msg" role="alert">{loadError} <button className="btn btn-ghost btn-sm" onClick={() => load()}>Retry</button></div>
        : loading ? <div className="skeleton-table" aria-label="Loading customers"><span /><span /><span /></div> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><Building2 size={40} strokeWidth={1.2} /></div><p>{customers.length ? 'No customers match this view' : 'No customers have been added yet'}</p>{customers.length > 0 && <button className="btn btn-ghost btn-sm mt-12" onClick={() => { setSearch(''); setView('all'); }}>Reset view</button>}</div>
        : <div className="card table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Coverage</th><th>Contract</th><th>Primary contact</th><th>Location</th><th>Visits</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td className="customer-identity">
                      {isManager ? <Link to={`/customers/${c.id}/service-profile`}>{c.name}</Link> : <strong>{c.name}</strong>}
                      <span>{c.customer_code || 'No customer code'} · {c.active ? 'Active' : 'Inactive'}</span>
                      {c.notes && <small title={c.notes}>{c.notes}</small>}
                    </td>
                    <td>{c.service_activity_enabled ? <span className="badge badge-done">Tracked</span> : <span className="badge badge-on_hold">Standard</span>}</td>
                    <td><strong className="text-sm">{c.contract_type || 'No contract'}</strong>{c.contract_end_date && <div className="text-muted text-sm">Ends {c.contract_end_date}</div>}</td>
                    <td>{c.contact_name || c.primary_contact || '—'}{c.contact_email && <div><a className="text-sm" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></div>}</td>
                    <td className="text-sm">{c.location || c.address || '—'}</td>
                    <td><span className="badge badge-active">{c.visit_count}</span></td>
                    <td>
                      <div className="table-actions">
                        {isManager && (
                          <Link className="btn btn-sm btn-ghost" to={`/customers/${c.id}/service-profile`}>Customer 360</Link>
                        )}
                        {canCreate && <button className="btn btn-sm btn-ghost" onClick={() => openEdit(c)}>Edit</button>}
                        {canCreate && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }

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
