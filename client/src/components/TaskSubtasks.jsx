import { useEffect, useRef, useState } from 'react';
import { GripVertical, ListChecks, MessageSquare, Plus, Server, Ticket, X } from 'lucide-react';
import { api } from '../api';
import { fmtDate, fmtDateTime, Modal } from './Shared';
import { useToast } from './Toast';
import CheckList from './CheckList';
import './TaskSubtasks.css';

/* Subtasks of a task (a checklist, as in Planner): the task cannot be completed
   until every one is ticked, and is completed when the last one is; opening one
   again puts it back in progress (server: routes/task-subtasks.js).
   One editor for both: a task's own checklist, and a new task's draft list. */

/** Lines of text → item titles (blank lines dropped). */
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

function ItemTitle({ item, canEdit, onRename }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(item.title);
  if (!editing || !canEdit) {
    return canEdit
      ? <button type="button" className="st-title" onClick={() => { setValue(item.title); setEditing(true); }} title="Click to rename">{item.title}</button>
      : <span className="st-title">{item.title}</span>;
  }
  const save = () => { setEditing(false); const title = value.trim(); if (title && title !== item.title) onRename(item, title); };
  return <input className="st-rename" aria-label={`Rename ${item.title}`} value={value} maxLength={300} autoFocus onChange={event => setValue(event.target.value)} onBlur={save}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); } }} />;
}

/**
 * The checklist: rows with a tick box (when `onToggle`), a title to click and
 * rename, a remove button and a handle to drag into order; then an "Add an item"
 * line (Enter adds; several pasted lines add several) and, with `assets`, one
 * item per chosen asset.
 */
export function ChecklistEditor({ items, canEdit = true, busy = false, onAdd, onRename, onRemove, onToggle, onReorder, assets = null, onAddAssets }) {
  const [draft, setDraft] = useState(''), [picking, setPicking] = useState(false), [chosen, setChosen] = useState([]);
  const dragged = useRef(null), [over, setOver] = useState(null);
  const input = useRef(null);
  const add = titles => { if (titles.length) { onAdd(titles); setDraft(''); input.current?.focus(); } };
  function drop(target) {
    const from = dragged.current; dragged.current = null; setOver(null);
    if (from == null || from === target) return;
    const order = items.map(item => item.key);
    order.splice(target, 0, order.splice(from, 1)[0]);
    onReorder(order);
  }
  const free = (assets || []).filter(asset => !items.some(item => item.asset_id === asset.id));
  return <div className="st-editor">
    <ul className="st-list">
      {items.map((item, index) => <li key={item.key} className={`${item.done ? 'is-done' : ''}${over === index ? ' is-over' : ''}`}
        draggable={canEdit && !!onReorder} onDragStart={() => { dragged.current = index; }} onDragOver={event => { if (dragged.current != null) { event.preventDefault(); setOver(index); } }}
        onDragLeave={() => setOver(current => (current === index ? null : current))} onDrop={() => drop(index)} onDragEnd={() => { dragged.current = null; setOver(null); }}>
        {canEdit && onReorder && <span className="st-grip" aria-hidden="true" title="Drag to reorder"><GripVertical size={14} /></span>}
        {onToggle && <input type="checkbox" aria-label={item.title} checked={!!item.done} disabled={!canEdit || busy} onChange={() => onToggle(item)} />}
        <ItemTitle item={item} canEdit={canEdit && !busy} onRename={onRename} />
        {item.asset_name && item.asset_name !== item.title && <span className="st-asset"><Server size={11} aria-hidden="true" /> {item.asset_name}{item.asset_version ? ` · ${item.asset_version}` : ''}</span>}
        {item.asset_name && item.asset_name === item.title && item.asset_version && <span className="st-asset">{item.asset_version}</span>}
        {item.done && item.done_by_name && <small className="st-who">{item.done_by_name}{item.done_at ? `, ${fmtDate(item.done_at)}` : ''}</small>}
        {canEdit && <button type="button" className="st-remove" disabled={busy} aria-label={`Remove ${item.title}`} title="Remove" onClick={() => onRemove(item)}><X size={14} /></button>}
      </li>)}
    </ul>
    {canEdit && <div className="st-add">
      <Plus size={15} aria-hidden="true" />
      <input ref={input} aria-label="Add an item" value={draft} maxLength={300} disabled={busy} placeholder="Add an item"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(linesOf(draft)); } }}
        onPaste={event => { const text = event.clipboardData.getData('text'); if (/\r?\n/.test(text.trim())) { event.preventDefault(); add(linesOf(text)); } }} />
      {draft.trim() && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => add(linesOf(draft))}>Add</button>}
    </div>}
    {canEdit && onAddAssets && free.length > 0 && (picking
      ? <div className="st-assets">
        <CheckList label="Assets" options={free.map(asset => ({ id: asset.id, label: asset.name, detail: [asset.asset_type, asset.software_version].filter(Boolean).join(' · ') }))} selected={chosen} onChange={setChosen} searchPlaceholder="Search assets…" />
        <div className="st-assets-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPicking(false); setChosen([]); }}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!chosen.length || busy} onClick={() => { onAddAssets(free.filter(asset => chosen.includes(asset.id))); setPicking(false); setChosen([]); }}>Add {chosen.length || ''} {chosen.length === 1 ? 'item' : 'items'}</button></div>
      </div>
      : <button type="button" className="btn btn-ghost btn-sm st-from-assets" onClick={() => setPicking(true)}><Server size={13} /> Add from assets</button>)}
  </div>;
}

