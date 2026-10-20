import { useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from './Shared';
import TaskSubtasks, { TaskUpdates } from './TaskSubtasks';
import TaskFiles from './TaskFiles';
import { OtherEngineers } from './TaskPeople';

export const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed',
  cancelled: 'Cancelled', closed: 'Closed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  pending_approval: 'Pending Approval',
};

export const MANAGER_STATUSES  = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled'];
export const ENGINEER_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];

/* Editing a task: title, description, priority, deadline, status, ticket reference,
   (managers) who it is assigned to, the other engineers on it, its subtasks, updates
   and files. Used on Tasks and on Customer 360 → Tasks. Posting an update or attaching
   a file saves the form's changes too, so closing afterwards loses nothing. */
export default function EditTaskModal({ task, allUsers, isManager, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    title:       task.title || '',
    description: task.description || '',
    priority:    task.priority || 'medium',
    deadline:    task.deadline ? task.deadline.slice(0, 10) : '',
    assigned_to: task.assigned_to || '',
    status:      task.status || 'open',
    pending_from_customer: task.pending_from_customer || '',
    ticket_reference: task.ticket_reference || '',
    engineer_ids: (task.engineers || []).map(person => Number(person.id)),
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const isWaiting = form.status === 'waiting_customer' || form.status === 'waiting_vendor';
  const engineers = allUsers.filter(u => u.role === 'engineer');

  const payloadOf = f => ({
    title:       f.title,
    description: f.description,
    priority:    f.priority,
    deadline:    f.deadline || null,
    status:      f.status,
    ticket_reference: f.ticket_reference.trim() || null,
    engineer_ids: f.engineer_ids,
    ...(['waiting_customer', 'waiting_vendor'].includes(f.status) ? { pending_from_customer: f.pending_from_customer } : {}),
    ...(isManager ? { assigned_to: f.assigned_to ? Number(f.assigned_to) : null } : {}),
  });
  // What is saved: the form as it opened, then as last saved; and whether anything was saved here.
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = JSON.stringify(payloadOf(form));
  const changedRef = useRef(false);

  /** Saves the form's changes, if any (before an update or a file is added). */
  async function saveChanges() {
    const payload = payloadOf(form), json = JSON.stringify(payload);
    if (json !== savedRef.current) {
      if (!form.title.trim()) throw new Error('Give the task a title first');
      await api.updateTask(task.id, payload);
      savedRef.current = json;
    }
    changedRef.current = true;
  }
  // An update that changed the status: the form shows it, and counts it as saved.
  function posted(change) {
    changedRef.current = true;
    if (!change.status) return;
    const next = { ...form, status: change.status, ...(change.pending_from_customer !== undefined ? { pending_from_customer: change.pending_from_customer } : {}) };
    setForm(next);
    savedRef.current = JSON.stringify(payloadOf(next));
  }
  // Closing after something was saved here refreshes the list behind.
  const close = () => (changedRef.current ? onSave() : onClose());

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      await api.updateTask(task.id, payloadOf(form));
      onSave();
    } catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Edit Task" onClose={close}>
      <form onSubmit={submit}>
        {err && <div className="error-msg">{err}</div>}
        <div className="form-group">
          <label>Title *</label>
          <input value={form.title} onChange={set('title')} required />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea value={form.description} onChange={set('description')} rows={3} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Priority</label>
            <select value={form.priority} onChange={set('priority')}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="form-group">
            <label>Deadline</label>
            <input type="date" value={form.deadline} onChange={set('deadline')} />
          </div>
        </div>
        {isManager && (
          <div className="form-group">
            <label>Assigned to</label>
            <select value={form.assigned_to} onChange={set('assigned_to')}>
              <option value="">Unassigned</option>
              {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <OtherEngineers engineers={engineers} leadId={isManager ? form.assigned_to : task.assigned_to} value={form.engineer_ids}
          onChange={ids => setForm(f => ({ ...f, engineer_ids: ids }))} />
        <div className="form-group">
          <label>Status</label>
          <select value={form.status} onChange={set('status')}>
            {(isManager ? MANAGER_STATUSES : ENGINEER_STATUSES).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        {isWaiting && (
          <div className="form-group">
            <label>
              {form.status === 'waiting_vendor' ? 'Waiting on Vendor' : 'Waiting on Customer'}{' '}
              <span className="u-497726e">*</span>
            </label>
            <textarea
              value={form.pending_from_customer}
              onChange={set('pending_from_customer')}
              placeholder="Describe what is needed before work can continue…"
              rows={2}
              required
            />
          </div>
        )}
<div className="form-group"><label htmlFor="edit-task-ticket">Ticket (optional)</label><input id="edit-task-ticket" value={form.ticket_reference} onChange={set('ticket_reference')} maxLength={50} placeholder="e.g. RT#12345" /></div>
        <div className="task-edit-subtasks"><TaskSubtasks taskId={task.id} customerId={task.customer_id} /></div>
        <div className="task-edit-subtasks"><TaskUpdates task={{ ...task, status: form.status }} beforePost={saveChanges} onPosted={posted} /></div>
        <div className="task-edit-subtasks"><TaskFiles task={task} beforeAdd={saveChanges} onAdded={() => { changedRef.current = true; }} /></div>
        <div className="modal-footer u-cc45258">
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

