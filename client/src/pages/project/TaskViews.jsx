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
  useEffect(() => { loadComments(); loadDeps(); loadTimeLogs(); loadCustom(); }, [task.id]);  

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
        <div className="u-1380104">
          <span className="u-0c7a14e">{task.title}</span>
          {!!task.is_adhoc && <span className="badge badge-adhoc">adhoc</span>}
        </div>
        {task.description && <p className="u-901ac01">{task.description}</p>}
        <div className="u-b7ebf49">
          <div><span className="u-1e2ea2c">Status:</span> <StatusBadge entityType="task" s={task.status} /></div>
          <div><span className="u-1e2ea2c">Priority:</span> <PriorityBadge p={task.priority} /></div>
          <div><span className="u-1e2ea2c">Assigned:</span> {task.assigned_to_name || '—'}</div>
          <div><span className="u-1e2ea2c">Deadline:</span> <span className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) ? 'overdue' : ''}>{fmtDate(task.deadline) || '—'}</span></div>
        </div>
        {task.status === 'waiting_customer' && task.pending_from_customer && (
          <div className="u-6ea4f51">
            <span className="flex-shrink-0">⏳</span>
            <div>
              <span className="u-7a40868">Pending from customer: </span>
              <span className="u-2110b49">{task.pending_from_customer}</span>
            </div>
          </div>
        )}
        <div className="flex-center gap-8">
          <span className="u-d65cb71">Quick status:</span>
          <select
            value={task.status}
            onChange={async e => {
              const s = e.target.value;
              if (s === 'waiting_customer' || s === 'waiting_vendor') { setWaitingStatus(s); setWaitingDialog(true); return; }
              try { await onUpdate(task.id, { status: s }); onClose(); } catch (_) { /* onUpdate shows alert */ }
            }}
            className="u-257f103" style={{ borderColor: task.status === 'waiting_customer' ? '#f97316' : undefined }}
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
      <div className="u-1e1ab6a">
        <div className="u-f03a7bd">
          <div className="section-title u-64e67c9">
            <Clock size={13} /> Time Logged
          </div>
          {totalHours > 0 && (
            <span className="u-d1f32c4">
              {Math.round(totalHours * 10) / 10}h total
            </span>
          )}
        </div>

        {timeLogs.length > 0 && (
          <ul className="u-bd381ea">
            {timeLogs.map(l => (
              <li key={l.id} className="u-23589b3">
                <span className="u-311dc7a">{l.hours}h</span>
                <span className="u-e0f5d28">{l.description || <em className="u-1e2ea2c">no description</em>}</span>
                <span className="u-8e27ea3">{l.user_name}</span>
                {(isManager || l.user_id === user.id) && (
                  <button onClick={() => deleteTimeLog(l.id)} className="u-6f432e4"
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
            className="u-5a5bc97"
          />
          <input
            value={timeForm.description}
            onChange={e => setTimeForm(f => ({ ...f, description: e.target.value }))}
            placeholder="What did you work on?"
            className="u-210f1d1"
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={loggingTime || !timeForm.hours}>
            + Log
          </button>
        </form>
      </div>

      {/* Dependencies */}
      <div className="u-1e1ab6a">
        <div className="u-3daa038">
          <div className="section-title u-64e67c9">
            <LinkIcon size={13} /> Blocked by ({deps.length})
          </div>
          {canManageTask && !addingDep && (
            <button className="btn btn-ghost btn-sm u-11a5081" onClick={() => setAddingDep(true)}>+ Add</button>
          )}
        </div>

        {deps.length === 0 && !addingDep && (
          <p className="text-muted text-sm u-c81ce4b">No dependencies — this task is not blocked by anything</p>
        )}

        {deps.map(d => (
          <div key={d.id} className="u-d474331">
            {!d.restricted && <StatusBadge entityType="task" s={d.status} />}
            <span className="u-5a95af4">{d.title}</span>
            {(d.restricted ? d.is_blocking : !['completed','closed','cancelled'].includes(d.status)) && <span className="u-bd8c9f3">BLOCKING</span>}
            {canManageTask && (
              <button onClick={() => removeDep(d.id)} title="Remove dependency"
                className="u-6f432e4"
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}>
                <Unlink size={12} />
              </button>
            )}
          </div>
        ))}

        {addingDep && (
          <div className="u-1a6be0e">
            <select value={depPickId} onChange={e => setDepPickId(e.target.value)} className="u-5a95af4">
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
        <div className="u-1e1ab6a">
          <div className="u-3daa038">
            <div className="section-title u-64e67c9">
              <SlidersHorizontal size={13} /> Custom Fields
            </div>
            {!editingCustom && (
              <button className="btn btn-ghost btn-sm u-11a5081" disabled={!customLoaded} onClick={() => {
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
                  <label className="text-sm">{f.name}{f.required && <span className="u-b0eb59c"> *</span>}</label>
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
            <div className="u-d276a53">
              {customFields.map(f => (
                <div key={f.id} className="u-5e0faad">
                  <span className="u-33ea7bc">{f.name}: </span>
                  <span style={{ fontWeight: customValues[f.id] ? 600 : 400, color: customValues[f.id] ? 'var(--gray-800)' : 'var(--gray-400)' }}>
                    {customValues[f.id] || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="u-27cd81a">
        <div className="section-title u-64a3821">
          <MessageSquare size={13} /> Comments ({comments.length})
        </div>
        {comments.length === 0
          ? <p className="text-muted text-sm mb-8">No comments yet. Be first to add one.</p>
          : <ul className="u-13e71f9">
              {comments.map(c => (
                <li key={c.id} className="u-96f1002">
                  <div className="u-f98e311">
                    {c.user_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="u-2551796">
                      <span className="u-55babdd">{c.user_name}</span>
                      <span className="u-19dc6a2" title={fmtDate(c.created_at)}>{fmtRelative(c.created_at)}</span>
                      {(isManager || c.user_id === user.id) && (
                        <button onClick={() => deleteComment(c.id)} className="u-6efede9" title="Delete"><X size={13} /></button>
                      )}
                    </div>
                    <div className="u-79ec38e">{renderMentions(c.message)}</div>
                  </div>
                </li>
              ))}
            </ul>
        }
        <form onSubmit={submitComment} className="u-b559c2d">
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
              <span title="Blocked by unfinished dependencies" className="u-a115383">
                <Lock size={12} />
              </span>
            )}
            {task.title}
            {task.is_adhoc ? <span className="badge badge-adhoc u-391ef12">adhoc</span> : null}
            {task.dep_count > 0 && !task.is_blocked && <LinkIcon size={11} color="var(--gray-400)" title={`${task.dep_count} dependenc${task.dep_count !== 1 ? 'ies' : 'y'}`} />}
          </span>
          {(task.status === 'waiting_customer' || task.status === 'waiting_vendor') && task.pending_from_customer && (
            <div className="u-9cfc075" style={{ color: task.status === 'waiting_vendor' ? '#6b21a8' : '#9a3412' }}>
              ⏳ {task.pending_from_customer}
            </div>
          )}
        </td>
        <td><StatusBadge entityType="task" s={task.status} /></td>
        <td><PriorityBadge p={task.priority} /></td>
        <td>{task.assigned_to_name || '—'}</td>
        <td className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) ? 'overdue' : ''}>{fmtDate(task.deadline)}</td>
        <td className="u-7690bd8" style={{ fontWeight: task.logged_hours > 0 ? 700 : 400 }}>
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
            className="u-33842f4" style={{ borderColor: task.status === 'waiting_customer' ? '#f97316' : undefined }}
          >
            {statuses.map(s => <option key={s} value={s}>{TASK_STATUS_LABELS[s] || s}</option>)}
          </select>
          {onDuplicate && (
            <button
              onClick={e => { e.stopPropagation(); onDuplicate(task.id); }}
              title="Duplicate task"
              className="u-9a650b0"
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
    <div className="u-9c9789c">
      {KANBAN_COLS.map(col => {
        const colTasks = byStatus(col);
        const isOver   = overCol === col.key;
        return (
          <div
            key={col.key}
            onDragOver={e => handleDragOver(e, col.key)}
            onDrop={e => handleDrop(e, col.key)}
            className="u-6e15fb3" style={{ background: isOver ? col.bg : 'var(--gray-50)', border: `2px solid ${isOver ? col.color : 'var(--gray-200)'}` }}
          >
            {/* Column header */}
            <div className="u-4caa6d3">
              <span className="u-2dcdba7" style={{ background: col.color }} />
              <span className="u-2a85b68" style={{ color: col.color }}>{col.label}</span>
              <span className="u-3380886" style={{ background: col.color + '22', color: col.color }}>
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
                  className="u-06d578c" style={{ border: dragging === task.id ? `2px dashed ${col.color}` : '1px solid var(--gray-200)', opacity: dragging === task.id ? 0.5 : 1 }}
                  onMouseEnter={e => { if (dragging !== task.id) e.currentTarget.style.boxShadow = '0 3px 10px rgba(0,0,0,.1)'; }}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'}
                >
                  <div className="u-42ca785">
                    <GripVertical size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--gray-300)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="u-496d82a">
                        {!!task.is_blocked && <Lock size={10} color="#6366f1" style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                        {task.title}
                        {!!task.is_adhoc && <span className="badge badge-adhoc u-9813a0d">adhoc</span>}
                      </div>
                      <div className="u-2bcd2ea">
                        <PriorityBadge p={task.priority} />
                        {task.deadline && (
                          <span className="u-0d5be05" style={{ color: isOverdue(task.deadline) ? '#ef4444' : 'var(--gray-400)', fontWeight: isOverdue(task.deadline) ? 700 : 400 }}>
                            {fmtDate(task.deadline)}
                          </span>
                        )}
                      </div>
                      {task.assigned_to_name && (
                        <div className="u-1dd7834">{task.assigned_to_name}</div>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onDuplicate(task.id); }}
                      title="Duplicate task"
                      className="u-823cd7b"
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {colTasks.length === 0 && (
                <div className="u-707fb99">
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
