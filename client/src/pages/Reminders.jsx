import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Check, Clock, Pencil, Plus, Repeat, Trash2, UserRound, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { Modal } from '../components/Shared';
import { PageHeader } from '../components/PageLayout';
import { Surface } from '../components/EnterpriseUI';
import { Toggle } from './admin/shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { localDateISO } from '../utils/dates';
import { useLiveRefresh } from '../live';

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

// `defaults` pre-fills a new reminder, e.g. from a customer: { customer_id, for, team_id }.
export function ReminderForm({ initial, group, teamReminder, customers, people, teams, sharedTeams = [], sharedChannels = { teams: false, webex: false }, defaults, onClose, onSaved }) {
  const toast = useToast();
  const source = group || teamReminder || initial;
  const start = source ? new Date(source.due_at) : (() => { const next = new Date(); next.setHours(next.getHours() + 1, 0, 0, 0); return next; })();
  const [form, setForm] = useState({ title: source?.title || '', date: localDateISO(start), time: localTime(start), repeat: source?.repeat || 'none', customer_id: source?.customer_id ? String(source.customer_id) : defaults?.customer_id ? String(defaults.customer_id) : '', notes: source?.notes || '', for: defaults?.for || 'me', user_id: '', team_id: defaults?.team_id ? String(defaults.team_id) : '',
    // Delivery: undefined means the default for the kind of reminder (shared channels on for team reminders).
    notify_personal: source ? source.notify_personal !== false : true, post_shared: source ? !!source.post_shared : undefined });
  const isTeam = form.for === 'shared' || form.for === 'team' || !!teamReminder || !!group;
  const anyShared = sharedChannels.teams || sharedChannels.webex;
  const sharedLabel = [sharedChannels.teams && 'Teams channel', sharedChannels.webex && 'Webex space'].filter(Boolean).join(' and ') || 'Teams channel and Webex space';
  const postShared = form.post_shared ?? (form.for === 'shared' || !!teamReminder);
  // Managers can set a new reminder for someone else or a whole team.
  const canAssign = !source && (people.length > 0 || teams.length > 0 || sharedTeams.length > 0);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { title: form.title, due_at: toInstant(form.date, form.time), time_zone: timeZone(), repeat: form.repeat, customer_id: form.customer_id || null, notes: form.notes };
    if (form.for === 'person') body.for = { user_id: Number(form.user_id) };
    if (form.for === 'team') body.for = { team_id: Number(form.team_id) };
    if (form.for === 'shared') body.for = { team_id: Number(form.team_id), shared: true };
    body.notify_personal = form.notify_personal;
    body.post_shared = postShared;
    try {
      const saved = group ? await api.updateReminderGroup(group.group_key, body) : teamReminder ? await api.updateTeamReminder(teamReminder.id, body) : initial ? await api.updateReminder(initial.id, body) : await api.createReminder(body);
      toast.success(group ? `Updated for ${group.recipients.length} ${group.recipients.length === 1 ? 'person' : 'people'}` : teamReminder ? 'Team reminder updated' : initial ? 'Reminder updated'
        : body.for?.shared ? `Team reminder set for ${saved.team_name}` : body.for ? `Reminder set for ${saved.recipients} ${saved.recipients === 1 ? 'person' : 'people'}` : 'Reminder set');
      onSaved(saved);
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title={group ? 'Edit reminder for others' : teamReminder ? `Edit ${teamReminder.team_name} team reminder` : initial ? 'Edit reminder' : 'New reminder'} onClose={onClose}>
    <form className="reminder-form" onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      {canAssign && <div className="form-group"><label htmlFor="reminder-for">For</label><div className="reminder-form-for">
        <select id="reminder-for" value={form.for} onChange={event => setForm(current => ({ ...current, for: event.target.value, team_id: '' }))}><option value="me">Me</option>{sharedTeams.length > 0 && <option value="shared">A team, until someone completes it</option>}{people.length > 0 && <option value="person">Someone else</option>}{teams.length > 0 && <option value="team">Each member of a team</option>}</select>
        {form.for === 'person' && <select aria-label="Person" required value={form.user_id} onChange={set('user_id')}><option value="">Choose a person</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
        {form.for === 'shared' && <select aria-label="Team" required value={form.team_id} onChange={set('team_id')}><option value="">Choose a team</option>{sharedTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
        {form.for === 'team' && <select aria-label="Team" required value={form.team_id} onChange={set('team_id')}><option value="">Choose a team</option>{teams.map(team => <option key={team.id} value={team.id} disabled={!team.members}>{team.name} ({team.members} {team.members === 1 ? 'person' : 'people'})</option>)}</select>}
      </div>{form.for === 'team' && <small className="text-muted">Each member gets their own copy to mark done.</small>}{form.for === 'shared' && <small className="text-muted">Everyone in the team is reminded when it is due, and every day after, until someone marks it done.</small>}</div>}
      {group && <p className="text-sm text-muted">Changes apply to all {group.recipients.length} {group.recipients.length === 1 ? 'recipient' : 'recipients'}, and start it again for anyone who had finished it.</p>}
      <div className="form-group"><label htmlFor="reminder-title">What to remember</label><input id="reminder-title" required maxLength={200} autoFocus value={form.title} onChange={set('title')} placeholder="e.g. Check the Veeam backup report" /></div>
      <div className="reminder-form-when">
        <div className="form-group"><label htmlFor="reminder-date">Date</label><input id="reminder-date" type="date" required value={form.date} onChange={set('date')} /></div>
        <div className="form-group"><label htmlFor="reminder-time">Time</label><input id="reminder-time" type="time" required value={form.time} onChange={set('time')} /></div>
        <div className="form-group"><label htmlFor="reminder-repeat">Repeat</label><select id="reminder-repeat" value={form.repeat} onChange={set('repeat')}>{Object.entries(REPEAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="form-group"><label htmlFor="reminder-customer">Customer (optional)</label><select id="reminder-customer" value={form.customer_id} onChange={set('customer_id')}><option value="">None</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
      <fieldset className="reminder-delivery"><legend>Also send to</legend>
        <label><input type="checkbox" checked={form.notify_personal} onChange={event => setForm(current => ({ ...current, notify_personal: event.target.checked }))} /><span>{isTeam ? "Each team member's" : 'Your'} own Teams, email or Webex <small>(as chosen in Profile)</small></span></label>
        <label className={anyShared ? '' : 'is-unavailable'}><input type="checkbox" disabled={!anyShared} checked={anyShared && postShared} onChange={event => setForm(current => ({ ...current, post_shared: event.target.checked }))} /><span>The shared {sharedLabel}
          {!anyShared && <small> (not set up yet: a manager adds them in Settings → Integrations)</small>}</span></label>
        <small className="text-muted">It always appears in the bell and on the Reminders page.</small>
      </fieldset>
      <div className="form-group"><label htmlFor="reminder-notes">Notes (optional)</label><textarea id="reminder-notes" rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} /></div>
      <div className="flex gap-8"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial || group || teamReminder ? 'Save reminder' : 'Set reminder'}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
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
        {reminder.set_by && <span><UserRound size={12} aria-hidden="true" />Set by {reminder.set_by}</span>}
      </div>
      {reminder.notes && <p>{reminder.notes}</p>}
    </div>
    <div className="reminder-item-actions">
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onDone} title={reminder.repeat === 'none' ? 'Mark as done' : 'Done for now; moves to the next time'}><Check size={13} /> Done</button>
      {due && <details className="reminder-snooze"><summary className="btn btn-ghost btn-sm">Snooze</summary><div role="menu">{snoozeOptions().map(([label, until]) => <button key={label} type="button" role="menuitem" disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; onSnooze(until); }}>{label}</button>)}</div></details>}
      {!reminder.set_by && <>
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${reminder.title}`} disabled={busy} onClick={onEdit}><Pencil size={13} /></button>
        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${reminder.title}`} disabled={busy} onClick={onDelete}><Trash2 size={13} /></button>
      </>}
    </div>
  </li>;
}

