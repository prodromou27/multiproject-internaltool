import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './Shared';
import CheckList from './CheckList';
import { linesOf } from './TaskSubtasks';

/* Customer 360 → Tasks → Add task: a one-off task for this customer. Managers
   give it to any engineer or team (or leave it unassigned); engineers take it
   themselves or give it to a team they are in, where whoever starts or
   completes it takes it (server: routes/tasks.js). `initial` prefills it, e.g.
   an upgrade task for one asset from an asset review, or `initial.subtasks`
   ({ title, asset_id }) for one task with a subtask per outdated server.
   Subtasks: typed (one per line) and/or one per chosen asset. */
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];

export default function CustomerTaskForm({ customerId, isManager, engineers = [], initial = {}, onClose, onSaved }) {
  const [form, setForm] = useState({ title: initial.title || '', description: initial.description || '', priority: initial.priority || 'medium', deadline: '', assignee: isManager ? 'engineer' : 'me', assigned_to: '', team_id: '' });
  const [teams, setTeams] = useState([]), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [lines, setLines] = useState(''), [assets, setAssets] = useState(null), [picking, setPicking] = useState(!!initial.subtasks?.length);
  // Chosen assets, each with its subtask title (an asset's name unless prefilled).
  const [picked, setPicked] = useState(() => new Map((initial.subtasks || []).map(item => [item.asset_id, item.title])));
  useEffect(() => {
    const controller = new AbortController();
    api.customerAssetOptions(customerId, { signal: controller.signal }).then(setAssets).catch(() => setAssets([]));
    return () => controller.abort();
  }, [customerId]);
  const choose = ids => setPicked(current => new Map(ids.map(id => [id, current.get(id) || assets.find(asset => asset.id === id)?.name || 'Asset'])));
  const subtasks = [...[...picked].map(([asset_id, title]) => ({ title, asset_id })), ...linesOf(lines).map(title => ({ title }))];
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  useEffect(() => {
    const load = isManager ? api.teams() : api.teamsMine().then(result => result.teams || []);
    load.then(list => { setTeams(list); if (list.length === 1) setForm(current => ({ ...current, team_id: String(list[0].id) })); }).catch(() => setTeams([]));
  }, [isManager]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { title: form.title, description: form.description || null, priority: form.priority, deadline: form.deadline || null, customer_id: Number(customerId), ...(initial.asset_id ? { asset_id: initial.asset_id } : {}), ...(subtasks.length ? { subtasks } : {}) };
    if (form.assignee === 'team') body.team_id = Number(form.team_id);
    else if (form.assignee === 'engineer' && form.assigned_to) body.assigned_to = Number(form.assigned_to);
    try { await api.createTask(body); onSaved(); } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  return <Modal title="Add task" onClose={onClose}>
    <form onSubmit={submit} className="rt-form">
      {error && <div className="error-msg" role="alert">{error}</div>}
      {initial.asset_name && <p className="text-sm text-muted">About asset <strong>{initial.asset_name}</strong></p>}
      <div className="form-group"><label htmlFor="ct-title">Task *</label><input id="ct-title" value={form.title} onChange={set('title')} maxLength={500} required placeholder="For example, Replace the failed disk on NAS-01" /></div>
      <div className="form-group"><label htmlFor="ct-description">Description</label><textarea id="ct-description" value={form.description} onChange={set('description')} rows={3} maxLength={10000} /></div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="ct-deadline">Due date</label><input id="ct-deadline" type="date" value={form.deadline} onChange={set('deadline')} /></div>
        <div className="form-group"><label htmlFor="ct-priority">Priority</label><select id="ct-priority" value={form.priority} onChange={set('priority')}>{PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <fieldset className="rt-assignee"><legend>Who does it</legend>
        {isManager
          ? <label><input type="radio" name="ct-assignee" value="engineer" checked={form.assignee === 'engineer'} onChange={set('assignee')} /> One engineer</label>
          : <label><input type="radio" name="ct-assignee" value="me" checked={form.assignee === 'me'} onChange={set('assignee')} /> Me</label>}
        <label><input type="radio" name="ct-assignee" value="team" checked={form.assignee === 'team'} onChange={set('assignee')} disabled={!teams.length} /> {isManager ? 'A team' : 'My team'}</label>
        {form.assignee === 'engineer' && <select aria-label="Engineer" value={form.assigned_to} onChange={set('assigned_to')}><option value="">Unassigned</option>{engineers.map(engineer => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}</select>}
        {form.assignee === 'team' && <><select aria-label="Team" value={form.team_id} onChange={set('team_id')} required><option value="">Choose a team</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
          <small className="text-muted">It shows in the tasks of everyone in the team, and they are told; whoever starts or completes it takes it.</small></>}
      </fieldset>
      <fieldset className="ct-subtasks"><legend>Subtasks {subtasks.length > 0 && <span className="text-muted">({subtasks.length})</span>}</legend>
        <small className="text-muted">Optional. The task can be completed when all its subtasks are done.</small>
        <textarea aria-label="Subtasks, one per line" rows={2} value={lines} onChange={event => setLines(event.target.value)} placeholder="One per line, e.g. Take a backup" />
        {assets?.length > 0 && (picking
          ? <CheckList label="Assets" options={assets.map(asset => ({ id: asset.id, label: asset.name, detail: [asset.asset_type, asset.software_version].filter(Boolean).join(' · ') }))}
            selected={[...picked.keys()]} onChange={choose} searchPlaceholder="Search assets…" />
          : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>Add one per asset (e.g. each server)</button>)}
      </fieldset>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add task'}</button></div>
    </form>
  </Modal>;
}