function useAssetOptions(customerId, enabled = true) {
  const [assets, setAssets] = useState(null);
  useEffect(() => {
    if (!customerId || !enabled) return undefined;
    const controller = new AbortController();
    api.customerAssetOptions(customerId, { signal: controller.signal }).then(setAssets).catch(() => setAssets(null));
    return () => controller.abort();
  }, [customerId, enabled]);
  return assets;
}

/** A new task's checklist, kept in the form until the task is created: [{ title, asset_id? }]. */
export function DraftChecklist({ value, onChange, customerId = null }) {
  const assets = useAssetOptions(customerId);
  const items = value.map((item, index) => ({ ...item, key: index, asset_name: item.asset_id ? assets?.find(asset => asset.id === item.asset_id)?.name || null : null }));
  const strip = list => list.map(({ title, asset_id }) => (asset_id ? { title, asset_id } : { title }));
  return <ChecklistEditor items={items}
    onAdd={titles => onChange([...value, ...titles.map(title => ({ title }))])}
    onRename={(item, title) => onChange(value.map((entry, index) => (index === item.key ? { ...entry, title } : entry)))}
    onRemove={item => onChange(value.filter((_, index) => index !== item.key))}
    onReorder={order => onChange(strip(order.map(key => items[key])))}
    assets={assets} onAddAssets={picked => onChange([...value, ...picked.map(asset => ({ title: asset.name, asset_id: asset.id }))])} />;
}

