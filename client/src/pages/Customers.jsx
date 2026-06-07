import React, { useEffect, useState } from 'react';
import { Building2, Upload } from 'lucide-react';
import { api } from '../api';
import { Modal } from '../components/Shared';
import ImportModal from '../components/ImportModal';
import { useAuth } from '../App';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

function CustomerForm({ initial, onSave, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(initial || { name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setSaving(true);
    try { await onSave(form); onClose(); } catch (err) { toast.error(err.message); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="form-group"><label>Customer Name *</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="form-row">
        <div className="form-group"><label>Contact Person</label><input value={form.contact_name} onChange={set('contact_name')} /></div>
        <div className="form-group"><label>Contact Email</label><input type="email" value={form.contact_email} onChange={set('contact_email')} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Phone</label><input value={form.contact_phone} onChange={set('contact_phone')} /></div>
        <div className="form-group"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
      </div>
      <div className="form-group"><label>Notes</label><textarea value={form.notes} onChange={set('notes')} /></div>
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
  const [showForm,    setShowForm]    = useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(true);

  const load = () => api.customers().then(d => { setCustomers(d); setLoading(false); });
  useEffect(() => { load(); }, []);

  const filtered = customers.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
      (c.contact_name  || '').toLowerCase().includes(q) ||
      (c.contact_email || '').toLowerCase().includes(q) ||
      (c.address       || '').toLowerCase().includes(q);
  });

  async function handleDelete(id) {
    const ok = await confirm('Delete this customer and all their maintenance visits?', { title: 'Delete Customer' });
    if (!ok) return;
    try { await api.deleteCustomer(id); toast.success('Customer deleted'); load(); } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Customers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && <button className="btn btn-ghost" onClick={() => setShowImport(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Upload size={14} /> Import</button>}
          {canCreate && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New Customer</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…" style={{ maxWidth: 320 }} />
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><Building2 size={40} strokeWidth={1.2} /></div><p>No customers yet</p></div>
        : <div className="card table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Contact</th><th>Email</th><th>Phone</th><th>Address</th><th>Visits</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>
                      {c.name}
                      {c.notes && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.notes}>{c.notes}</div>}
                    </td>
                    <td>{c.contact_name || '—'}</td>
                    <td>{c.contact_email ? <a href={`mailto:${c.contact_email}`}>{c.contact_email}</a> : '—'}</td>
                    <td>{c.contact_phone || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-600)' }}>{c.address || '—'}</td>
                    <td><span className="badge badge-active">{c.visit_count}</span></td>
                    <td>
                      {canCreate && (
                        <div className="flex gap-8">
                          <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(c); setShowForm(true); }}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>
                        </div>
                      )}
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
            onSave={async data => {
              if (editing) { await api.updateCustomer(editing.id, data); toast.success('Customer updated'); }
              else { await api.createCustomer(data); toast.success('Customer created'); }
              load();
            }}
            onClose={() => setShowForm(false)}
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
