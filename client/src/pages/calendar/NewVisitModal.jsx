import React, { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import EngineerPicker from './EngineerPicker';

/* ── Quick-create Maintenance Visit modal ────────────────── */
export default function NewVisitModal({ prefillDate, onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_id: '', title: '', description: '',
    scheduled_date: prefillDate || '', engineer_ids: [], notes: '',
  });
  const [customers,  setCustomers]  = useState([]);
  const [engineers,  setEngineers]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([api.customers(), api.users()])
      .then(([custs, users]) => {
        setCustomers(custs);
        setEngineers(users.filter(u => u.role === 'engineer' && u.active !== 0));
      })
      .catch(() => setErr('Failed to load form data'))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      await api.createVisit({
        ...form,
        customer_id:  Number(form.customer_id),
        status:       'scheduled',
      });
      onCreated();
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Failed to create visit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Maintenance Visit" onClose={onClose} wide>
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--gray-400)' }}>Loading…</div>
      ) : (
        <form onSubmit={submit}>
          {err && <div className="error-msg mb-12">{err}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Customer *</label>
              <select value={form.customer_id} onChange={set('customer_id')} required>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Visit Title *</label>
              <input value={form.title} onChange={set('title')} required placeholder="e.g. Q3 Health Check" autoFocus />
            </div>

            <div className="form-group">
              <label>Scheduled Date *</label>
              <input type="date" value={form.scheduled_date} onChange={set('scheduled_date')} required />
            </div>

            <div className="form-group">
              <label>Description</label>
              <input value={form.description || ''} onChange={set('description')} placeholder="Scope / objectives…" />
            </div>
          </div>

          <div className="form-group">
            <label>Assign Engineers</label>
            <EngineerPicker
              engineers={engineers}
              selected={form.engineer_ids}
              onChange={ids => setForm(f => ({ ...f, engineer_ids: ids }))}
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.notes || ''} onChange={set('notes')} rows={2}
              placeholder="Any additional notes…" style={{ resize: 'vertical' }} />
          </div>

          <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary inline-flex items-center gap-6"
             
              disabled={saving}>
              {saving ? '⏳ Saving…' : <><Wrench size={14} /> Create Visit</>}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
