import { useEffect, useState } from 'react';
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { DraftChecklist } from './TaskSubtasks';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { useLiveVersion } from '../live';
import { businessToday } from '../utils/dates';

/* Customer 360 → Tasks: tasks that repeat for this customer, for one engineer or
   a whole team, optionally about one asset or technology. Each occurrence becomes
   a real task a few days before it is due (server/recurringTasks.js); a team task
   shows in every member's tasks and whoever completes it takes it. */

export const FREQUENCY_LABELS = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', quarterly: 'Every 3 months', semiannual: 'Every 6 months', annual: 'Every year', custom: 'Custom…' };
const UNIT_LABELS = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] };
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export function repeatLabel(row) {
  if (row.frequency !== 'custom') return FREQUENCY_LABELS[row.frequency];
  const [one, many] = UNIT_LABELS[row.interval_unit] || ['', ''];
  return row.interval_count === 1 ? `Every ${one}` : `Every ${row.interval_count} ${many}`;
}

function RecurringForm({ customerId, initial, engineers, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || '', description: initial?.description || '', priority: initial?.priority || 'medium',
    frequency: initial?.frequency || 'monthly', interval_count: initial?.interval_count ?? 3, interval_unit: initial?.interval_unit || 'day',
    start_date: initial?.start_date || businessToday(), lead_days: initial?.lead_days ?? 7,
    assignee: initial?.team_id ? 'team' : 'engineer',
    assigned_to: initial?.assigned_to ? String(initial.assigned_to) : '', team_id: initial?.team_id ? String(initial.team_id) : '',
    asset_id: initial?.asset_id ? String(initial.asset_id) : '', technology_id: initial?.technology_id ? String(initial.technology_id) : '',
    notify: initial?.notify ?? false, checklist: (initial?.subtasks || []).map(title => ({ title })),
  }));
  const [options, setOptions] = useState({ teams: [], assets: [], technologies: [] });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  useEffect(() => {
    // The asset list comes with the contracts view, which lists all of the customer's assets.
    Promise.all([api.teams().catch(() => []), customerId == null ? {} : api.customerContracts(customerId).catch(() => ({})), api.technologies().catch(() => [])])
      .then(([teams, contracts, technologies]) => setOptions({ teams: teams || [], assets: (contracts.assets || []).filter(a => a.lifecycle_status === 'active' || String(a.id) === form.asset_id), technologies: technologies || [] }));
  }, [customerId]);

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    const team = form.assignee === 'team';
    const body = { title: form.title, priority: form.priority, frequency: form.frequency, start_date: form.start_date, lead_days: Number(form.lead_days),
      description: form.description.trim() || null, notify: form.notify, subtasks: form.checklist.map(item => item.title),
      assigned_to: !team && form.assigned_to ? Number(form.assigned_to) : null, team_id: team && form.team_id ? Number(form.team_id) : null,
      asset_id: form.asset_id ? Number(form.asset_id) : null, technology_id: form.technology_id ? Number(form.technology_id) : null,
      ...(form.frequency === 'custom' ? { interval_count: Number(form.interval_count), interval_unit: form.interval_unit } : {}) };
    try {
      if (initial) await api.updateCustomerRecurringTask(customerId, initial.id, body);
      else await api.createCustomerRecurringTask(customerId, body);
      onSaved(initial ? 'Recurring task updated' : 'Recurring task added');
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  const [one, many] = UNIT_LABELS[form.interval_unit];
  return <Modal title={initial ? 'Edit recurring task' : 'New recurring task'} onClose={onClose}>
    <form onSubmit={submit} className="rt-form">
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="rt-title">Task *</label><input id="rt-title" value={form.title} onChange={set('title')} maxLength={300} required placeholder="For example, Firewall log review" /></div>
      <div className="form-group"><label htmlFor="rt-description">Description</label><textarea id="rt-description" value={form.description} onChange={set('description')} rows={2} maxLength={5000} /></div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="rt-frequency">Repeats</label><select id="rt-frequency" value={form.frequency} onChange={set('frequency')}>{Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-group"><label htmlFor="rt-start">First due date</label><input id="rt-start" type="date" value={form.start_date} onChange={set('start_date')} required /></div>
      </div>
      {form.frequency === 'custom' && <div className="form-group rt-every"><span id="rt-every-label">Repeat every</span>
        <input aria-label="Repeat every" type="number" min="1" max="365" step="1" value={form.interval_count} onChange={set('interval_count')} required />
        <select aria-label="Unit" value={form.interval_unit} onChange={set('interval_unit')}>{Object.keys(UNIT_LABELS).map(unit => <option key={unit} value={unit}>{Number(form.interval_count) === 1 ? UNIT_LABELS[unit][0] : UNIT_LABELS[unit][1]}</option>)}</select>
        <small className="text-muted">e.g. every 3 {Number(form.interval_count) === 1 ? one : many}</small>
      </div>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="rt-lead">Create it this many days before</label><input id="rt-lead" type="number" min="0" max="90" step="1" value={form.lead_days} onChange={set('lead_days')} required /></div>
        <div className="form-group"><label htmlFor="rt-priority">Priority</label><select id="rt-priority" value={form.priority} onChange={set('priority')}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <fieldset className="rt-assignee"><legend>For</legend>
        <label><input type="radio" name="rt-assignee" value="engineer" checked={form.assignee === 'engineer'} onChange={set('assignee')} /> One engineer</label>
        <label><input type="radio" name="rt-assignee" value="team" checked={form.assignee === 'team'} onChange={set('assignee')} /> A team</label>
        {form.assignee === 'engineer'
          ? <select aria-label="Engineer" value={form.assigned_to} onChange={set('assigned_to')}><option value="">Unassigned</option>{engineers.map(engineer => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}</select>
          : <><select aria-label="Team" value={form.team_id} onChange={set('team_id')} required><option value="">Choose a team</option>{options.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
            <small className="text-muted">It shows in the tasks of everyone in the team; whoever completes it takes it.</small></>}
      </fieldset>
      <div className="form-row">
        {customerId != null && <div className="form-group"><label htmlFor="rt-asset">Asset</label><select id="rt-asset" value={form.asset_id} onChange={set('asset_id')}><option value="">Any / none</option>{options.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></div>}
        <div className="form-group"><label htmlFor="rt-technology">Technology</label><select id="rt-technology" value={form.technology_id} onChange={set('technology_id')}><option value="">Any / none</option>{options.technologies.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></div>
      </div>
      <fieldset className="ct-subtasks"><legend>Checklist</legend>
        <small className="text-muted">Optional. Each task this creates gets these as subtasks, and is completed when all are done.</small>
        <DraftChecklist value={form.checklist} onChange={list => setForm(current => ({ ...current, checklist: list }))} />
      </fieldset>
      <label className="rt-notify"><input type="checkbox" checked={form.notify} onChange={set('notify')} /> Notify the engineer (or the team) when each task is created</label>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add recurring task'}</button></div>
    </form>
  </Modal>;
}

function History({ history }) {
  if (!history?.created) return <span className="text-muted">None yet</span>;
  return <>{history.completed} of {history.created} done{history.completed ? `, ${history.on_time} on time` : ''}
    {history.overdue > 0 && <div className="text-sm rt-overdue">{history.overdue} overdue</div>}</>;
}

export default function CustomerRecurringTasks({ customerId, canManage, engineers = [], internal = false }) {
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
    {error ? <div className="error-msg" role="alert">{error}</div> : !rows.length ? <p className="text-muted text-sm">{internal ? 'Nothing repeats yet. Add our own work that comes round on a schedule, such as a backup review every week or an SSL renewal every year, for an engineer or a whole team.' : 'Nothing repeats for this customer yet. Add a task that comes round on a schedule, such as a firewall log review every 2 weeks, for an engineer or a whole team.'}</p> :
      <table className="cs-work-table"><thead><tr><th>Task</th><th>Repeats</th><th>Next due</th><th>For</th><th>Done so far</th><th>Status</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={row.active ? '' : 'is-paused'}>
          <td data-label="Task">{row.title}{row.subtasks?.length > 0 && <span className="text-muted text-sm"> · {row.subtasks.length} checklist item{row.subtasks.length === 1 ? '' : 's'}</span>}{row.priority !== 'medium' && <span className={`badge badge-${row.priority}`}> {row.priority}</span>}
            {(row.asset_name || row.technology_name) && <div className="text-muted text-sm">{[row.asset_name, row.technology_name].filter(Boolean).join(' · ')}</div>}</td>
          <td data-label="Repeats">{repeatLabel(row)}<div className="text-muted text-sm">created {row.lead_days === 0 ? 'on the day' : `${row.lead_days} day${row.lead_days === 1 ? '' : 's'} before`}</div></td>
          <td data-label="Next due">{row.active ? fmtDate(row.next_due) : '—'}</td>
          <td data-label="For">{row.team_name ? <>{row.team_name}<div className="text-muted text-sm">team</div></> : row.assigned_to_name || 'Unassigned'}</td>
          <td data-label="Done so far"><History history={row.history} /></td>
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
