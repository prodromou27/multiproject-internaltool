import { useEffect, useState } from 'react';
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { useLiveVersion } from '../live';
import { localDateISO } from '../utils/dates';

/* Customer 360 → Tasks: tasks that repeat for this customer. Each occurrence
   becomes a real task a few days before it is due (server/recurringTasks.js). */

export const FREQUENCY_LABELS = { weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Every year' };
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function RecurringForm({ customerId, initial, engineers, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || '', description: initial?.description || '', priority: initial?.priority || 'medium',
    frequency: initial?.frequency || 'monthly', start_date: initial?.start_date || localDateISO(new Date()),
    lead_days: initial?.lead_days ?? 7, assigned_to: initial?.assigned_to ? String(initial.assigned_to) : '',
  }));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    const body = { ...form, lead_days: Number(form.lead_days), assigned_to: form.assigned_to ? Number(form.assigned_to) : null, description: form.description.trim() || null };
    try {
      if (initial) await api.updateCustomerRecurringTask(customerId, initial.id, body);
      else await api.createCustomerRecurringTask(customerId, body);
      onSaved(initial ? 'Recurring task updated' : 'Recurring task added');
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title={initial ? 'Edit recurring task' : 'New recurring task'} onClose={onClose}>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="rt-title">Task *</label><input id="rt-title" value={form.title} onChange={set('title')} maxLength={300} required placeholder="For example, Monthly backup check" /></div>
      <div className="form-group"><label htmlFor="rt-description">Description</label><textarea id="rt-description" value={form.description} onChange={set('description')} rows={2} maxLength={5000} /></div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="rt-frequency">Repeats</label><select id="rt-frequency" value={form.frequency} onChange={set('frequency')}>{Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-group"><label htmlFor="rt-start">First due date</label><input id="rt-start" type="date" value={form.start_date} onChange={set('start_date')} required /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="rt-lead">Create it this many days before</label><input id="rt-lead" type="number" min="0" max="90" step="1" value={form.lead_days} onChange={set('lead_days')} required /></div>
        <div className="form-group"><label htmlFor="rt-priority">Priority</label><select id="rt-priority" value={form.priority} onChange={set('priority')}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="form-group"><label htmlFor="rt-engineer">Engineer</label><select id="rt-engineer" value={form.assigned_to} onChange={set('assigned_to')}><option value="">Unassigned</option>{engineers.map(engineer => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}</select></div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add recurring task'}</button></div>
    </form>
  </Modal>;
}

export default function CustomerRecurringTasks({ customerId, canManage, engineers = [] }) {
  const toast = useToast(), confirm = useConfirm(), live = useLiveVersion();
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null), [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.customerRecurringTasks(customerId, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setRows(result.rows || []); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [customerId, version, live]);
  const reload = message => { if (message) toast.success(message); setEditing(null); setVersion(value => value + 1); };
  async function toggle(row) {
    try { await api.updateCustomerRecurringTask(customerId, row.id, { active: !row.active }); reload(row.active ? 'Paused; no new tasks will be created' : 'Resumed'); }
    catch (failure) { toast.error(failure.message); }
  }
  async function remove(row) {
    if (!await confirm(`Stop repeating "${row.title}"? Tasks it already created stay.`, { title: 'Delete recurring task' })) return;
    try { await api.deleteCustomerRecurringTask(customerId, row.id); reload('Recurring task deleted'); } catch (failure) { toast.error(failure.message); }
  }
  if (!rows && !error) return null;
  if (!canManage && rows && !rows.length) return null;
  return <section className="card cs-recurring" aria-labelledby="cs-recurring-title">
    <header><h2 id="cs-recurring-title"><Repeat size={15} aria-hidden="true" /> Recurring tasks</h2>{canManage && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({})}><Plus size={14} /> Add recurring task</button>}</header>
    {error ? <div className="error-msg" role="alert">{error}</div> : !rows.length ? <p className="text-muted text-sm">Nothing repeats for this customer yet. Add a task that comes round on a schedule, such as a monthly backup check, and it will be created a few days before each due date.</p> :
      <table className="cs-work-table"><thead><tr><th>Task</th><th>Repeats</th><th>Next due</th><th>Engineer</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={row.active ? '' : 'is-paused'}>
          <td data-label="Task">{row.title}{row.priority !== 'medium' && <span className={`badge badge-${row.priority}`}> {row.priority}</span>}</td>
          <td data-label="Repeats">{FREQUENCY_LABELS[row.frequency]}<div className="text-muted text-sm">created {row.lead_days === 0 ? 'on the day' : `${row.lead_days} day${row.lead_days === 1 ? '' : 's'} before`}</div></td>
          <td data-label="Next due">{row.active ? fmtDate(row.next_due) : '—'}</td>
          <td data-label="Engineer">{row.assigned_to_name || 'Unassigned'}</td>
          <td data-label="Status">{row.active ? 'Active' : 'Paused'}</td>
          {canManage && <td className="table-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(row)} aria-label={`${row.active ? 'Pause' : 'Resume'} ${row.title}`}>{row.active ? <Pause size={13} /> : <Play size={13} />}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.title}`}><Pencil size={13} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(row)} aria-label={`Delete ${row.title}`}><Trash2 size={13} /></button>
          </td>}
        </tr>)}</tbody></table>}
    {editing && <RecurringForm customerId={customerId} initial={editing.id ? editing : null} engineers={engineers} onClose={() => setEditing(null)} onSaved={reload} />}
  </section>;
}
