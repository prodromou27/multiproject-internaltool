import { useState } from 'react';
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
   and files. Used on Tasks and on Customer 360 → Tasks. */
export default function EditTaskModal({ task, allUsers, isManager, onSave, onClose }) {
  const [form, setForm] = useState({
    title:       task.title || '',
    description: task.description || '',
    priority:    task.priority || 'medium',
    deadline:    task.deadline ? task.deadline.slice(0, 10) : '',
    assigned_to: task.assigned_to || '',
    status:      task.status || 'open',
    pending_from_customer: task.pending_from_customer || '',
    ticket_reference: task.ticket_reference || '',
    engineer_ids: (task.engineers || []).map(person => Number(person.id)),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const isWaiting = form.status === 'waiting_customer' || form.status === 'waiting_vendor';
  const engineers = allUsers.filter(u => u.role === 'engineer');

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const payload = {
        title:       form.title,
        description: form.description,
        priority:    form.priority,
        deadline:    form.deadline || null,
        status:      form.status,
        ticket_reference: form.ticket_reference.trim() || null,
        engineer_ids: form.engineer_ids,
        ...(isWaiting ? { pending_from_customer: form.pending_from_customer } : {}),
        ...(isManager  ? { assigned_to: form.assigned_to ? Number(form.assigned_to) : null } : {}),
      };
      await api.updateTask(task.id, payload);
      onSave();
    } catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Edit Task" onClose={onClose}>
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
        <div className="task-edit-subtasks"><TaskUpdates task={task} /></div>
        <div className="task-edit-subtasks"><TaskFiles task={task} /></div>
        <div className="modal-footer u-cc45258">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