export default function TaskSubtasks({ taskId, customerId = null, canEdit = true, onChange }) {
  const toast = useToast();
  const [items, setItems] = useState(null), [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const assets = useAssetOptions(customerId, canEdit);
  useEffect(() => {
    const controller = new AbortController();
    api.taskSubtasks(taskId, { signal: controller.signal }).then(result => { setItems(result.subtasks); setStatus(result.task?.status || null); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [taskId]);
  const apply = ({ subtasks: list, task }) => {
    setItems(list);
    if (task?.status && status && task.status !== status) {
      if (task.status === 'completed') toast.success('All subtasks are done: the task is completed');
      else if (status === 'completed') toast.success('The task is back in progress');
    }
    if (task?.status) setStatus(task.status);
    onChange?.({ total: list.length, done: list.filter(item => item.done).length, status: task?.status });
  };
  async function run(action) {
    setBusy(true); setError('');
    try { apply(await action()); return true; } catch (failure) { setError(failure.message); return false; } finally { setBusy(false); }
  }
  if (!items) return error ? <div className="error-msg" role="alert">{error}</div> : <p className="text-muted text-sm" role="status">Loading subtasks…</p>;
  const done = items.filter(item => item.done).length;
  return <section className="st" aria-label="Subtasks">
    <header className="st-head">
      <h3><ListChecks size={15} aria-hidden="true" /> Subtasks</h3>
      {items.length > 0 && <span className="text-sm text-muted">{done} of {items.length} done{done < items.length ? ' · the task is completed when all are done' : status === 'completed' ? ' · task completed' : ''}</span>}
    </header>
    {items.length > 0 && <div className="st-progress" aria-hidden="true"><i style={{ width: `${Math.round(done / items.length * 100)}%` }} /></div>}
    {error && <div className="error-msg" role="alert">{error}</div>}
    {!items.length && !canEdit && <p className="text-muted text-sm">No subtasks.</p>}
    <ChecklistEditor items={items.map(item => ({ ...item, key: item.id }))} canEdit={canEdit} busy={busy}
      onToggle={item => run(() => api.updateTaskSubtask(taskId, item.id, { done: !item.done }))}
      onAdd={titles => run(() => api.addTaskSubtasks(taskId, { items: titles.map(title => ({ title })) }))}
      onRename={(item, title) => run(() => api.updateTaskSubtask(taskId, item.id, { title }))}
      onRemove={item => run(() => api.deleteTaskSubtask(taskId, item.id))}
      onReorder={order => run(() => api.reorderTaskSubtasks(taskId, order))}
      assets={assets}
      onAddAssets={picked => run(() => api.addTaskSubtasks(taskId, { items: picked.map(asset => ({ title: asset.name, asset_id: asset.id })) }))} />
  </section>;
}

const UPDATE_STATUSES = [['', 'Keep the status'], ['in_progress', 'In progress'], ['waiting_customer', 'Waiting on customer'], ['waiting_vendor', 'Waiting on vendor'], ['completed', 'Completed']];

/**
 * Status updates of a task (its comments): who said what, and when. Whoever works
 * on the task posts one, and may change the status with it; when waiting on the
 * customer or a vendor, the update is the reason.
 */
export function TaskUpdates({ task, canPost = true, onChange }) {
  const toast = useToast();
  const [list, setList] = useState(null), [message, setMessage] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = () => api.taskComments(task.id).then(setList).catch(failure => setError(failure.message));
  useEffect(() => { load(); }, [task.id]);
  async function post(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setBusy(true); setError('');
    try {
      if (status && status !== task.status) await api.updateTask(task.id, { status, ...(['waiting_customer', 'waiting_vendor'].includes(status) ? { pending_from_customer: text } : {}) });
      await api.addTaskComment(task.id, text);
      setMessage(''); setStatus(''); await load();
      toast.success(status && status !== task.status ? 'Update posted and status changed' : 'Update posted');
      onChange?.();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="st-updates" aria-label="Updates">
    <header className="st-head"><h3><MessageSquare size={15} aria-hidden="true" /> Updates</h3>{list?.length > 0 && <span className="text-sm text-muted">{list.length}</span>}</header>
    {error && <div className="error-msg" role="alert">{error}</div>}
    {!list ? <p className="text-muted text-sm" role="status">Loading updates…</p> : !list.length ? <p className="text-muted text-sm">No updates yet.{canPost ? ' Say where the work stands.' : ''}</p>
      : <ol className="st-update-list">{list.map(item => <li key={item.id}><div className="st-update-meta"><strong>{item.user_name}</strong><span>{fmtDateTime(item.created_at)}</span></div><p>{item.message}</p></li>)}</ol>}
    {canPost && <div className="st-update-form">
      <textarea aria-label="Add an update" rows={2} maxLength={10000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Add an update, e.g. Firmware uploaded, reboot planned for tonight" />
      <div className="st-update-actions">
        <select aria-label="Status with this update" value={status} onChange={event => setStatus(event.target.value)}>
          {UPDATE_STATUSES.filter(([value]) => value !== task.status).map(([value, label]) => <option key={value || 'keep'} value={value}>{label}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !message.trim()} onClick={post}>{busy ? 'Posting…' : 'Post update'}</button>
      </div>
    </div>}
  </section>;
}

/** A task in a dialog, from a list row or a board card: its subtasks and its updates. */
export function SubtasksDialog({ task, customerId, canEdit = true, onClose, onChange }) {
  return <Modal title={task.title} onClose={onClose} wide>
    <div className="st-dialog">
      <TaskSubtasks taskId={task.id} customerId={customerId ?? task.customer_id ?? null} canEdit={canEdit} onChange={onChange} />
      <TaskUpdates task={task} canPost={canEdit} onChange={onChange} />
    </div>
    <div className="modal-footer"><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
  </Modal>;
}
export { SubtasksDialog as TaskDialog };

/** The latest update under a task's title. */
export function LastUpdate({ update }) {
  if (!update) return null;
  return <span className="st-last-update" title={`${update.user_name}, ${fmtDateTime(update.created_at)}: ${update.message}`}><MessageSquare size={12} aria-hidden="true" /> <strong>{update.user_name}:</strong> {update.message.length > 90 ? `${update.message.slice(0, 90)}…` : update.message}</span>;
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