export default function Reminders() {
  const { user } = useAuth();
  const toast = useToast(), confirm = useConfirm();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null, 'new' or a reminder
  const [editingGroup, setEditingGroup] = useState(null); // a set of reminders for others
  const [editingTeam, setEditingTeam] = useState(null); // a shared team reminder
  const [now, setNow] = useState(() => new Date().toISOString());
  const legacyKey = `hub_recurring_${user.id}`;
  const [legacy, setLegacy] = useState(() => { try { return JSON.parse(localStorage.getItem(legacyKey) || '[]'); } catch { return []; } });

  const load = useCallback(() => api.reminders().then(result => { setData(result); setError(''); }).catch(failure => setError(failure.message)), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  // Move reminders into "Due now" as their time arrives, and pick up changes made elsewhere.
  useEffect(() => { const timer = setInterval(() => { setNow(new Date().toISOString()); load(); }, 60000); return () => clearInterval(timer); }, [load]);

  async function act(work, message) {
    setBusy(true);
    try { await work(); if (message) toast.success(message); await load(); } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  async function removeTeamReminder(reminder) {
    if (!await confirm(`Delete the ${reminder.team_name} team reminder "${reminder.title}"?`, { title: 'Delete team reminder', label: 'Delete' })) return;
    act(() => api.deleteTeamReminder(reminder.id), 'Team reminder deleted');
  }
  async function removeGroup(group) {
    if (!await confirm(`Delete "${group.title}" for all ${group.recipients.length} ${group.recipients.length === 1 ? 'recipient' : 'recipients'}?`, { title: 'Delete reminder', label: 'Delete' })) return;
    act(() => api.deleteReminderGroup(group.group_key), 'Reminder deleted for everyone');
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
      {(data.team_reminders.active.length > 0 || data.shared_teams.length > 0) && <Surface title="Team reminders" description="Shared with your team. Everyone is reminded daily once due, until someone marks it done.">
        {data.team_reminders.active.length ? <ul className="reminder-list">{data.team_reminders.active.map(reminder => {
          const isDue = reminder.due_at <= now;
          return <li key={reminder.id} className={`reminder-item${isDue ? ' is-due' : ''}`}>
            <div className="reminder-item-main">
              <strong>{reminder.title}</strong>
              <div className="reminder-item-meta">
                <span><Users size={12} aria-hidden="true" />{reminder.team_name}</span>
                <span><Clock size={12} aria-hidden="true" />{isDue ? `Due since ${whenLabel(reminder.due_at)}` : whenLabel(reminder.due_at)}</span>
                {reminder.repeat !== 'none' && <span><Repeat size={12} aria-hidden="true" />{REPEAT_LABELS[reminder.repeat]}</span>}
                {reminder.customer_name && <Link to={`/customers/${reminder.customer_id}/service-profile`}>{reminder.customer_name}</Link>}
                <span><UserRound size={12} aria-hidden="true" />Set by {reminder.set_by}</span>
                {reminder.completed_by && <span>Last done by {reminder.completed_by}, {whenLabel(reminder.completed_at)}</span>}
                {reminder.post_shared && <span>Also posted to the team channel</span>}
              </div>
              {reminder.notes && <p>{reminder.notes}</p>}
            </div>
            <div className="reminder-item-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} title="Mark done for the whole team" onClick={() => act(() => api.completeTeamReminder(reminder.id), reminder.repeat === 'none' ? `Done for the ${reminder.team_name} team` : 'Done for the team — moved to the next time')}><Check size={13} /> Done for team</button>
              {reminder.can_change && <>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${reminder.title}`} disabled={busy} onClick={() => setEditingTeam(reminder)}><Pencil size={13} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${reminder.title}`} disabled={busy} onClick={() => removeTeamReminder(reminder)}><Trash2 size={13} /></button>
              </>}
            </div>
          </li>;
        })}</ul> : <p className="text-muted reminders-empty">No team reminders. Use New reminder and choose a team, for things like certificate or licence renewals.</p>}
        {data.team_reminders.done.length > 0 && <details className="reminders-done"><summary>Completed in the last 30 days ({data.team_reminders.done.length})</summary><ul>{data.team_reminders.done.map(reminder => <li key={reminder.id}><span>{reminder.title} · {reminder.team_name}</span><small>{reminder.completed_by ? `${reminder.completed_by}, ` : ''}{whenLabel(reminder.completed_at)}</small></li>)}</ul></details>}
      </Surface>}
      <Surface title="Coming up">
        {upcoming.length ? <ul className="reminder-list">{upcoming.map(reminder => row(reminder, false))}</ul> : <div className="reminders-empty"><p className="text-muted">No reminders set.</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}><BellRing size={13} /> Set a reminder</button></div>}
      </Surface>
      {data.set_for_others && <Surface title="Set for others" description="Reminders you set for people or teams, and how far each person has got.">
        {data.set_for_others.length ? <ul className="reminder-list">{data.set_for_others.map(group => {
          const done = group.recipients.filter(item => item.status === 'done').length;
          return <li key={group.group_key} className="reminder-item">
            <div className="reminder-item-main">
              <strong>{group.title}</strong>
              <div className="reminder-item-meta">
                <span>{group.team_name ? <Users size={12} aria-hidden="true" /> : <UserRound size={12} aria-hidden="true" />}{group.team_name || group.recipients[0]?.name}</span>
                <span><Clock size={12} aria-hidden="true" />{whenLabel(group.due_at)}</span>
                {group.repeat !== 'none' && <span><Repeat size={12} aria-hidden="true" />{REPEAT_LABELS[group.repeat]}</span>}
                {group.repeat === 'none' && <span>{done} of {group.recipients.length} done</span>}
              </div>
              {group.recipients.length > 1 && <div className="reminder-recipients">{group.recipients.map(item => <span key={item.id} className={item.status === 'done' ? 'is-done' : ''}>{item.status === 'done' && <Check size={11} aria-hidden="true" />}{item.name}</span>)}</div>}
            </div>
            <div className="reminder-item-actions">
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${group.title} for others`} disabled={busy} onClick={() => setEditingGroup(group)}><Pencil size={13} /></button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${group.title} for others`} disabled={busy} onClick={() => removeGroup(group)}><Trash2 size={13} /></button>
            </div>
          </li>;
        })}</ul> : <p className="text-muted reminders-empty">None yet. Use New reminder and choose who it is for.</p>}
      </Surface>}
      <Surface title="Automatic reminders" description="The app reminds you about these by itself, each morning.">
        <div className="reminders-automatic">{data.automatic.map(item => <Toggle key={item.key} checked={item.enabled} disabled={busy} onChange={value => toggleAutomatic(item.key, value)} label={item.label} />)}</div>
        <p className="text-muted text-sm">Reminders always appear in the bell. Choose which also reach your Teams, email or Webex in <Link to="/profile">your profile</Link>.</p>
      </Surface>
      {data.done.length > 0 && <details className="reminders-done"><summary>Done in the last 30 days ({data.done.length})</summary><ul>{data.done.map(reminder => <li key={reminder.id}><span>{reminder.title}</span><small>{whenLabel(reminder.completed_at)}</small></li>)}</ul></details>}
    </>}
    {editing && <ReminderForm initial={editing === 'new' ? null : editing} customers={data?.customers || []} people={data?.people || []} teams={data?.teams || []} sharedTeams={data?.shared_teams || []} sharedChannels={data?.shared_channels} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    {editingTeam && <ReminderForm teamReminder={editingTeam} customers={data?.customers || []} people={[]} teams={[]} sharedChannels={data?.shared_channels} onClose={() => setEditingTeam(null)} onSaved={() => { setEditingTeam(null); load(); }} />}
    {editingGroup && <ReminderForm group={editingGroup} customers={data?.customers || []} people={[]} teams={[]} sharedChannels={data?.shared_channels} onClose={() => setEditingGroup(null)} onSaved={() => { setEditingGroup(null); load(); }} />}
  </div>;
}
