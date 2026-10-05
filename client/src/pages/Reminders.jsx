import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Check, Clock, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { Modal } from '../components/Shared';
import { PageHeader } from '../components/PageLayout';
import { Surface } from '../components/EnterpriseUI';
import { Toggle } from './admin/shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { localDateISO } from '../utils/dates';

const REPEAT_LABELS = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const pad = value => String(value).padStart(2, '0');
const localTime = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const toInstant = (date, time) => new Date(`${date}T${time}`).toISOString();
const dayLabel = date => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};
const whenLabel = iso => { const date = new Date(iso); return `${dayLabel(date)}, ${localTime(date)}`; };

// Snooze choices, worked out in the viewer's own time zone.
function snoozeOptions() {
  const now = new Date();
  const hour = new Date(now.getTime() + 60 * 60 * 1000);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const week = new Date(now); week.setDate(week.getDate() + 7); week.setHours(9, 0, 0, 0);
  return [['1 hour', hour], ['Tomorrow 09:00', tomorrow], ['Next week', week]];
}

function ReminderForm({ initial, customers, onClose, onSaved }) {
  const toast = useToast();
  const start = initial ? new Date(initial.due_at) : (() => { const next = new Date(); next.setHours(next.getHours() + 1, 0, 0, 0); return next; })();
  const [form, setForm] = useState({ title: initial?.title || '', date: localDateISO(start), time: localTime(start), repeat: initial?.repeat || 'none', customer_id: initial?.customer_id ? String(initial.customer_id) : '', notes: initial?.notes || '' });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { title: form.title, due_at: toInstant(form.date, form.time), time_zone: timeZone(), repeat: form.repeat, customer_id: form.customer_id || null, notes: form.notes };
    try {
      const saved = initial ? await api.updateReminder(initial.id, body) : await api.createReminder(body);
      toast.success(initial ? 'Reminder updated' : 'Reminder set');
      onSaved(saved);
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title={initial ? 'Edit reminder' : 'New reminder'} onClose={onClose}>
    <form className="reminder-form" onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="reminder-title">What to remember</label><input id="reminder-title" required maxLength={200} autoFocus value={form.title} onChange={set('title')} placeholder="e.g. Check the Veeam backup report" /></div>
      <div className="reminder-form-when">
        <div className="form-group"><label htmlFor="reminder-date">Date</label><input id="reminder-date" type="date" required value={form.date} onChange={set('date')} /></div>
        <div className="form-group"><label htmlFor="reminder-time">Time</label><input id="reminder-time" type="time" required value={form.time} onChange={set('time')} /></div>
        <div className="form-group"><label htmlFor="reminder-repeat">Repeat</label><select id="reminder-repeat" value={form.repeat} onChange={set('repeat')}>{Object.entries(REPEAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="form-group"><label htmlFor="reminder-customer">Customer (optional)</label><select id="reminder-customer" value={form.customer_id} onChange={set('customer_id')}><option value="">None</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
      <div className="form-group"><label htmlFor="reminder-notes">Notes (optional)</label><textarea id="reminder-notes" rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} /></div>
      <div className="flex gap-8"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save reminder' : 'Set reminder'}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </form>
  </Modal>;
}

function ReminderRow({ reminder, due, busy, onDone, onSnooze, onEdit, onDelete }) {
  return <li className={`reminder-item${due ? ' is-due' : ''}`}>
    <div className="reminder-item-main">
      <strong>{reminder.title}</strong>
      <div className="reminder-item-meta">
        <span><Clock size={12} aria-hidden="true" />{due && new Date(reminder.due_at) < new Date(Date.now() - 60000) ? `Since ${whenLabel(reminder.due_at)}` : whenLabel(reminder.due_at)}</span>
        {reminder.repeat !== 'none' && <span><Repeat size={12} aria-hidden="true" />{REPEAT_LABELS[reminder.repeat]}</span>}
        {reminder.customer_name && <Link to={`/customers/${reminder.customer_id}/service-profile`}>{reminder.customer_name}</Link>}
      </div>
      {reminder.notes && <p>{reminder.notes}</p>}
    </div>
    <div className="reminder-item-actions">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onDone} title={reminder.repeat === 'none' ? 'Mark as done' : 'Done for now; moves to the next time'}><Check size={13} /> Done</button>
      {due && <details className="reminder-snooze"><summary className="btn btn-ghost btn-sm">Snooze</summary><div role="menu">{snoozeOptions().map(([label, until]) => <button key={label} type="button" role="menuitem" disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; onSnooze(until); }}>{label}</button>)}</div></details>}
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${reminder.title}`} disabled={busy} onClick={onEdit}><Pencil size={13} /></button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${reminder.title}`} disabled={busy} onClick={onDelete}><Trash2 size={13} /></button>
    </div>
  </li>;
}

