import { useEffect, useState } from 'react';
import CustomerSearchSelect from '../../components/CustomerSearchSelect';
import { Wrench } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import EngineerPicker from './EngineerPicker';
import { VisitTimeFields, VisitWarnings, timesOf, useVisitCheck } from '../../components/VisitSchedule';

/* ── Quick-create Maintenance Visit modal ────────────────── */
export default function NewVisitModal({ prefillDate, onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_id: '', title: '', description: '',
    scheduled_date: prefillDate || '', engineer_ids: [], notes: '', all_day: true,
  });
  const check = useVisitCheck();
  // A change to what was checked clears the warnings.
  const setChecked = updater => { setForm(updater); check.reset(); };
  const [engineers,  setEngineers]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.users()
      .then(users => {
        setEngineers(users.filter(u => u.role === 'engineer' && u.active !== 0));
      })
      .catch(() => setErr('Failed to load form data'))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const { all_day: _allDay, ...rest } = form;
      // The day, time and engineers are checked first (holidays, time off, overlaps…).
      const saved = await check.run({ ...rest, ...timesOf(form), customer_id: Number(form.customer_id), status: 'scheduled' }, api.createVisit);
      if (!saved) return;
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
        <div className="u-968d015">Loading…</div>
      ) : (
        <form onSubmit={submit}>
          {err && <div className="error-msg mb-12">{err}</div>}

          <div className="u-9c34d8c">
            <div className="form-group u-4ddcfbe">
              <label>Customer *</label>
              <CustomerSearchSelect value={form.customer_id} allowEmpty={false} required label="Customer" onChange={id => setForm(f => ({ ...f, customer_id: id ? String(id) : '' }))} />
            </div>

            <div className="form-group u-4ddcfbe">
              <label>Visit Title *</label>
              <input value={form.title} onChange={set('title')} required placeholder="e.g. Q3 Health Check" autoFocus />
            </div>

            <div className="form-group">
              <label>Scheduled Date *</label>
              <input type="date" value={form.scheduled_date} onChange={event => setChecked(f => ({ ...f, scheduled_date: event.target.value }))} required />
              <VisitTimeFields form={form} setForm={setChecked} idPrefix="new-visit" />
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
              onChange={ids => setChecked(f => ({ ...f, engineer_ids: ids }))}
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea value={form.notes || ''} onChange={set('notes')} rows={2}
              placeholder="Any additional notes…" className="u-9d0af0f" />
          </div>

          <VisitWarnings warnings={check.warnings} />
          <div className="modal-footer u-cc45258">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary inline-flex items-center gap-6"
             
              disabled={saving}>
              {saving ? 'Saving…' : <><Wrench size={14} /> {check.pending ? 'Create anyway' : 'Create Visit'}</>}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
