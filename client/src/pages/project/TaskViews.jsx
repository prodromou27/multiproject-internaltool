import { useEffect, useState } from 'react';
import { MessageSquare, Trash2, Lock, X, Link as LinkIcon, Unlink, Clock, Copy, SlidersHorizontal, GripVertical } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../App';
import { StatusBadge, PriorityBadge, fmtDate, fmtRelative, isOverdue, Modal, MentionInput, renderMentions } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { WaitingDialog } from './Dialogs';

/* ── Task Detail Modal (with comments) ───────────────────── */
export function TaskDetailModal({ task, isManager, isPlanner, allUsers, projectTasks, onUpdate, onClose }) {
  const { user }  = useAuth();
  const toast     = useToast();
  const canManageTask = isManager || isPlanner;
  const [comments,     setComments]     = useState([]);
  const [commentText,  setCommentText]  = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [deps,         setDeps]         = useState([]);
  const [addingDep,    setAddingDep]    = useState(false);
  const [depPickId,    setDepPickId]    = useState('');
  const [waitingDialog, setWaitingDialog] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState('waiting_customer');
  const statuses = isManager
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled']
    : isPlanner
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'cancelled']
    : ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];

  const [timeLogs,     setTimeLogs]     = useState([]);
  const [timeForm,     setTimeForm]     = useState({ hours: '', description: '' });
  const [loggingTime,  setLoggingTime]  = useState(false);

  const [customFields,     setCustomFields]     = useState([]);
  const [customValues,     setCustomValues]     = useState({});
  const [customLoaded,     setCustomLoaded]     = useState(false);
  const [editingCustom,    setEditingCustom]    = useState(false);
  const [customDraft,      setCustomDraft]      = useState({});
  const [savingCustom,     setSavingCustom]     = useState(false);

  const loadCustom = () => {
    if (!task.project_id) return;
    setCustomLoaded(false);
    Promise.all([
      api.customFields(task.project_id),
      api.taskCustomValues(task.project_id, task.id),
    ]).then(([fields, vals]) => { setCustomFields(fields); setCustomValues(vals); setCustomLoaded(true); }).catch(() => {});
  };

  const loadComments = () => api.taskComments(task.id).then(setComments).catch(() => {});
  const loadDeps     = () => api.taskDependencies(task.id).then(setDeps).catch(() => {});
  const loadTimeLogs = () => api.timeLogs({ task_id: task.id }).then(setTimeLogs).catch(() => {});
  useEffect(() => { loadComments(); loadDeps(); loadTimeLogs(); loadCustom(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCustomFields() {
    if (!task.project_id) return;
    setSavingCustom(true);
    try {
      await api.saveTaskCustomValues(task.project_id, task.id, customDraft);
      setCustomValues({ ...customValues, ...customDraft });
      setEditingCustom(false);
    } catch (err) { toast.error(err.message); }
    finally { setSavingCustom(false); }
  }

  const totalHours = timeLogs.reduce((s, l) => s + l.hours, 0);

  async function submitTimeLog(e) {
    e.preventDefault();
    if (!timeForm.hours || Number(timeForm.hours) <= 0) return;
    setLoggingTime(true);
    try {
      await api.logTime({ task_id: task.id, hours: Number(timeForm.hours), description: timeForm.description });
      setTimeForm({ hours: '', description: '' });
      loadTimeLogs();
    } catch (err) { toast.error(err.message); }
    finally { setLoggingTime(false); }
  }

  async function deleteTimeLog(id) {
    await api.deleteTimeLog(id).catch(e => toast.error(e.message));
    loadTimeLogs();
  }

  async function addDep() {
    if (!depPickId) return;
    await api.addTaskDependency(task.id, Number(depPickId)).catch(e => toast.error(e.message));
    setDepPickId(''); setAddingDep(false); loadDeps();
  }

  async function removeDep(depId) {
    await api.removeTaskDependency(task.id, depId);
    loadDeps();
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmitting(true);
    try {
      await api.addTaskComment(task.id, commentText.trim());
      setCommentText('');
      loadComments();
    } finally { setSubmitting(false); }
  }

  async function deleteComment(cid) {
    await api.deleteTaskComment(task.id, cid);
    loadComments();
  }

  return (
    <Modal title="Task Details" onClose={onClose}>
      <div className="mb-12">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{task.title}</span>
          {!!task.is_adhoc && <span className="badge badge-adhoc">adhoc</span>}
        </div>
        {task.description && <p style={{ color: 'var(--gray-600)', fontSize: 13, marginBottom: 8 }}>{task.description}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13, marginBottom: 8 }}>
          <div><span style={{ color: 'var(--gray-400)' }}>Status:</span> <StatusBadge entityType="task" s={task.status} /></div>
          <div><span style={{ color: 'var(--gray-400)' }}>Priority:</span> <PriorityBadge p={task.priority} /></div>
          <div><span style={{ color: 'var(--gray-400)' }}>Assigned:</span> {task.assigned_to_name || '—'}</div>
          <div><span style={{ color: 'var(--gray-400)' }}>Deadline:</span> <span className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) ? 'overdue' : ''}>{fmtDate(task.deadline) || '—'}</span></div>
        </div>
        {task.status === 'waiting_customer' && task.pending_from_customer && (
          <div style={{
            background: 'var(--warning-light)', border: '1px solid #fed7aa', borderRadius: 8,
            padding: '8px 12px', marginBottom: 10, fontSize: 13,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <span className="flex-shrink-0">⏳</span>
            <div>
              <span style={{ fontWeight: 700, color: '#9a3412' }}>Pending from customer: </span>
              <span style={{ color: '#7c2d12' }}>{task.pending_from_customer}</span>
            </div>
          </div>
        )}
        <div className="flex-center gap-8">
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Quick status:</span>
          <select
            value={task.status}
            onChange={async e => {
              const s = e.target.value;
              if (s === 'waiting_customer' || s === 'waiting_vendor') { setWaitingStatus(s); setWaitingDialog(true); return; }
              try { await onUpdate(task.id, { status: s }); onClose(); } catch (_) { /* onUpdate shows alert */ }
            }}
            style={{ width: 'auto', padding: '3px 8px', fontSize: 12,
              borderColor: task.status === 'waiting_customer' ? '#f97316' : undefined }}
          >
            {statuses.map(s => (
              <option key={s} value={s}>
                {{ open:'Open', in_progress:'In Progress', completed:'Completed',
                   cancelled:'Cancelled', closed:'Closed',
                   waiting_customer:'Waiting for Customer', waiting_vendor:'Waiting for Vendor',
                   pending_approval:'Pending Approval' }[s] || s}
              </option>
            ))}
          </select>
        </div>
        {waitingDialog && (
          <WaitingDialog
            initial={task.pending_from_customer || ''}
            onConfirm={async reason => {
              try { await onUpdate(task.id, { status: waitingStatus, pending_from_customer: reason }); }
              catch (_) { /* onUpdate shows alert */ }
              setWaitingDialog(false); onClose();
            }}
            onCancel={() => setWaitingDialog(false)}
          />
        )}
      </div>

      {/* Time Tracking */}
      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div className="section-title" style={{ margin: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Clock size={13} /> Time Logged
          </div>
          {totalHours > 0 && (
            <span style={{ background: 'var(--primary-light)', color: '#0891b2', fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '2px 8px' }}>
              {Math.round(totalHours * 10) / 10}h total
            </span>
          )}
        </div>

        {timeLogs.length > 0 && (
          <ul style={{ listStyle: 'none', marginBottom: 10, maxHeight: 130, overflowY: 'auto' }}>
            {timeLogs.map(l => (
              <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--gray-50)', fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: '#0891b2', flexShrink: 0 }}>{l.hours}h</span>
                <span style={{ flex: 1, color: 'var(--gray-600)' }}>{l.description || <em style={{ color: 'var(--gray-400)' }}>no description</em>}</span>
                <span style={{ fontSize: 10, color: 'var(--gray-400)', flexShrink: 0 }}>{l.user_name}</span>
                {(isManager || l.user_id === user.id) && (
                  <button onClick={() => deleteTimeLog(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', display: 'flex', alignItems: 'center', padding: '1px 3px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}><Trash2 size={11} /></button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submitTimeLog} className="flex-center gap-6 flex-wrap">
          <input
            type="number" min="0.25" step="0.25"
            value={timeForm.hours}
            onChange={e => setTimeForm(f => ({ ...f, hours: e.target.value }))}
            placeholder="Hours (e.g. 1.5)"
            style={{ width: 130, fontSize: 12 }}
          />
          <input
            value={timeForm.description}
            onChange={e => setTimeForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What did you work on?"
            style={{ flex: 1, minWidth: 150, fontSize: 12 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={loggingTime || !timeForm.hours}>
            + Log
          </button>
        </form>
      </div>

      {/* Dependencies */}
      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <LinkIcon size={13} /> Blocked by ({deps.length})
          </div>
          {canManageTask && !addingDep && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setAddingDep(true)}>+ Add</button>
          )}
        </div>

        {deps.length === 0 && !addingDep && (
          <p className="text-muted text-sm" style={{ marginBottom: 4 }}>No dependencies — this task is not blocked by anything</p>
        )}

        {deps.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--gray-50)' }}>
            {!d.restricted && <StatusBadge entityType="task" s={d.status} />}
            <span style={{ flex: 1, fontSize: 12 }}>{d.title}</span>
            {(d.restricted ? d.is_blocking : !['completed','closed','cancelled'].includes(d.status)) && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>BLOCKING</span>}
            {canManageTask && (
              <button onClick={() => removeDep(d.id)} title="Remove dependency"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', display: 'flex', alignItems: 'center', padding: '1px 3px' }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}>
                <Unlink size={12} />
              </button>
            )}
          </div>
        ))}

        {addingDep && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <select value={depPickId} onChange={e => setDepPickId(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
              <option value="">Pick a task…</option>
              {(projectTasks || [])
                .filter(t => t.id !== task.id && !deps.some(d => d.id === t.id))
                .map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={addDep} disabled={!depPickId}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAddingDep(false); setDepPickId(''); }}>Cancel</button>
          </div>
        )}
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <SlidersHorizontal size={13} /> Custom Fields
            </div>
            {!editingCustom && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={!customLoaded} onClick={() => {
                const draft = {};
                customFields.forEach(f => { draft[f.id] = customValues[f.id] ?? ''; });
                setCustomDraft(draft);
                setEditingCustom(true);
              }}>{customLoaded ? 'Edit' : '…'}</button>
            )}
          </div>

          {editingCustom ? (
            <div>
              {customFields.map(f => (
                <div key={f.id} className="form-group mb-8">
                  <label className="text-sm">{f.name}{f.required && <span style={{ color: '#ef4444' }}> *</span>}</label>
                  {f.field_type === 'select' ? (
                    <select value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} className="text-sm">
                      <option value="">— Select —</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.field_type === 'date' ? (
                    <input type="date" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} className="text-sm" />
                  ) : f.field_type === 'number' ? (
                    <input type="number" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} className="text-sm" />
                  ) : (
                    <input type="text" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} className="text-sm" />
                  )}
                </div>
              ))}
              <div className="flex gap-6">
                <button className="btn btn-primary btn-sm" onClick={saveCustomFields} disabled={savingCustom}>{savingCustom ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingCustom(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {customFields.map(f => (
                <div key={f.id} style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{f.name}: </span>
                  <span style={{ fontWeight: customValues[f.id] ? 600 : 400, color: customValues[f.id] ? 'var(--gray-800)' : 'var(--gray-400)' }}>
                    {customValues[f.id] || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 12 }}>
        <div className="section-title" style={{ marginBottom: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
          <MessageSquare size={13} /> Comments ({comments.length})
        </div>
        {comments.length === 0
          ? <p className="text-muted text-sm mb-8">No comments yet. Be first to add one.</p>
          : <ul style={{ listStyle: 'none', marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
              {comments.map(c => (
                <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {c.user_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{c.user_name}</span>
                      <span style={{ fontSize: 10, color: 'var(--gray-400)' }} title={fmtDate(c.created_at)}>{fmtRelative(c.created_at)}</span>
                      {(isManager || c.user_id === user.id) && (
                        <button onClick={() => deleteComment(c.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--gray-300)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px' }} title="Delete"><X size={13} /></button>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--gray-700)', wordBreak: 'break-word' }}>{renderMentions(c.message)}</div>
                  </div>
                </li>
              ))}
            </ul>
        }
        <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <MentionInput
            value={commentText}
            onChange={setCommentText}
            placeholder="Add a comment… (type @name to notify)"
            disabled={submitting}
            users={allUsers}
            style={{ flex: 1, fontSize: 13 }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !commentText.trim()}>Post</button>
        </form>
      </div>
    </Modal>
  );
}

export const TASK_STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed',
  cancelled: 'Cancelled', closed: 'Closed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  pending_approval: 'Pending Approval',
};

export function TaskRow({ task, isManager, isPlanner, allUsers, onUpdate, onRowClick, onDuplicate }) {
  const [waitingDialog, setWaitingDialog] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState('waiting_customer');
  const statuses = isManager
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled']
    : isPlanner
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'cancelled']
    : ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];

  return (
    <>
      <tr className="cursor-pointer" onClick={() => onRowClick(task)}>
        <td className="font-medium">
          <span className="inline-flex items-center gap-5">
            {!!task.is_blocked && (
              <span title="Blocked by unfinished dependencies" style={{ color: '#6366f1', display: 'inline-flex', alignItems: 'center' }}>
                <Lock size={12} />
              </span>
            )}
            {task.title}
            {task.is_adhoc ? <span className="badge badge-adhoc" style={{ marginLeft: 6 }}>adhoc</span> : null}
            {task.dep_count > 0 && !task.is_blocked && <LinkIcon size={11} color="var(--gray-400)" title={`${task.dep_count} dependenc${task.dep_count !== 1 ? 'ies' : 'y'}`} />}
          </span>
          {(task.status === 'waiting_customer' || task.status === 'waiting_vendor') && task.pending_from_customer && (
            <div style={{ fontSize: 11, color: task.status === 'waiting_vendor' ? '#6b21a8' : '#9a3412', marginTop: 2, lineHeight: 1.3 }}>
              ⏳ {task.pending_from_customer}
            </div>
          )}
        </td>
        <td><StatusBadge entityType="task" s={task.status} /></td>
        <td><PriorityBadge p={task.priority} /></td>
        <td>{task.assigned_to_name || '—'}</td>
        <td className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) ? 'overdue' : ''}>{fmtDate(task.deadline)}</td>
        <td style={{ fontSize: 11, color: '#0891b2', fontWeight: task.logged_hours > 0 ? 700 : 400 }}>
          {task.logged_hours > 0 ? `${task.logged_hours}h` : '—'}
        </td>
        <td onClick={e => e.stopPropagation()} className="flex-center gap-6">
          <select
            value={task.status}
            onChange={e => {
              const s = e.target.value;
              if (s === 'waiting_customer' || s === 'waiting_vendor') { setWaitingStatus(s); setWaitingDialog(true); return; }
              onUpdate(task.id, { status: s });
            }}
            style={{ width: 'auto', padding: '3px 6px', fontSize: 12,
              borderColor: task.status === 'waiting_customer' ? '#f97316' : undefined }}
          >
            {statuses.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s] || s}</option>)}
          </select>
          {onDuplicate && (
            <button
              onClick={e => { e.stopPropagation(); onDuplicate(task.id); }}
              title="Duplicate task"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4,
                color: 'var(--gray-400)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-400)'}
            >
              <Copy size={13} />
            </button>
          )}
        </td>
      </tr>
      {waitingDialog && (
        <WaitingDialog
          initial={task.pending_from_customer || ''}
          onConfirm={reason => {
            onUpdate(task.id, { status: waitingStatus, pending_from_customer: reason });
            setWaitingDialog(false);
          }}
          onCancel={() => setWaitingDialog(false)}
        />
      )}
    </>
  );
}

/* ── Kanban View ──────────────────────────────────────────── */
export const KANBAN_COLS = [
  { key: 'open',             label: 'Open',             color: '#3b82f6', bg: '#eff6ff' },
  { key: 'in_progress',      label: 'In Progress',      color: '#f59e0b', bg: '#fffbeb' },
  { key: 'waiting_customer', label: 'Waiting Customer', color: '#f97316', bg: '#fff7ed' },
  { key: 'waiting_vendor',   label: 'Waiting Vendor',   color: '#a855f7', bg: '#faf5ff' },
  { key: 'completed',        label: 'Completed',        color: '#10b981', bg: '#f0fdf4' },
];

export function KanbanView({ tasks, isManager, isPlanner, onUpdate, onRowClick, onDuplicate }) {
  const [dragging, setDragging] = useState(null); // task id
  const [overCol,  setOverCol]  = useState(null); // column key

  function handleDragStart(taskId) { setDragging(taskId); }
  function handleDragEnd()         { setDragging(null); setOverCol(null); }
  function handleDragOver(e, colKey) { e.preventDefault(); setOverCol(colKey); }
  function handleDrop(e, colKey) {
    e.preventDefault();
    if (dragging && colKey) {
      const task = tasks.find(t => t.id === dragging);
      if (task && task.status !== colKey) onUpdate(dragging, { status: colKey });
    }
    setDragging(null); setOverCol(null);
  }

  const byStatus = col => tasks.filter(t => t.status === col.key);

  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, minHeight: 360 }}>
      {KANBAN_COLS.map(col => {
        const colTasks = byStatus(col);
        const isOver   = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={e => handleDragOver(e, col.key)}
            onDrop={e => handleDrop(e, col.key)}
            style={{
              minWidth: 210, flex: '1 1 210px',
              background: isOver ? col.bg : 'var(--gray-50)',
              border: `2px solid ${isOver ? col.color : 'var(--gray-200)'}`,
              borderRadius: 10, padding: '10px 8px',
              transition: 'border-color .15s, background .15s',
            }}
          >
            {/* Column header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 12, color: col.color, flex: 1 }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, background: col.color + '22', color: col.color, borderRadius: 8, padding: '1px 7px' }}>
                {colTasks.length}
              </span>
            </div>

            {/* Task cards */}
            <div className="flex-col gap-6">
              {colTasks.map(task => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onRowClick(task)}
                  style={{
                    background: '#fff', borderRadius: 8, padding: '8px 10px',
                    border: dragging === task.id ? `2px dashed ${col.color}` : '1px solid var(--gray-200)',
                    cursor: 'grab', opacity: dragging === task.id ? 0.5 : 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
                    transition: 'box-shadow .1s',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => { if (dragging !== task.id) e.currentTarget.style.boxShadow = '0 3px 10px rgba(0,0,0,.1)'; }}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                    <GripVertical size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--gray-300)' }} />
                    <div className="flex-1 min-w-0">
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-800)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                        {!!task.is_blocked && <Lock size={10} color="#6366f1" style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                        {task.title}
                        {!!task.is_adhoc && <span className="badge badge-adhoc" style={{ marginLeft: 5 }}>adhoc</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                        <PriorityBadge p={task.priority} />
                        {task.deadline && (
                          <span style={{ fontSize: 10, color: isOverdue(task.deadline) ? '#ef4444' : 'var(--gray-400)', fontWeight: isOverdue(task.deadline) ? 700 : 400 }}>
                            {fmtDate(task.deadline)}
                          </span>
                        )}
                      </div>
                      {task.assigned_to_name && (
                        <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 4 }}>{task.assigned_to_name}</div>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onDuplicate(task.id); }}
                      title="Duplicate task"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', color: 'var(--gray-300)', flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {colTasks.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--gray-300)', fontSize: 12 }}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