export default function Reminders() {
  const { user } = useAuth();
  const toast = useToast(), confirm = useConfirm();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null, 'new' or a reminder
  const [now, setNow] = useState(() => new Date().toISOString());
  const legacyKey = `hub_recurring_${user.id}`;
  const [legacy, setLegacy] = useState(() => { try { return JSON.parse(localStorage.getItem(legacyKey) || '[]'); } catch { return []; } });

  const load = useCallback(() => api.reminders().then(result => { setData(result); setError(''); }).catch(failure => setError(failure.message)), []);
  useEffect(() => { load(); }, [load]);
  // Move reminders into "Due now" as their time arrives, and pick up changes made elsewhere.
  useEffect(() => { const timer = setInterval(() => { setNow(new Date().toISOString()); load(); }, 60000); return () => clearInterval(timer); }, [load]);

  async function act(work, message) {
    setBusy(true);
    try { await work(); if (message) toast.success(message); await load(); } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  async function remove(reminder) {
    if (!await confirm(`Delete "${reminder.title}"?`, { title: 'Delete reminder', label: 'Delete' })) return;
    act(() => api.deleteReminder(reminder.id), 'Reminder deleted');
  }
  // Reminders the old Engineer Hub kept only in this browser.
  async function importLegacy() {
    await act(async () => {
      for (const item of legacy) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(item.next || '') ? item.next : localDateISO(new Date());
        await api.createReminder({ title: String(item.title || 'Reminder').slice(0, 200), due_at: toInstant(date, '09:00'), time_zone: timeZone(), repeat: ['daily', 'weekly', 'monthly'].includes(item.cadence) ? item.cadence : 'none' });
      }
      try { localStorage.removeItem(legacyKey); } catch { /* storage unavailable */ }
      setLegacy([]);
    }, `Moved ${legacy.length} reminder${legacy.length === 1 ? '' : 's'} to your account`);
  }
  async function toggleAutomatic(key, enabled) {
    setBusy(true);
    try { const result = await api.updateReminderSettings({ [key]: enabled }); setData(current => ({ ...current, automatic: result.automatic })); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }

  const due = (data?.active || []).filter(reminder => reminder.due_at <= now);
  const upcoming = (data?.active || []).filter(reminder => reminder.due_at > now);
  const row = (reminder, isDue) => <ReminderRow key={reminder.id} reminder={reminder} due={isDue} busy={busy}
    onDone={() => act(() => api.completeReminder(reminder.id), reminder.repeat === 'none' ? 'Done' : 'Done — moved to the next time')}
    onSnooze={until => act(() => api.snoozeReminder(reminder.id, until.toISOString()), `Snoozed until ${whenLabel(until.toISOString())}`)}
    onEdit={() => setEditing(reminder)} onDelete={() => remove(reminder)} />;

  return <div className="page reminders-page">
    <PageHeader title="Reminders" actions={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={14} /> New reminder</button>} />
    {error && <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
    {legacy.length > 0 && <div className="reminders-legacy" role="status">
      <span>{legacy.length} reminder{legacy.length === 1 ? ' was' : 's were'} saved only in this browser, so {legacy.length === 1 ? 'it never' : 'they never'} reached you anywhere else.</span>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={importLegacy}>Move to my account</button>
    </div>}
    {!data && !error ? <div className="skeleton-table"><span /><span /><span /></div> : data && <>
      <Surface title="Due now" description={due.length ? 'Mark each one done, or snooze it.' : undefined}>
        {due.length ? <ul className="reminder-list">{due.map(reminder => row(reminder, true))}</ul> : <p className="text-muted reminders-empty">Nothing due. You'll get a notification here and on your chosen channels when a reminder comes up.</p>}
      </Surface>
      <Surface title="Coming up">
        {upcoming.length ? <ul className="reminder-list">{upcoming.map(reminder => row(reminder, false))}</ul> : <div className="reminders-empty"><p className="text-muted">No reminders set.</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}><BellRing size={13} /> Set a reminder</button></div>}
      </Surface>
      <Surface title="Automatic reminders" description="The app reminds you about these by itself, each morning.">
        <div className="reminders-automatic">{data.automatic.map(item => <Toggle key={item.key} checked={item.enabled} disabled={busy} onChange={value => toggleAutomatic(item.key, value)} label={item.label} />)}</div>
        <p className="text-muted text-sm">Reminders always appear in the bell. Choose which also reach your Teams, email or Webex in <Link to="/profile">your profile</Link>.</p>
      </Surface>
      {data.done.length > 0 && <details className="reminders-done"><summary>Done in the last 30 days ({data.done.length})</summary><ul>{data.done.map(reminder => <li key={reminder.id}><span>{reminder.title}</span><small>{whenLabel(reminder.completed_at)}</small></li>)}</ul></details>}
    </>}
    {editing && <ReminderForm initial={editing === 'new' ? null : editing} customers={data?.customers || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
  </div>;
}
