import { useEffect, useState } from 'react';
import { api } from '../api';
import { businessToday } from '../utils/dates';
import { Modal, fmtDate } from './Shared';
import { useToast } from './Toast';

/* Hours on a task or visit, kept by the day the work was done, as the engineer's
   own reference for filling in the company timesheet later (see My time). */
export default function LogHours({ target, title, onClose, onLogged }) {
  const toast = useToast();
  const today = businessToday();
  const [form, setForm] = useState({ work_date: today, hours: '', description: '' });
  const [entries, setEntries] = useState(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const load = () => api.timeLogs(target).then(rows => setEntries(Array.isArray(rows) ? rows : [])).catch(() => setEntries([]));
  useEffect(() => { load(); }, []);
  const set = key => event => setForm(f => ({ ...f, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.logTime({ ...target, hours: Number(form.hours), description: form.description.trim() || null, work_date: form.work_date });
      toast.success(`${form.hours}h logged for ${fmtDate(form.work_date)}`);
      setForm(f => ({ ...f, hours: '', description: '' })); await load(); onLogged?.();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  const total = (entries || []).reduce((sum, row) => sum + Number(row.hours), 0);
  return <Modal title="Log hours" onClose={onClose} busy={saving}>
    <p className="text-sm"><strong>{title}</strong></p>
    <form onSubmit={submit}>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="log-date">Day worked</label><input id="log-date" type="date" required max={today} value={form.work_date} onChange={set('work_date')} /></div>
        <div className="form-group"><label htmlFor="log-hours">Hours</label><input id="log-hours" type="number" required min="0.25" max="24" step="0.25" value={form.hours} onChange={set('hours')} autoFocus /></div>
      </div>
      <div className="form-group"><label htmlFor="log-note">What you did (optional)</label><input id="log-note" maxLength={2000} value={form.description} onChange={set('description')} /></div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={saving || !form.hours}>{saving ? 'Saving…' : 'Log hours'}</button></div>
    </form>
    {entries && entries.length > 0 && <section aria-label="Hours logged" className="text-sm" style={{ marginTop: 8 }}>
      <strong>Logged so far: {Math.round(total * 100) / 100}h</strong>
      <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{entries.slice(0, 10).map(row => <li key={row.id}>{fmtDate(row.work_date || row.logged_at)}: {Number(row.hours)}h{row.user_name ? ` · ${row.user_name}` : ''}{row.description ? ` · ${row.description}` : ''}</li>)}</ul>
    </section>}
  </Modal>;
}
