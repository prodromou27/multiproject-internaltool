import { useEffect, useState } from 'react';
import { ListChecks, Plus, Server, Ticket, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useToast } from './Toast';
import CheckList from './CheckList';
import './TaskSubtasks.css';

/* Subtasks of a task (a checklist, as in Planner): the task cannot be completed
   until every one is ticked (server: routes/task-subtasks.js). Several lines
   pasted at once become several subtasks; a customer task can add one per asset. */

/** Lines of text → subtask titles (blank lines dropped). */
export const linesOf = text => String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export function SubtaskProgress({ total = 0, done = 0, onClick, compact = false }) {
  if (!total && !onClick) return null;
  const label = total ? `${done}/${total}` : 'Add subtasks';
  const content = <><ListChecks size={12} aria-hidden="true" /> {label}{total > 0 && <span className="st-bar" aria-hidden="true"><i style={{ width: `${Math.round(done / total * 100)}%` }} /></span>}</>;
  const title = total ? `${done} of ${total} subtasks done` : 'Add subtasks';
  return onClick
    ? <button type="button" className={`st-chip${total && done === total ? ' is-done' : ''}${compact ? ' is-compact' : ''}`} onClick={onClick} title={title} aria-label={`Subtasks: ${title}`}>{content}</button>
    : <span className={`st-chip${done === total ? ' is-done' : ''}`} title={title}>{content}</span>;
}

export default function TaskSubtasks({ taskId, customerId = null, canEdit = true, onChange }) {
  const toast = useToast();
  const [items, setItems] = useState(null), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [assets, setAssets] = useState(null), [picking, setPicking] = useState(false), [chosen, setChosen] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    api.taskSubtasks(taskId, { signal: controller.signal }).then(setItems).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [taskId]);
  useEffect(() => {
    if (!customerId || !canEdit) return undefined;
    const controller = new AbortController();
    api.customerAssetOptions(customerId, { signal: controller.signal }).then(setAssets).catch(() => setAssets(null));
    return () => controller.abort();
  }, [customerId, canEdit]);
  const apply = list => { setItems(list); onChange?.({ total: list.length, done: list.filter(item => item.done).length }); };
  async function run(action) {
    setBusy(true); setError('');
    try { apply(await action()); return true; } catch (failure) { setError(failure.message); return false; } finally { setBusy(false); }
  }
  // Not a <form>: the panel also sits inside the task's edit form.
  async function add() {
    const titles = linesOf(draft);
    if (!titles.length) return;
    if (await run(() => api.addTaskSubtasks(taskId, { items: titles.map(title => ({ title })) }))) setDraft('');
  }
  async function addAssets() {
    const picked = assets.filter(asset => chosen.includes(asset.id));
    if (await run(() => api.addTaskSubtasks(taskId, { items: picked.map(asset => ({ title: asset.name, asset_id: asset.id })) }))) {
      toast.success(`${picked.length} subtask${picked.length === 1 ? '' : 's'} added`); setPicking(false); setChosen([]);
    }
  }
  if (!items) return error ? <div className="error-msg" role="alert">{error}</div> : <p className="text-muted text-sm" role="status">Loading subtasks…</p>;
  const done = items.filter(item => item.done).length;
  return <section className="st" aria-label="Subtasks">
    <header className="st-head">
      <h3><ListChecks size={15} aria-hidden="true" /> Subtasks</h3>
      {items.length > 0 && <span className="text-sm text-muted">{done} of {items.length} done{done < items.length ? ' · the task closes when all are done' : ''}</span>}
    </header>
    {items.length > 0 && <div className="st-progress" aria-hidden="true"><i style={{ width: `${Math.round(done / items.length * 100)}%` }} /></div>}
    {error && <div className="error-msg" role="alert">{error}</div>}
    <ul className="st-list">
      {items.map(item => <li key={item.id} className={item.done ? 'is-done' : ''}>
        <label>
          <input type="checkbox" checked={item.done} disabled={!canEdit || busy} onChange={() => run(() => api.updateTaskSubtask(taskId, item.id, { done: !item.done }))} />
          <span>{item.title}</span>
        </label>
        {item.asset_name && item.asset_name !== item.title && <span className="st-asset"><Server size={11} aria-hidden="true" /> {item.asset_name}{item.asset_version ? ` · ${item.asset_version}` : ''}</span>}
        {item.asset_name && item.asset_name === item.title && item.asset_version && <span className="st-asset">{item.asset_version}</span>}
        {item.done && item.done_by_name && <small className="text-muted">{item.done_by_name}{item.done_at ? `, ${fmtDate(item.done_at)}` : ''}</small>}
        {canEdit && <button type="button" className="btn btn-ghost btn-sm btn-icon-danger st-remove" disabled={busy} aria-label={`Remove ${item.title}`} title="Remove"
          onClick={() => run(() => api.deleteTaskSubtask(taskId, item.id))}><Trash2 size={13} /></button>}
      </li>)}
      {!items.length && <li className="text-muted text-sm st-empty">No subtasks. Add the steps or servers this task covers; it can be completed when all are done.</li>}
    </ul>
    {canEdit && <div className="st-add">
      <textarea aria-label="New subtasks" rows={Math.min(4, Math.max(1, linesOf(draft).length))} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(); } }}
        placeholder="Add a subtask (one per line for several)" />
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !draft.trim()} onClick={add}><Plus size={13} /> Add</button>
      {assets?.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(value => !value)} aria-expanded={picking}><Server size={13} /> From assets</button>}
    </div>}
    {picking && assets && <div className="st-assets">
      <CheckList label="Assets" options={assets.map(asset => ({ id: asset.id, label: asset.name, detail: [asset.asset_type, asset.software_version].filter(Boolean).join(' · ') }))} selected={chosen} onChange={setChosen} searchPlaceholder="Search assets…" />
      <div className="st-assets-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPicking(false); setChosen([]); }}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!chosen.length || busy} onClick={addAssets}>Add {chosen.length || ''} as subtasks</button></div>
    </div>}
  </section>;
}

/** The subtasks of one task in a dialog, from a list row or a board card. */
export function SubtasksDialog({ task, customerId, canEdit = true, onClose, onChange }) {
  return <Modal title={`Subtasks: ${task.title}`} onClose={onClose}>
    <TaskSubtasks taskId={task.id} customerId={customerId ?? task.customer_id ?? null} canEdit={canEdit} onChange={onChange} />
    <div className="modal-footer"><button type="button" className="btn btn-primary" onClick={onClose}>Done</button></div>
  </Modal>;
}

/** A task's ticket, when it names one: linked to Request Tracker when it is a synced ticket of the customer. */
export function TaskTicket({ task }) {
  if (!task?.ticket_reference) return null;
  if (!task.ticket) return <span className="st-chip" title="Ticket reference"><Ticket size={12} aria-hidden="true" /> {task.ticket_reference}</span>;
  const label = <><Ticket size={12} aria-hidden="true" /> #{task.ticket.number}{task.ticket.status_group === 'closed' ? ' · closed' : ''}</>;
  const title = `Ticket #${task.ticket.number}: ${task.ticket.subject}`;
  return task.ticket.url
    ? <a className="st-chip st-ticket" href={task.ticket.url} target="_blank" rel="noreferrer noopener" title={title} aria-label={title}>{label}</a>
    : <span className="st-chip" title={title}>{label}</span>;
}
