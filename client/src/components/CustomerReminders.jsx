import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Check, Clock, Plus, Repeat, Users } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';
import { ReminderForm } from '../pages/Reminders';
import { useLiveRefresh } from '../live';

const REPEAT_LABELS = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
const when = iso => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* Reminders about one customer (e.g. certificate or licence renewals), on Customer 360.
   New ones default to the customer's team, shared until someone completes them. */
export default function CustomerReminders({ customer, adding, onAddingChange }) {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback((signal) => api.customerReminders(customer.id, { signal }).then(setData).catch(failure => { if (!signal?.aborted) setError(failure.message); }), [customer.id]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  useLiveRefresh(() => load());

  async function complete(reminder, team) {
    setBusy(true);
    try {
      if (team) await api.completeTeamReminder(reminder.id); else await api.completeReminder(reminder.id);
      toast.success(team ? `Done for the ${reminder.team_name} team` : 'Reminder done');
      await load();
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }

  const now = new Date().toISOString();
  const rows = data ? [...data.team.active.map(row => ({ ...row, team: true })), ...data.own.active].sort((a, b) => a.due_at.localeCompare(b.due_at)) : [];
  return <section className="card cs-reminders" aria-label="Customer reminders">
    <div className="cs-reminders-head">
      <h2><BellRing size={15} aria-hidden="true" /> Reminders</h2>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddingChange(true)}><Plus size={13} /> Add reminder</button>
    </div>
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <div className="skeleton-table"><span /></div> : rows.length ? <ul>{rows.map(reminder => {
      const due = reminder.due_at <= now;
      return <li key={`${reminder.team ? 't' : 'p'}${reminder.id}`} className={due ? 'is-due' : ''}>
        <div>
          <strong>{reminder.title}</strong>
          <span className="cs-reminders-meta">
            <span><Clock size={12} aria-hidden="true" />{due ? `Due since ${when(reminder.due_at)}` : when(reminder.due_at)}</span>
            {REPEAT_LABELS[reminder.repeat] && <span><Repeat size={12} aria-hidden="true" />{REPEAT_LABELS[reminder.repeat]}</span>}
            <span>{reminder.team ? <><Users size={12} aria-hidden="true" />{reminder.team_name}</> : 'Just you'}</span>
          </span>
        </div>
        {due && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => complete(reminder, reminder.team)}><Check size={13} /> {reminder.team ? 'Done for team' : 'Done'}</button>}
      </li>;
    })}</ul> : <p className="text-muted text-sm">No reminders for {customer.name}. Add one for renewals and other dates the team must not miss, such as an SSL certificate or a licence.</p>}
    <Link className="text-sm" to="/reminders">All reminders</Link>
    {adding && data && <ReminderForm customers={[{ id: customer.id, name: customer.name }]} people={[]} teams={[]} sharedTeams={data.shared_teams} sharedChannels={data.shared_channels}
      defaults={{ customer_id: customer.id, for: data.default_team_id ? 'shared' : 'me', team_id: data.default_team_id }}
      onClose={() => onAddingChange(false)} onSaved={() => { onAddingChange(false); load(); }} />}
  </section>;
}
