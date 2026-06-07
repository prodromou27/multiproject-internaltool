import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Building2, ChevronLeft, MessageSquare, ClipboardList,
  Plus, RefreshCw, Trash2, FolderOpen, GitBranch,
  FileText, UserPlus, UserX, Lock, CheckCircle2,
  Paperclip, File, Image, Archive, X,
  AlertTriangle, BarChart2, Link as LinkIcon, Unlink, Clock, Upload,
  Copy, LayoutGrid, List as ListIcon, SlidersHorizontal, GripVertical, Printer,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, RagBadge, fmtDate, fmtRelative, isOverdue, Modal, ProgressBar, MentionInput, renderMentions } from '../components/Shared';
import { DIFFICULTY_LABELS, getRating, ScoreBadge, ScoreGauge, DimPicker, ScorecardBreakdown, WEIGHTS } from '../components/ScorecardUtils';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function AttachmentsSection({ projectId }) {
  const { user }  = useAuth();
  const toast     = useToast();
  const confirm   = useConfirm();
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const load = () => api.attachments(projectId).then(setAttachments);
  useEffect(() => { load(); }, [projectId]);

  async function handleFiles(files) {
    setUploading(true);
    for (const file of files) {
      await api.uploadAttachment(projectId, file);
    }
    await load();
    setUploading(false);
  }

  function onInputChange(e) {
    if (e.target.files.length) handleFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  }

  async function deleteAttachment(id) {
    const ok = await confirm('Remove this attachment?', { title: 'Remove Attachment', label: 'Remove' });
    if (!ok) return;
    try { await api.deleteAttachment(projectId, id); load(); } catch (e) { toast.error(e.message); }
  }

  function getIcon(mime) {
    if (!mime) return <File size={14} color="var(--gray-400)" />;
    if (mime.startsWith('image/')) return <Image size={14} color="var(--primary)" />;
    if (mime === 'application/pdf') return <FileText size={14} color="#ef4444" />;
    if (mime.includes('word') || mime.includes('document')) return <FileText size={14} color="#2563eb" />;
    if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return <FileText size={14} color="#16a34a" />;
    if (mime.includes('zip') || mime.includes('compressed')) return <Archive size={14} color="var(--gray-500)" />;
    return <File size={14} color="var(--gray-400)" />;
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--gray-200)'}`,
          borderRadius: 8, padding: '24px 16px', textAlign: 'center',
          background: dragOver ? '#eff6ff' : 'var(--gray-50)',
          marginBottom: 16, transition: 'all .15s'
        }}
      >
        <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}><Paperclip size={28} color="var(--gray-400)" /></div>
        <p className="text-sm text-muted" style={{ marginBottom: 8 }}>
          {uploading ? 'Uploading…' : 'Drag & drop files here, or'}
        </p>
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          Browse Files
          <input type="file" multiple style={{ display: 'none' }} onChange={onInputChange} disabled={uploading} />
        </label>
        <p className="text-sm text-muted mt-4">Max 20 MB per file</p>
      </div>

      {attachments.length === 0
        ? <p className="text-muted text-sm">No attachments yet</p>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Size</th><th>Uploaded By</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                {attachments.map(a => (
                  <tr key={a.id}>
                    <td>
                      <span style={{ marginRight: 6 }}>{getIcon(a.mime_type)}</span>
                      <a href={api.downloadAttachment(projectId, a.id)} target="_blank" rel="noreferrer">{a.original_name}</a>
                    </td>
                    <td className="text-muted text-sm">{fileSize(a.size)}</td>
                    <td className="text-sm">{a.uploaded_by_name}</td>
                    <td className="text-sm text-muted">{fmtDate(a.created_at)}</td>
                    <td>
                      {(user.role === 'manager' || a.uploaded_by === user.id) &&
                        <button className="btn btn-sm btn-danger" onClick={() => deleteAttachment(a.id)}>Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}

function KpiSection({ projectId }) {
  const [kpis, setKpis] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', target_value: '', current_value: '', unit: '' });
  const load = () => api.kpis(projectId).then(setKpis);
  useEffect(() => { load(); }, [projectId]);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    if (editing) await api.updateKpi(projectId, editing.id, form);
    else await api.createKpi(projectId, form);
    setShowAdd(false); setEditing(null); setForm({ name: '', target_value: '', current_value: '', unit: '' }); load();
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>KPIs</div>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(true)}>+ Add KPI</button>
      </div>
      {kpis.length === 0 ? <p className="text-muted text-sm">No KPIs defined</p> : kpis.map(k => {
        const pct = k.target_value > 0 ? Math.round((k.current_value / k.target_value) * 100) : 0;
        return (
          <div key={k.id} className="kpi-row">
            <div className="kpi-label">{k.name}</div>
            <div className="kpi-bar"><ProgressBar value={k.current_value} max={k.target_value} /></div>
            <div className="kpi-value">{k.current_value}{k.unit || ''} / {k.target_value}{k.unit || ''} ({pct}%)</div>
            <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(k); setForm({ name: k.name, target_value: k.target_value, current_value: k.current_value, unit: k.unit || '' }); setShowAdd(true); }}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={() => { api.deleteKpi(projectId, k.id).then(load); }}>Del</button>
          </div>
        );
      })}
      {showAdd && (
        <Modal title={editing ? 'Edit KPI' : 'Add KPI'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group"><label>KPI Name *</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="form-row">
              <div className="form-group"><label>Target</label><input type="number" step="any" value={form.target_value} onChange={set('target_value')} required /></div>
              <div className="form-group"><label>Current</label><input type="number" step="any" value={form.current_value} onChange={set('current_value')} /></div>
            </div>
            <div className="form-group"><label>Unit (optional, e.g. %, hrs)</label><input value={form.unit} onChange={set('unit')} /></div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ── Reject closure dialog ───────────────────────────────── */
function RejectDialog({ onConfirm, onCancel }) {
  const [note, setNote] = useState('');
  return (
    <Modal title="Send Back for Revision" onClose={onCancel}>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
        The project will be moved back to "Reopened" and the team will be notified.
      </p>
      <div className="form-group">
        <label>Rejection Note (optional)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Some tasks are still incomplete…"
          rows={3}
          autoFocus
        />
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-warning" onClick={() => onConfirm(note)}>
          ↩ Send Back for Revision
        </button>
      </div>
    </Modal>
  );
}

/* ── Shared "Waiting for Customer" dialog ────────────────── */
function WaitingDialog({ initial, onConfirm, onCancel }) {
  const [reason, setReason] = useState(initial || '');
  return (
    <Modal title="Waiting for Customer" onClose={onCancel}>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
        Describe what is needed from the customer before work can continue.
      </p>
      <div className="form-group">
        <label>Pending From Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Awaiting signed approval, credentials for system access…"
          rows={3}
          autoFocus
        />
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}>Set Status</button>
      </div>
    </Modal>
  );
}

/* ── Task Detail Modal (with comments) ───────────────────── */
function TaskDetailModal({ task, isManager, isPlanner, allUsers, projectTasks, onUpdate, onClose }) {
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
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{task.title}</span>
          {task.is_adhoc && <span className="badge badge-adhoc">adhoc</span>}
        </div>
        {task.description && <p style={{ color: 'var(--gray-600)', fontSize: 13, marginBottom: 8 }}>{task.description}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13, marginBottom: 8 }}>
          <div><span style={{ color: 'var(--gray-400)' }}>Status:</span> <StatusBadge s={task.status} /></div>
          <div><span style={{ color: 'var(--gray-400)' }}>Priority:</span> <PriorityBadge p={task.priority} /></div>
          <div><span style={{ color: 'var(--gray-400)' }}>Assigned:</span> {task.assigned_to_name || '—'}</div>
          <div><span style={{ color: 'var(--gray-400)' }}>Deadline:</span> <span className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) && isOverdue(task.deadline) ? 'overdue' : ''}>{fmtDate(task.deadline) || '—'}</span></div>
        </div>
        {task.status === 'waiting_customer' && task.pending_from_customer && (
          <div style={{
            background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8,
            padding: '8px 12px', marginBottom: 10, fontSize: 13,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <span style={{ flexShrink: 0 }}>⏳</span>
            <div>
              <span style={{ fontWeight: 700, color: '#9a3412' }}>Pending from customer: </span>
              <span style={{ color: '#7c2d12' }}>{task.pending_from_customer}</span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <span style={{ background: '#e0f2fe', color: '#0891b2', fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '2px 8px' }}>
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

        <form onSubmit={submitTimeLog} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
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
            <StatusBadge s={d.status} />
            <span style={{ flex: 1, fontSize: 12 }}>{d.title}</span>
            {!['completed','closed','cancelled'].includes(d.status) && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>BLOCKING</span>}
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
                <div key={f.id} className="form-group" style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12 }}>{f.name}{f.required && <span style={{ color: '#ef4444' }}> *</span>}</label>
                  {f.field_type === 'select' ? (
                    <select value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} style={{ fontSize: 12 }}>
                      <option value="">— Select —</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.field_type === 'date' ? (
                    <input type="date" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} style={{ fontSize: 12 }} />
                  ) : f.field_type === 'number' ? (
                    <input type="number" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} style={{ fontSize: 12 }} />
                  ) : (
                    <input type="text" value={customDraft[f.id] ?? ''} onChange={e => setCustomDraft(d => ({ ...d, [f.id]: e.target.value }))} style={{ fontSize: 12 }} />
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
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
          ? <p className="text-muted text-sm" style={{ marginBottom: 8 }}>No comments yet. Be first to add one.</p>
          : <ul style={{ listStyle: 'none', marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
              {comments.map(c => (
                <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {c.user_name?.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
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

const TASK_STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed',
  cancelled: 'Cancelled', closed: 'Closed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  pending_approval: 'Pending Approval',
};

function TaskRow({ task, isManager, isPlanner, allUsers, onUpdate, onRowClick, onDuplicate }) {
  const [waitingDialog, setWaitingDialog] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState('waiting_customer');
  const statuses = isManager
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled']
    : isPlanner
    ? ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'cancelled']
    : ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => onRowClick(task)}>
        <td style={{ fontWeight: 500 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {task.is_blocked && (
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
        <td><StatusBadge s={task.status} /></td>
        <td><PriorityBadge p={task.priority} /></td>
        <td>{task.assigned_to_name || '—'}</td>
        <td className={isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status) && isOverdue(task.deadline) ? 'overdue' : ''}>{fmtDate(task.deadline)}</td>
        <td style={{ fontSize: 11, color: '#0891b2', fontWeight: task.logged_hours > 0 ? 700 : 400 }}>
          {task.logged_hours > 0 ? `${task.logged_hours}h` : '—'}
        </td>
        <td onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

/* ── Gantt Tab ────────────────────────────────────────────── */
function GanttTab({ project, tasks, milestones = [] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const rows = tasks
    .filter(t => t.status !== 'cancelled' && t.deadline)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  const mRows = milestones.filter(m => m.due_date);

  if (rows.length === 0 && mRows.length === 0) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
      <BarChart2 size={36} style={{ marginBottom: 8, opacity: .3 }} />
      <p className="text-sm">Add deadlines to tasks or milestones to see the Gantt chart</p>
    </div>
  );

  // Build timeline range
  const allDates = rows.map(t => new Date(t.created_at));
  const allEnds  = [...rows.map(t => new Date(t.deadline)), ...mRows.map(m => new Date(m.due_date))];
  if (project.deadline) allEnds.push(new Date(project.deadline));

  const rangeStart = allDates.length
    ? new Date(Math.min(...allDates.map(d => d.getTime())))
    : new Date(Math.min(...allEnds.map(d => d.getTime())));
  const rangeEnd   = new Date(Math.max(...allEnds.map(d => d.getTime())));
  rangeStart.setDate(rangeStart.getDate() - 4);
  rangeEnd.setDate(rangeEnd.getDate() + 4);
  const totalMs = rangeEnd - rangeStart;

  const toPct = d => Math.max(0, Math.min(100, (new Date(d) - rangeStart) / totalMs * 100));
  const todayPct = toPct(today);

  // Month grid lines
  const months = [];
  const cur = new Date(rangeStart); cur.setDate(1);
  while (cur <= rangeEnd) {
    months.push({ label: cur.toLocaleString('default', { month: 'short', year: '2-digit' }), pct: toPct(cur) });
    cur.setMonth(cur.getMonth() + 1);
  }

  const STATUS_COLORS = { open: '#3b82f6', in_progress: '#f59e0b', completed: '#22c55e', closed: '#10b981', waiting_customer: '#f97316', waiting_vendor: '#a855f7' };

  // Diamond SVG for milestones
  function Diamond({ color, size = 12 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: 'block' }}>
        <polygon points="6,0 12,6 6,12 0,6" fill={color} />
      </svg>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap', fontSize: 12 }}>
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ef4444', display: 'inline-block' }} /> Overdue
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Diamond color="#7c3aed" size={12} /> Milestone
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 2, height: 14, background: '#ef4444', display: 'inline-block' }} /> Today
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          {/* Month labels */}
          <div style={{ position: 'relative', height: 18, marginLeft: 190, marginBottom: 4 }}>
            {months.map((m, i) => (
              <div key={i} style={{ position: 'absolute', left: `${m.pct}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{m.label}</div>
            ))}
          </div>

          {/* Task rows */}
          {rows.map(task => {
            const startPct   = toPct(task.created_at);
            const endPct     = toPct(task.deadline);
            const barLeft    = Math.min(startPct, endPct);
            const barWidth   = Math.max(0.5, Math.abs(endPct - startPct));
            const overdue    = isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status);
            const barColor   = overdue ? '#ef4444' : (STATUS_COLORS[task.status] || '#3b82f6');

            return (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 500, color: 'var(--gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {(task.status === 'completed' || task.status === 'closed') && <CheckCircle2 size={11} color="var(--success)" style={{ flexShrink: 0 }} />}
                  {overdue && <AlertTriangle size={11} color="var(--danger)" style={{ flexShrink: 0 }} />}
                  {task.is_blocked && <Lock size={11} color="#6366f1" style={{ flexShrink: 0 }} />}
                  <span title={task.title}>{task.title}</span>
                </div>

                <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                  {months.map((m, i) => (
                    <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, width: 1, background: 'var(--gray-100)' }} />
                  ))}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                  <div style={{
                    position: 'absolute', left: `${barLeft}%`, width: `${barWidth}%`,
                    top: 4, bottom: 4,
                    background: barColor, borderRadius: 4,
                    opacity: ['completed','closed'].includes(task.status) ? 0.55 : 0.82,
                    overflow: 'hidden', display: 'flex', alignItems: 'center',
                    paddingLeft: 5, fontSize: 10, color: '#fff', fontWeight: 600,
                    minWidth: 4,
                  }}>
                    {barWidth > 10 && fmtDate(task.deadline)}
                  </div>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${endPct}%`, width: 3, background: overdue ? '#dc2626' : barColor, borderRadius: 2, zIndex: 6, transform: 'translateX(-1px)' }} />
                </div>

                <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                  {fmtDate(task.deadline)}
                </div>
              </div>
            );
          })}

          {/* Milestone rows */}
          {mRows.length > 0 && (
            <>
              <div style={{ marginTop: 8, marginBottom: 4, paddingTop: 8, borderTop: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em' }}>Milestones</span>
              </div>
              {mRows.map(m => {
                const mPct    = toPct(m.due_date);
                const overdue = isOverdue(m.due_date) && !m.completed_at;
                const color   = m.completed_at ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed';
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                    <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 500,
                      color: m.completed_at ? 'var(--gray-400)' : overdue ? 'var(--danger)' : '#7c3aed',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Diamond color={color} size={10} />
                      <span title={m.title} style={{ textDecoration: m.completed_at ? 'line-through' : 'none' }}>{m.title}</span>
                    </div>
                    <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                      {months.map((mo, i) => (
                        <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${mo.pct}%`, width: 1, background: 'var(--gray-100)' }} />
                      ))}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                      {/* Diamond marker */}
                      <div style={{ position: 'absolute', top: '50%', left: `${mPct}%`, transform: 'translate(-50%, -50%)', zIndex: 8 }}>
                        <Diamond color={color} size={14} />
                      </div>
                      {/* Vertical spike */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${mPct}%`, width: 2, background: color + '80', zIndex: 6, transform: 'translateX(-1px)' }} />
                    </div>
                    <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                      {fmtDate(m.due_date)}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Project deadline row */}
          {project.deadline && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--gray-100)' }}>
              <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Project Deadline</div>
              <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${toPct(project.deadline)}%`, width: 4, background: isOverdue(project.deadline) ? '#dc2626' : '#3b82f6', borderRadius: 2, zIndex: 6, transform: 'translateX(-2px)' }} />
              </div>
              <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, fontWeight: 700, color: isOverdue(project.deadline) ? 'var(--danger)' : 'var(--primary)' }}>
                {fmtDate(project.deadline)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Milestones Tab ───────────────────────────────────────── */
function MilestonesTab({ projectId, canManage, milestones, onReload }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ title: '', description: '', due_date: '' });
  const [saving,  setSaving]  = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function openAdd() { setEditing(null); setForm({ title: '', description: '', due_date: '' }); setShowAdd(true); }
  function openEdit(m) { setEditing(m); setForm({ title: m.title, description: m.description || '', due_date: m.due_date?.slice(0, 10) || '' }); setShowAdd(true); }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        await api.updateMilestone(editing.id, form);
      } else {
        await api.createMilestone({ project_id: projectId, ...form });
      }
      setShowAdd(false); setEditing(null); onReload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function del(m) {
    const ok = await confirm(`Delete milestone "${m.title}"?`, { title: 'Delete Milestone' });
    if (!ok) return;
    try { await api.deleteMilestone(m.id); onReload(); } catch (e) { toast.error(e.message); }
  }

  async function complete(m) {
    await api.completeMilestone(m.id); onReload();
  }

  async function reopen(m) {
    await api.reopenMilestone(m.id); onReload();
  }

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Milestone</button>
        </div>
      )}

      {milestones.length === 0 ? (
        <p className="text-muted text-sm">No milestones yet. Add key delivery checkpoints to track project progress.</p>
      ) : (
        <div>
          {milestones.map(m => {
            const done    = !!m.completed_at;
            const overdue = isOverdue(m.due_date) && !done;
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 0', borderBottom: '1px solid var(--gray-100)',
              }}>
                {/* Diamond icon */}
                <div style={{ flexShrink: 0, marginTop: 2 }}>
                  <svg width={16} height={16} viewBox="0 0 12 12">
                    <polygon points="6,0 12,6 6,12 0,6"
                      fill={done ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed'} />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontWeight: 600, fontSize: 14,
                      textDecoration: done ? 'line-through' : 'none',
                      color: done ? 'var(--gray-400)' : 'var(--gray-800)',
                    }}>{m.title}</span>
                    {done && <span className="badge badge-done">Completed</span>}
                    {overdue && <span className="badge badge-cancelled">Overdue</span>}
                  </div>
                  {m.description && (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--gray-500)' }}>{m.description}</p>
                  )}
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--gray-400)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {m.due_date && <span>Due: <span className={overdue ? 'overdue' : ''}>{fmtDate(m.due_date)}</span></span>}
                    {done && m.completed_by_name && <span>Completed by {m.completed_by_name}</span>}
                    {done && m.completed_at && <span>on {fmtDate(m.completed_at)}</span>}
                  </div>
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {done
                      ? <button className="btn btn-sm btn-ghost" onClick={() => reopen(m)}>↩ Reopen</button>
                      : <button className="btn btn-sm btn-success" onClick={() => complete(m)}>✓ Done</button>
                    }
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(m)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => del(m)}>Del</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title={editing ? 'Edit Milestone' : 'Add Milestone'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group"><label>Title *</label><input value={form.title} onChange={set('title')} required autoFocus /></div>
            <div className="form-group"><label>Description</label><textarea value={form.description} onChange={set('description')} rows={2} /></div>
            <div className="form-group"><label>Due Date</label><input type="date" value={form.due_date} onChange={set('due_date')} /></div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Milestone')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ── Inline Scorecard Tab ─────────────────────────────────── */
function ScorecardTab({ projectId, members }) {
  const { user }  = useAuth();
  const toast     = useToast();
  const confirm   = useConfirm();
  const [cards, setCards]     = useState([]);
  const [showForm, setShow]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSel]    = useState(null);

  const engineers = (members || []).filter(m => m.role === 'engineer');
  const load = () => api.scorecards({ project_id: projectId }).then(setCards);
  useEffect(() => { load(); }, [projectId]);

  const blank = { timeline_rating:3, delivery_quality:3, communication_ownership:3, documentation_quality:3, customer_feedback:3, difficulty:3, notes:'' };

  async function save(form) {
    if (editing) {
      await api.updateScorecard(editing.id, form);
    } else {
      await api.createScorecard({ ...form, project_id: Number(projectId) });
    }
    setShow(false); setEditing(null); load();
  }

  async function del(id) {
    const ok = await confirm('Delete this scorecard?', { title: 'Delete Scorecard' });
    if (!ok) return;
    try { await api.deleteScorecard(id); load(); } catch (e) { toast.error(e.message); }
  }

  /* inline form */
  const [form, setForm] = useState(blank);
  const setDim = k => v => setForm(f => ({ ...f, [k]: v }));
  const mults = { 1:0.90, 2:0.95, 3:1.00, 4:1.05, 5:1.10 };
  const wsum  = Object.entries(WEIGHTS).reduce((s,[k,m]) => s + (form[k]||3) * m.pct / 100, 0);
  const baseP = Math.round(wsum / 5 * 1000) / 10;
  const adjP  = Math.min(Math.round(baseP * (mults[form.difficulty]||1) * 10) / 10, 100);
  const r     = getRating(adjP);

  useEffect(() => {
    if (editing) setForm({ ...editing });
    else setForm(blank);
  }, [editing, showForm]);

  return (
    <div>
      {/* Summary strip */}
      {cards.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {cards.map(sc => (
            <div key={sc.id} onClick={() => setSel(sc)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#f9fafb',
                border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                flex: '1 1 220px', minWidth: 0 }}>
              <ScoreGauge score={sc.adjusted_score} size={56} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.engineer_name}</div>
                <ScoreBadge score={sc.adjusted_score} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>D{sc.difficulty} · {DIFFICULTY_LABELS[sc.difficulty]?.label}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); setEditing(sc); setShow(true); }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); del(sc.id); }}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      {engineers.length > 0 && (
        <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => { setEditing(null); setShow(true); }}>
          + Add Scorecard
        </button>
      )}
      {engineers.length === 0 && cards.length === 0 && <p className="text-muted text-sm">Assign engineers to this project first.</p>}

      {/* Inline scorecard detail */}
      {selected && (
        <Modal title="Scorecard Detail" onClose={() => setSel(null)}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap' }}>
            <ScoreGauge score={selected.adjusted_score} size={80} />
            <div>
              <div style={{ fontWeight: 700 }}>{selected.engineer_name}</div>
              <ScoreBadge score={selected.adjusted_score} size="lg" />
              <div className="text-sm text-muted mt-4">Evaluated by {selected.evaluated_by_name}</div>
            </div>
          </div>
          <ScorecardBreakdown sc={selected} />
          {selected.notes && <p style={{ marginTop: 12, fontSize: 13, color: '#374151' }}>{selected.notes}</p>}
          <div className="modal-footer"><button className="btn btn-primary" onClick={() => setSel(null)}>Close</button></div>
        </Modal>
      )}

      {/* Create/edit form modal */}
      {showForm && (
        <Modal title={editing ? 'Edit Scorecard' : 'New Scorecard'} onClose={() => { setShow(false); setEditing(null); }}>
          <form onSubmit={async e => { e.preventDefault(); await save(form); }}>
            {!editing && (
              <div className="form-group">
                <label>Engineer *</label>
                <select value={form.engineer_id || ''} onChange={e => setForm(f => ({ ...f, engineer_id: Number(e.target.value) }))} required>
                  <option value="">Select engineer…</option>
                  {engineers.filter(e => !cards.some(c => c.engineer_id === e.id)).map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Live preview */}
            <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px', marginBottom:14,
              display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', border:`2px solid ${r.color}20` }}>
              <ScoreGauge score={adjP} size={64} />
              <div>
                <div style={{ fontWeight:800, fontSize:20, color:r.color }}>{adjP}%</div>
                <ScoreBadge score={adjP} size="lg" />
              </div>
              <div style={{ fontSize:11, color:'#9ca3af', lineHeight:1.8 }}>
                Base: {baseP}% &nbsp;·&nbsp; Adj: {DIFFICULTY_LABELS[form.difficulty]?.mult}
              </div>
            </div>
            {/* Dimensions */}
            <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
              {Object.entries(WEIGHTS).map(([key, meta]) => (
                <div key={key} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
                  <div style={{ width:180, flexShrink:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{meta.label}</div>
                    <div style={{ fontSize:10, color:'#9ca3af' }}>{meta.pct}% weight</div>
                  </div>
                  <DimPicker value={form[key]||3} onChange={setDim(key)} />
                </div>
              ))}
            </div>
            {/* Difficulty */}
            <div className="form-group">
              <label>Project Difficulty</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4 }}>
                {[1,2,3,4,5].map(d => {
                  const dl = DIFFICULTY_LABELS[d]; const active = form.difficulty === d;
                  return (
                    <button key={d} type="button" onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                      style={{ padding:'4px 10px', borderRadius:6, border:`2px solid ${active?dl.color:'#e5e7eb'}`,
                        background:active?dl.color+'15':'#fff', color:active?dl.color:'#6b7280',
                        cursor:'pointer', fontSize:11, fontWeight:active?700:400 }}>
                      D{d} {dl.label}<br/><span style={{ fontSize:10, opacity:.7 }}>{dl.mult}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="modal-footer" style={{ padding:'12px 0 0', border:'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShow(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Save Scorecard'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Excel Effort-Sheet Import Modal ───────────────────────────────────────
function ImportExcelModal({ projectId, onClose, onImported }) {
  const [file,      setFile]      = useState(null);
  const [preview,   setPreview]   = useState(null);   // { tasks, meta }
  const [selected,  setSelected]  = useState(new Set());
  const [loading,   setLoading]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState('');

  async function handleParse() {
    if (!file) return;
    setLoading(true); setError(''); setPreview(null); setSelected(new Set()); setDone('');
    try {
      const res = await api.importExcelPreview(projectId, file);
      if (res.error) { setError(res.error); return; }
      setPreview(res);
      setSelected(new Set(res.tasks.map((_, i) => i)));
    } catch (e) {
      setError('Failed to parse file: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleAll(checked) {
    setSelected(checked ? new Set(preview.tasks.map((_, i) => i)) : new Set());
  }

  function toggleOne(i) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function handleImport() {
    if (!preview || selected.size === 0) return;
    setImporting(true); setError('');
    try {
      const tasks = [...selected].map(i => preview.tasks[i]);
      const res = await api.importExcelConfirm(projectId, tasks);
      if (res.error) { setError(res.error); return; }
      setDone(res.message || `${res.created} tasks imported`);
      setPreview(null);
      onImported();
    } catch (e) {
      setError('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  // Group tasks: product (amber row) → subProduct (plain row) → taskGroup (grey row)
  function groupedTasks() {
    const groups = [];
    let lastProduct = null, lastSub = null, lastGroup = null;
    (preview?.tasks || []).forEach((t, i) => {
      if (t.product !== lastProduct) {
        if (t.product) groups.push({ type: 'product', label: t.product });
        lastProduct = t.product; lastSub = null; lastGroup = null;
      }
      const subKey = t.subProduct || '';
      if (subKey !== lastSub) {
        if (t.subProduct) groups.push({ type: 'sub', label: t.subProduct });
        lastSub = subKey; lastGroup = null;
      }
      if (t.taskGroup !== lastGroup) {
        groups.push({ type: 'group', label: t.taskGroup || 'General' });
        lastGroup = t.taskGroup;
      }
      groups.push({ type: 'task', task: t, index: i });
    });
    return groups;
  }

  const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--gray-100)' };
  const selectedTasks = preview ? [...selected].map(i => preview.tasks[i]) : [];

  return (
    <Modal title="Import Tasks from Excel" onClose={onClose} width={780}>
      {/* File picker row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          border: '1px dashed var(--gray-300)', borderRadius: 6, cursor: 'pointer',
          background: 'var(--gray-50)', fontSize: 13, color: 'var(--gray-600)',
        }}>
          <Upload size={16} color="var(--primary)" />
          {file ? file.name : 'Click to select an Excel (.xlsx) effort sheet…'}
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { setFile(e.target.files[0] || null); setPreview(null); setDone(''); setError(''); }} />
        </label>
        <button className="btn btn-primary btn-sm" onClick={handleParse} disabled={!file || loading}>
          {loading ? 'Parsing…' : 'Parse'}
        </button>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
      {done  && <p style={{ color: '#16a34a', fontSize: 13, margin: '0 0 12px' }}>{done}</p>}

      {/* Metadata bar */}
      {preview?.meta && Object.keys(preview.meta).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 12,
          padding: '8px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 12, color: '#1e40af' }}>
          {preview.meta.customer    && <span><b>Customer:</b> {preview.meta.customer}</span>}
          {preview.meta.projectName && <span><b>Project:</b> {preview.meta.projectName}</span>}
          {preview.meta.reference   && <span><b>Ref:</b> {preview.meta.reference}</span>}
          {preview.meta.owner       && <span><b>Owner:</b> {preview.meta.owner}</span>}
          {preview.meta.completionDate && <span><b>Completion:</b> {preview.meta.completionDate}</span>}
        </div>
      )}

      {/* Task preview */}
      {preview && preview.tasks.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>
              Found <b>{preview.tasks.length}</b> task{preview.tasks.length !== 1 ? 's' : ''} — {selected.size} selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(true)}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(false)}>None</button>
            </div>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--gray-200)', borderRadius: 6, marginBottom: 14 }}>
            {groupedTasks().map((item, idx) => {
              if (item.type === 'product') return (
                <div key={idx} style={{ padding: '6px 10px', background: '#fef3c7', borderBottom: '1px solid #fde68a',
                  fontSize: 12, fontWeight: 700, color: '#78350f', letterSpacing: '.03em' }}>
                  📦 {item.label || 'General Product'}
                </div>
              );
              if (item.type === 'sub') return (
                <div key={idx} style={{ padding: '5px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a',
                  fontSize: 12, fontWeight: 600, color: '#92400e' }}>
                  ▸ {item.label}
                </div>
              );
              if (item.type === 'group') return (
                <div key={idx} style={{ padding: '4px 14px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)',
                  fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {item.label}
                </div>
              );
              const { task: t, index: i } = item;
              return (
                <div key={idx} style={{ ...ROW, padding: '6px 14px', cursor: 'pointer',
                  background: selected.has(i) ? '#f0fdf4' : 'white' }}
                  onClick={() => toggleOne(i)}>
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggleOne(i)}
                    onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {preview && preview.tasks.length === 0 && (
        <p style={{ color: 'var(--gray-500)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          No tasks found. Make sure you're using an effort sheet with yellow task rows.
        </p>
      )}

      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        {preview && preview.tasks.length > 0 && (
          <button className="btn btn-primary" onClick={handleImport}
            disabled={selected.size === 0 || importing}>
            {importing ? 'Importing…' : `Import ${selected.size} Task${selected.size !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ── PDF Print View ───────────────────────────────────────── */
function ProjectPrintView({ project, tasks, milestones, members }) {
  if (!project) return null;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const taskCount  = tasks.filter(t => t.status !== 'cancelled').length;
  const doneCount  = tasks.filter(t => ['completed','closed'].includes(t.status)).length;
  const openCount  = tasks.filter(t => t.status === 'open').length;
  const overCount  = tasks.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length;
  const pct        = taskCount > 0 ? Math.round(doneCount / taskCount * 100) : 0;
  const pctDisplay = project.completion_pct != null ? project.completion_pct : pct;

  const STATUS_LABELS = {
    open:'Open', in_progress:'In Progress', completed:'Completed', closed:'Closed',
    cancelled:'Cancelled', waiting_customer:'Waiting Customer', waiting_vendor:'Waiting Vendor',
    pending_approval:'Pending Approval', on_hold:'On Hold', not_started:'Not Started',
    delayed:'Delayed', reopened:'Reopened',
  };

  const recentUpdates = (project.updates || []).slice(0, 5);
  const activeTasks   = tasks.filter(t => !['cancelled','closed'].includes(t.status)).slice(0, 20);

  return (
    <div className="print-view" style={{ fontFamily: 'Arial, sans-serif', color: '#111', fontSize: 13, lineHeight: 1.5 }}>
      {/* Header */}
      <div className="print-report-header">
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>{project.title}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{
              padding: '2px 10px', borderRadius: 99, fontWeight: 700, fontSize: 11,
              background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
            }}>{STATUS_LABELS[project.status] || project.status}</span>
            <span style={{ color: '#6b7280' }}>Priority: <b>{project.priority}</b></span>
            {project.customer_name && <span style={{ color: '#6b7280' }}>Customer: <b>{project.customer_name}</b></span>}
            {project.deadline && <span style={{ color: '#6b7280' }}>Deadline: <b>{fmtDate(project.deadline)}</b></span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#9ca3af' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 2 }}>Project Report</div>
          <div>Generated {today}</div>
          <div style={{ marginTop: 4 }}>
            <span style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: project.rag_status === 'green' ? '#d1fae5' : project.rag_status === 'amber' ? '#fef3c7' : project.rag_status === 'red' ? '#fee2e2' : '#f3f4f6',
              color: project.rag_status === 'green' ? '#065f46' : project.rag_status === 'amber' ? '#92400e' : project.rag_status === 'red' ? '#991b1b' : '#374151',
            }}>
              {project.rag_status === 'green' ? '🟢 On Track' : project.rag_status === 'amber' ? '🟡 At Risk' : project.rag_status === 'red' ? '🔴 Critical' : 'Health N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="print-report-grid">
        {[
          { label: 'Completion', value: `${pctDisplay}%`, color: pctDisplay >= 75 ? '#059669' : pctDisplay >= 40 ? '#2563eb' : '#374151' },
          { label: 'Total Tasks', value: taskCount },
          { label: 'Completed', value: doneCount, color: '#059669' },
          { label: 'Overdue', value: overCount, color: overCount > 0 ? '#dc2626' : '#059669' },
        ].map(s => (
          <div key={s.label} className="print-stat-box">
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#111827' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: '#f3f4f6', borderRadius: 8, height: 10, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 8,
          width: `${pctDisplay}%`,
          background: pctDisplay >= 75 ? '#10b981' : pctDisplay >= 40 ? '#3b82f6' : '#f59e0b',
        }} />
      </div>

      {/* Description */}
      {project.description && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, color: '#374151' }}>
          {project.description}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Tasks */}
        <div>
          <div className="print-section-title">Tasks ({taskCount})</div>
          {activeTasks.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12 }}>No tasks yet</p>
          ) : activeTasks.map(t => (
            <div key={t.id} className="print-task-row">
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: ['completed','closed'].includes(t.status) ? '#10b981' : t.status === 'in_progress' ? '#f59e0b' : isOverdue(t.deadline) ? '#ef4444' : '#3b82f6',
              }} />
              <span style={{ flex: 1, fontWeight: ['completed','closed'].includes(t.status) ? 400 : 500, color: ['completed','closed'].includes(t.status) ? '#9ca3af' : '#111', textDecoration: ['completed','closed'].includes(t.status) ? 'line-through' : 'none' }}>{t.title}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{t.assigned_to_name || '—'}</span>
              {t.deadline && <span style={{ fontSize: 10, color: isOverdue(t.deadline) ? '#ef4444' : '#9ca3af', flexShrink: 0, fontWeight: isOverdue(t.deadline) ? 700 : 400 }}>{fmtDate(t.deadline)}</span>}
            </div>
          ))}
          {tasks.length > 20 && <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>+ {tasks.length - 20} more tasks not shown</p>}
        </div>

        {/* Right column: Members + Milestones + Updates */}
        <div>
          {/* Members */}
          {members?.length > 0 && (
            <>
              <div className="print-section-title">Team ({members.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {members.map(m => (
                  <span key={m.id} style={{ fontSize: 11, padding: '2px 8px', background: '#eff6ff', color: '#1e40af', borderRadius: 99, fontWeight: 600 }}>{m.name}</span>
                ))}
              </div>
            </>
          )}

          {/* Milestones */}
          {milestones?.length > 0 && (
            <>
              <div className="print-section-title">Milestones ({milestones.length})</div>
              {milestones.slice(0, 6).map(m => (
                <div key={m.id} className="print-task-row">
                  <svg width={10} height={10} viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
                    <polygon points="6,0 12,6 6,12 0,6" fill={m.completed_at ? '#10b981' : isOverdue(m.due_date) ? '#ef4444' : '#7c3aed'} />
                  </svg>
                  <span style={{ flex: 1, fontSize: 12, textDecoration: m.completed_at ? 'line-through' : 'none', color: m.completed_at ? '#9ca3af' : '#111' }}>{m.title}</span>
                  {m.due_date && <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{fmtDate(m.due_date)}</span>}
                </div>
              ))}
            </>
          )}

          {/* Recent updates */}
          {recentUpdates.length > 0 && (
            <>
              <div className="print-section-title" style={{ marginTop: 10 }}>Recent Updates</div>
              {recentUpdates.map(u => (
                <div key={u.id} style={{ padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                  <div style={{ color: '#374151' }}>{u.message}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{u.user_name} · {fmtDate(u.created_at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 20, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af' }}>
        <span>SolutionsHub — Confidential</span>
        <span>Exported {today}</span>
      </div>
    </div>
  );
}

/* ── Kanban View ──────────────────────────────────────────── */
const KANBAN_COLS = [
  { key: 'open',             label: 'Open',             color: '#3b82f6', bg: '#eff6ff' },
  { key: 'in_progress',      label: 'In Progress',      color: '#f59e0b', bg: '#fffbeb' },
  { key: 'waiting_customer', label: 'Waiting Customer', color: '#f97316', bg: '#fff7ed' },
  { key: 'waiting_vendor',   label: 'Waiting Vendor',   color: '#a855f7', bg: '#faf5ff' },
  { key: 'completed',        label: 'Completed',        color: '#10b981', bg: '#f0fdf4' },
];

function KanbanView({ tasks, isManager, isPlanner, onUpdate, onRowClick, onDuplicate }) {
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-800)', wordBreak: 'break-word', lineHeight: 1.3 }}>
                        {task.is_blocked && <Lock size={10} color="#6366f1" style={{ marginRight: 3, verticalAlign: 'middle' }} />}
                        {task.title}
                        {task.is_adhoc && <span className="badge badge-adhoc" style={{ marginLeft: 5 }}>adhoc</span>}
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

/* ── Custom Fields Tab ────────────────────────────────────── */
function CustomFieldsTab({ projectId, canManage }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const [fields,  setFields]  = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ name: '', field_type: 'text', options: [], required: false });
  const [optInput, setOptInput] = useState('');
  const [saving,  setSaving]  = useState(false);

  const loadFields = () => api.customFields(projectId).then(setFields).catch(() => {});
  useEffect(() => { loadFields(); }, [projectId]);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', field_type: 'text', options: [], required: false });
    setOptInput('');
    setShowAdd(true);
  }

  function openEdit(f) {
    setEditing(f);
    setForm({ name: f.name, field_type: f.field_type, options: f.options || [], required: !!f.required });
    setOptInput('');
    setShowAdd(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        await api.updateCustomField(projectId, editing.id, form);
      } else {
        await api.createCustomField(projectId, form);
      }
      setShowAdd(false); setEditing(null); loadFields();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function del(id) {
    const ok = await confirm('Delete this custom field? All task values for this field will also be removed.', { title: 'Delete Custom Field' });
    if (!ok) return;
    try { await api.deleteCustomField(projectId, id); loadFields(); } catch (e) { toast.error(e.message); }
  }

  function addOption() {
    const v = optInput.trim();
    if (!v || form.options.includes(v)) return;
    setForm(f => ({ ...f, options: [...f.options, v] }));
    setOptInput('');
  }

  function removeOption(opt) {
    setForm(f => ({ ...f, options: f.options.filter(o => o !== opt) }));
  }

  const TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown' };

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Field</button>
        </div>
      )}

      {fields.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--gray-400)' }}>
          <SlidersHorizontal size={32} style={{ marginBottom: 8, opacity: .3 }} />
          <p className="text-sm">No custom fields yet. Add project-specific fields like "Device Type" or "Ticket ID".</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Field Name</th><th>Type</th><th>Required</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td>
                    <span style={{ fontSize: 11, background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 6, fontWeight: 600, color: 'var(--gray-600)' }}>
                      {TYPE_LABELS[f.field_type] || f.field_type}
                    </span>
                    {f.field_type === 'select' && f.options?.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 6 }}>
                        ({f.options.join(', ')})
                      </span>
                    )}
                  </td>
                  <td>{f.required ? <span style={{ color: '#ef4444', fontWeight: 700 }}>Required</span> : <span className="text-muted">Optional</span>}</td>
                  {canManage && (
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(f)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => del(f.id)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={editing ? 'Edit Custom Field' : 'Add Custom Field'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group">
              <label>Field Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus placeholder="e.g. Device Type, Ticket ID" />
            </div>
            <div className="form-group">
              <label>Field Type</label>
              <select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value, options: [] }))}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown (select)</option>
              </select>
            </div>
            {form.field_type === 'select' && (
              <div className="form-group">
                <label>Options</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    value={optInput}
                    onChange={e => setOptInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                    placeholder="Type an option and press Enter"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addOption}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {form.options.map(opt => (
                    <span key={opt} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                      background: '#dbeafe', color: '#1e40af', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    }}>
                      {opt}
                      <button type="button" onClick={() => removeOption(opt)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} style={{ width: 'auto' }} />
                Required field
              </label>
            </div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Field')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();
  const confirm   = useConfirm();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isEngineer = user.role === 'engineer';
  const isPM       = user.role === 'pm';
  const canManage  = isManager || isPlanner;
  const [project,    setProject]    = useState(null);
  const [tasks,      setTasks]      = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [allUsers,   setAllUsers]   = useState([]);
  const [customers,  setCustomers]  = useState([]);
  const [activity,   setActivity]   = useState([]);
  const [tab, setTab] = useState(isPM ? 'milestones' : 'tasks');
  const [statusMsg, setStatusMsg] = useState('');
  const [showEdit,         setShowEdit]         = useState(false);
  const [showAddTask,      setShowAddTask]      = useState(false);
  const [addTaskErr,       setAddTaskErr]       = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showImportExcel,  setShowImportExcel]  = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskViewMode, setTaskViewMode] = useState('list'); // 'list' | 'kanban'
  const [taskSearch,   setTaskSearch]   = useState('');
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', is_adhoc: false });
  const [editForm, setEditForm] = useState({});

  const loadMilestones = () => api.milestones(id).then(setMilestones).catch(() => {});

  const load = () => Promise.all([
    api.project(id),
    isPM ? Promise.resolve([]) : api.tasks({ project_id: id }),
    isManager ? api.users()     : Promise.resolve([]),
    isManager ? api.customers() : Promise.resolve([]),
    api.projectActivity(id),
  ]).then(([p, t, u, c, act]) => {
    setProject(p);
    setTasks(t);
    setAllUsers(u);
    setCustomers(c);
    setActivity(act ?? []);
    loadMilestones();
  });
  useEffect(() => { load(); }, [id, isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <div className="page"><p className="text-muted">Loading…</p></div>;

  const setT = k => e => setTaskForm(f => ({ ...f, [k]: e.target.value }));
  const setE = k => e => setEditForm(f => ({ ...f, [k]: e.target.value }));

  async function submitStatusUpdate(e) {
    e.preventDefault();
    if (!statusMsg.trim()) return;
    try {
      await api.addStatusUpdate(id, statusMsg);
      toast.success('Status update posted');
      setStatusMsg('');
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function requestClosure() {
    const ok = await confirm('Request closure for this project? It will go to the manager for approval.', { title: 'Request Closure', label: 'Request', danger: false });
    if (!ok) return;
    try { await api.requestClosure(id); toast.success('Closure requested — pending manager approval'); load(); } catch (e) { toast.error(e.message); }
  }

  async function approveClosure() {
    const ok = await confirm('Approve closure for this project? This will mark it as closed.', { title: 'Approve Closure', label: 'Approve', danger: false });
    if (!ok) return;
    try { await api.approveClosure(id); toast.success('Project closed successfully'); load(); } catch (e) { toast.error(e.message); }
  }

  async function rejectClosure(note) {
    await api.updateProject(id, { status: 'reopened' });
    const msg = note?.trim()
      ? `Closure rejected by ${user.name}: ${note.trim()}`
      : `Closure rejected by ${user.name}. Project reopened for further work.`;
    await api.addStatusUpdate(id, msg);
    setShowRejectDialog(false); load();
  }

  async function reopenProject() {
    const ok = await confirm('Reopen this project?', { title: 'Reopen Project', label: 'Reopen', danger: false });
    if (!ok) return;
    try {
      await api.updateProject(id, { status: 'reopened' });
      await api.addStatusUpdate(id, `Project reopened by ${user.name}.`);
      toast.success('Project reopened');
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      await api.updateProject(id, editForm);
      toast.success('Project updated');
      setShowEdit(false); load();
    } catch (err) { toast.error(err.message); }
  }

  async function addTask(e) {
    e.preventDefault();
    setAddTaskErr('');
    try {
      await api.createTask({ ...taskForm, project_id: Number(id) });
      toast.success('Task created');
      setShowAddTask(false);
      setAddTaskErr('');
      setTaskForm({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', is_adhoc: false });
      load();
    } catch (err) {
      setAddTaskErr(err.message || 'Failed to create task');
    }
  }

  async function updateTask(tid, data) {
    try {
      await api.updateTask(tid, data);
    } catch (err) {
      toast.error(err.message || 'Failed to update task');
    } finally {
      load(); // always refresh so Kanban reverts on failure
    }
  }

  async function duplicateTask(tid) {
    await api.duplicateTask(tid).then(() => toast.success('Task duplicated')).catch(e => toast.error(e.message));
    load();
  }

  const engineers = allUsers.filter(u => u.role === 'engineer');
  const addableUsers = allUsers.filter(u => u.role !== 'manager');
  const taskCount = tasks.filter(t => t.status !== 'cancelled').length;
  const doneCount = tasks.filter(t => t.status === 'completed' || t.status === 'closed').length;
  const filteredTasks = taskSearch.trim()
    ? tasks.filter(t => {
        const q = taskSearch.toLowerCase();
        return (t.title || '').toLowerCase().includes(q) ||
               (t.assigned_to_name || '').toLowerCase().includes(q) ||
               (t.status || '').toLowerCase().includes(q);
      })
    : tasks;

  return (
    <div className="page">
      {/* Print-only view — hidden on screen, shown when printing */}
      <ProjectPrintView project={project} tasks={tasks} milestones={milestones} members={project.members} />

      <div className="print-body-hide">
      <div className="page-header">
        <div>
          <p className="text-sm text-muted" style={{ marginBottom: 4 }}>
            <a href="/projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={14} /> Projects</a>
          </p>
          <h1 className="page-title">{project.title}</h1>
          <div className="flex-center gap-8 mt-4" style={{ flexWrap: 'wrap' }}>
            <StatusBadge s={project.status} />
            <PriorityBadge p={project.priority} />
            {project.rag_status && <RagBadge rag={project.rag_status} />}
            {project.deadline && <span className={'text-sm ' + (isOverdue(project.deadline) && project.status !== 'closed' ? 'overdue' : 'text-muted')}>Due: {fmtDate(project.deadline)}</span>}
          </div>
        </div>
        <div className="flex gap-8">
          {/* Export PDF */}
          {isManager && (
            <button
              className="btn btn-ghost btn-sm print-hide"
              onClick={() => window.print()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Export a PDF summary of this project"
            >
              <Printer size={14} /> Export PDF
            </button>
          )}
          {/* Edit — manager/planner only, not when closed */}
          {canManage && project.status !== 'closed' && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setEditForm({ title: project.title, description: project.description, priority: project.priority, deadline: project.deadline?.slice(0, 10) || '', status: project.status, customer_id: project.customer_id || '', pending_from_customer: project.pending_from_customer || '', completion_pct: project.completion_pct ?? '', rag_override: project.rag_override || '' });
              setShowEdit(true);
            }}>Edit</button>
          )}
          {/* Submit for closure — anyone who can manage and project is still active */}
          {!['closed','cancelled','pending_approval'].includes(project.status) && canManage && (
            <button className="btn btn-ghost btn-sm" onClick={requestClosure}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Submit this project for closure approval">
              <Lock size={13} /> Submit for Closure
            </button>
          )}
          {/* Engineer: request closure */}
          {!['closed','cancelled','pending_approval'].includes(project.status) && isEngineer && (
            <button className="btn btn-ghost btn-sm" onClick={requestClosure}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Request manager review before closing">
              <Lock size={13} /> Request Closure
            </button>
          )}
          {/* Manager: reopen a closed project */}
          {project.status === 'closed' && isManager && (
            <button className="btn btn-ghost btn-sm" onClick={reopenProject}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={13} /> Reopen Project
            </button>
          )}
        </div>
      </div>

      {/* ── Workflow action banner ─────────────────────────── */}
      {project.status === 'pending_approval' && (
        <div style={{
          background: isManager ? '#fffbeb' : '#f0f9ff',
          border: `1px solid ${isManager ? '#fde68a' : '#bae6fd'}`,
          borderRadius: 10, padding: '14px 20px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>⏳</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: isManager ? '#92400e' : '#0369a1', marginBottom: 2 }}>
              {isManager ? 'Closure Approval Required' : 'Awaiting Management Approval'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
              {isManager
                ? 'This project has been submitted for closure. Review and approve or send back for revision.'
                : 'A manager will review this project before it is closed. You will be notified of the decision.'}
            </div>
          </div>
          {isManager && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="btn btn-success btn-sm"
                onClick={approveClosure}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <CheckCircle2 size={13} /> Approve &amp; Close
              </button>
              <button
                className="btn btn-warning btn-sm"
                onClick={() => setShowRejectDialog(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                ↩ Send Back
              </button>
            </div>
          )}
        </div>
      )}

      {/* Waiting for Customer banner */}
      {project.status === 'waiting_customer' && (
        <div style={{
          background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 2 }}>Waiting for Customer</div>
            {project.pending_from_customer
              ? <p style={{ margin: 0, fontSize: 13, color: '#7c2d12' }}>{project.pending_from_customer}</p>
              : <p style={{ margin: 0, fontSize: 13, color: '#c2410c' }}>No details provided. Edit the project to add what is needed from the customer.</p>
            }
          </div>
        </div>
      )}

      {project.customer_name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--gray-600)' }}>
          <Building2 size={14} />
          <span style={{ fontWeight: 600 }}>{project.customer_name}</span>
          {project.customer_contact && <span>· {project.customer_contact}</span>}
          {project.customer_email && <a href={`mailto:${project.customer_email}`} style={{ color: 'var(--primary)' }}>{project.customer_email}</a>}
        </div>
      )}

      {project.description && <p style={{ color: 'var(--gray-600)', marginBottom: 16 }}>{project.description}</p>}

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24 }}>{taskCount}</div><div className="stat-label">Total Tasks</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--success)' }}>{doneCount}</div><div className="stat-label">Completed</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24 }}>{project.members?.length || 0}</div><div className="stat-label">Members</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--primary)' }}>{project.completion_pct != null ? project.completion_pct : (taskCount > 0 ? Math.round(doneCount / taskCount * 100) : 0)}%</div><div className="stat-label">Progress{project.completion_pct != null ? ' (manual)' : ''}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 4 }}>
        <div className="progress-bar" style={{ height: 12 }}>
          <div className="progress-bar-fill" style={{ width: taskCount > 0 ? `${(doneCount / taskCount) * 100}%` : '0%' }} />
        </div>
      </div>

      <div className="tabs">
        {[
          ...(isPM ? [] : ['tasks']),
          'gantt',
          'milestones',
          'updates',
          'activity',
          'members',
          ...(isPM ? [] : ['attachments']),
          ...(canManage ? ['fields'] : []),
          ...(isManager ? ['kpis', 'scorecard'] : []),
        ].map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'kpis' ? 'KPIs' : t === 'scorecard' ? 'Scorecard' : t === 'fields' ? 'Custom Fields' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'tasks' && !isPM && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {/* View toggle */}
            <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--gray-200)', overflow: 'hidden', flexShrink: 0 }}>
              <button
                onClick={() => setTaskViewMode('list')}
                title="List view"
                style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                  background: taskViewMode === 'list' ? 'var(--primary)' : '#fff',
                  color: taskViewMode === 'list' ? '#fff' : 'var(--gray-500)' }}
              >
                <ListIcon size={14} /> List
              </button>
              <button
                onClick={() => setTaskViewMode('kanban')}
                title="Kanban view"
                style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                  background: taskViewMode === 'kanban' ? 'var(--primary)' : '#fff',
                  color: taskViewMode === 'kanban' ? '#fff' : 'var(--gray-500)' }}
              >
                <LayoutGrid size={14} /> Kanban
              </button>
            </div>

            <div style={{ flex: 1 }} />

            {canManage && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowImportExcel(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Upload size={14} /> Import from Excel
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}>+ Add Task</button>
              </>
            )}
          </div>

          {/* Task search */}
          {tasks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                <input
                  value={taskSearch}
                  onChange={e => setTaskSearch(e.target.value)}
                  placeholder="Search tasks…"
                  style={{ width: '100%', paddingLeft: 30, paddingRight: taskSearch ? 28 : 10, fontSize: 13 }}
                />
                <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: .4 }} width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/></svg>
                {taskSearch && (
                  <button onClick={() => setTaskSearch('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', padding: 2 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {taskSearch && (
                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                  {filteredTasks.length} of {tasks.length}
                </span>
              )}
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="text-muted text-sm">No tasks yet</p>
          ) : filteredTasks.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
              <p className="text-sm">No tasks matching &ldquo;{taskSearch}&rdquo;</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setTaskSearch('')}>Clear search</button>
            </div>
          ) : taskViewMode === 'kanban' ? (
            <KanbanView
              tasks={filteredTasks}
              isManager={isManager}
              isPlanner={isPlanner}
              onUpdate={updateTask}
              onRowClick={setSelectedTask}
              onDuplicate={duplicateTask}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assigned To</th><th>Deadline</th><th>Hours</th><th>Update</th></tr></thead>
                <tbody>{filteredTasks.map(t => <TaskRow key={t.id} task={t} isManager={isManager} isPlanner={isPlanner} allUsers={allUsers} onUpdate={updateTask} onRowClick={setSelectedTask} onDuplicate={duplicateTask} />)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'gantt' && (
        <div className="card">
          <GanttTab project={project} tasks={tasks} milestones={milestones} />
        </div>
      )}

      {tab === 'milestones' && (
        <div className="card">
          <MilestonesTab
            projectId={id}
            canManage={canManage}
            milestones={milestones}
            onReload={loadMilestones}
          />
        </div>
      )}

      {tab === 'updates' && (
        <div className="card">
          {!isPM && (
            <form onSubmit={submitStatusUpdate} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
              <MentionInput
                value={statusMsg}
                onChange={setStatusMsg}
                placeholder="Add a status update… (type @name to notify)"
                users={allUsers}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!statusMsg.trim()}>Post</button>
            </form>
          )}
          {!(project.updates?.length > 0)
            ? <p className="text-muted text-sm">No updates yet</p>
            : <ul className="updates-list">
                {project.updates.map(u => (
                  <li key={u.id} className="update-item">
                    <div>{renderMentions(u.message)}</div>
                    <div className="update-meta" title={fmtDate(u.created_at)}>{u.user_name} · {fmtRelative(u.created_at)}</div>
                  </li>
                ))}
              </ul>
          }
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ClipboardList size={15} /> Activity Feed
          </div>
          {activity.length === 0
            ? <p className="text-muted text-sm">No activity recorded yet.</p>
            : <ul style={{ listStyle: 'none' }}>
                {activity.map((a, i) => {
                  const iconMap = {
                    task_created:    <Plus         size={13} color="var(--success)" />,
                    task_status:     <RefreshCw    size={13} color="var(--primary)" />,
                    task_deleted:    <Trash2       size={13} color="var(--danger)"  />,
                    task_comment:    <MessageSquare size={13} color="var(--gray-500)" />,
                    project_created: <FolderOpen   size={13} color="var(--primary)" />,
                    status_changed:  <GitBranch    size={13} color="var(--warning)" />,
                    status_update:   <FileText     size={13} color="var(--gray-500)" />,
                    member_added:    <UserPlus     size={13} color="var(--success)" />,
                    member_removed:  <UserX        size={13} color="var(--danger)"  />,
                    closure_requested: <Lock       size={13} color="var(--warning)" />,
                    project_closed:  <CheckCircle2 size={13} color="var(--success)" />,
                  };
                  const icon = iconMap[a.action] || <span style={{ width: 13, height: 13 }}>·</span>;
                  const labels = {
                    task_created: 'Created task', task_status: 'Updated task status', task_deleted: 'Deleted task', task_comment: 'Commented on task',
                    project_created: 'Created project', status_changed: 'Changed project status', status_update: 'Posted update',
                    member_added: 'Added member', member_removed: 'Removed member', closure_requested: 'Requested closure', project_closed: 'Closed project',
                  };
                  return (
                    <li key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < activity.length - 1 ? '1px solid var(--gray-100)' : 'none', alignItems: 'flex-start' }}>
                      <span style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{a.user_name}</span>
                        <span style={{ fontSize: 13, color: 'var(--gray-600)' }}> {labels[a.action] || a.action}</span>
                        {a.detail && <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>: {a.detail}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--gray-400)', flexShrink: 0, marginTop: 2 }} title={fmtDate(a.created_at)}>{fmtRelative(a.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
          }
        </div>
      )}

      {tab === 'members' && (
        <div className="card">
          <div className="section-title">Team Members</div>
          {project.members?.length === 0 ? <p className="text-muted text-sm">No members assigned</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th>{isManager && <th>Action</th>}</tr></thead>
                <tbody>{project.members?.map(m => (
                  <tr key={m.id}>
                    <td>{m.name}</td><td>{m.email}</td>
                    <td><span className={`badge badge-${m.role}`}>{m.role}</span></td>
                    {isManager && <td><button className="btn btn-sm btn-danger" onClick={() => api.removeMember(id, m.id).then(load)}>Remove</button></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {isManager && addableUsers.filter(u => !project.members?.some(m => m.id === u.id)).length > 0 && (
            <div className="mt-16">
              <div className="section-title">Add Members</div>
              <div className="chip-list">
                {addableUsers.filter(u => !project.members?.some(m => m.id === u.id)).map(u => (
                  <div key={u.id} className="chip" style={{ cursor: 'pointer' }} onClick={() => api.addMembers(id, [u.id]).then(load)}>
                    {u.name}
                    <span style={{ fontSize: 10, marginLeft: 4, opacity: .65 }}>{u.role}</span>
                    <button>+</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'attachments' && (
        <div className="card"><AttachmentsSection projectId={id} /></div>
      )}

      {tab === 'fields' && canManage && (
        <div className="card"><CustomFieldsTab projectId={id} canManage={canManage} /></div>
      )}

      {tab === 'kpis' && isManager && (
        <div className="card"><KpiSection projectId={id} /></div>
      )}

      {tab === 'scorecard' && isManager && (
        <div className="card"><ScorecardTab projectId={id} members={project.members} /></div>
      )}

      {showEdit && (
        <Modal title="Edit Project" onClose={() => setShowEdit(false)}>
          <form onSubmit={saveEdit}>
            <div className="form-group"><label>Title</label><input value={editForm.title} onChange={setE('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={editForm.description || ''} onChange={setE('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={editForm.priority} onChange={setE('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Status</label>
                <select value={editForm.status} onChange={setE('status')}>
                  {[
                    { value: 'not_started',        label: 'Not Started' },
                    { value: 'in_progress',        label: 'In Progress' },
                    { value: 'waiting_customer',   label: 'Waiting for Customer' },
                    { value: 'waiting_vendor',     label: 'Waiting for Vendor' },
                    { value: 'on_hold',            label: 'On Hold' },
                    { value: 'delayed',            label: 'Delayed' },
                    { value: 'completed_engineer', label: 'Completed by Engineer' },
                    { value: 'pending_approval',   label: 'Pending Management Approval' },
                    { value: 'reopened',           label: 'Reopened' },
                    { value: 'cancelled',          label: 'Cancelled' },
                  ].map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Completion percentage override */}
            <div className="form-group">
              <label>Completion % (manual override, leave blank to auto-calculate)</label>
              <input
                type="number" min="0" max="100"
                value={editForm.completion_pct ?? ''}
                onChange={e => setEditForm(f => ({ ...f, completion_pct: e.target.value === '' ? null : Number(e.target.value) }))}
                placeholder="e.g. 75"
              />
            </div>
            {/* Pending From Customer/Vendor — required when requires_reason status */}
            {(editForm.status === 'waiting_customer' || editForm.status === 'waiting_vendor') && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⏳ {editForm.status === 'waiting_vendor' ? 'Pending From Vendor' : 'Pending From Customer'} <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  value={editForm.pending_from_customer || ''}
                  onChange={setE('pending_from_customer')}
                  placeholder={editForm.status === 'waiting_vendor' ? 'Describe what is needed from the vendor…' : 'Describe what is needed from the customer…'}
                  rows={3}
  required
                  style={{ borderColor: '#f97316' }}
                />
              </div>
            )}
            <div className="form-group"><label>Deadline</label><input type="date" value={editForm.deadline || ''} onChange={setE('deadline')} /></div>
            <div className="form-group">
              <label>Health Override (RAG)</label>
              <select value={editForm.rag_override || ''} onChange={setE('rag_override')}>
                <option value="">Auto (calculated)</option>
                <option value="green">🟢 Green — On track</option>
                <option value="amber">🟡 Amber — At risk</option>
                <option value="red">🔴 Red — Critical</option>
              </select>
            </div>
            <div className="form-group">
              <label>Customer</label>
              <select value={editForm.customer_id || ''} onChange={setE('customer_id')}>
                <option value="">— No customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isManager={isManager}
          isPlanner={isPlanner}
          allUsers={allUsers}
          projectTasks={tasks}
          onUpdate={(tid, data) => { updateTask(tid, data); setSelectedTask(null); }}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {showRejectDialog && (
        <RejectDialog
          onConfirm={rejectClosure}
          onCancel={() => setShowRejectDialog(false)}
        />
      )}

      {showImportExcel && (
        <ImportExcelModal
          projectId={id}
          onClose={() => setShowImportExcel(false)}
          onImported={() => { api.tasks({ project_id: id }).then(setTasks); }}
        />
      )}

      {showAddTask && (
        <Modal title="Add Task" onClose={() => { setShowAddTask(false); setAddTaskErr(''); }}>
          <form onSubmit={addTask}>
            <div className="form-group"><label>Title *</label><input value={taskForm.title} onChange={setT('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={taskForm.description} onChange={setT('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={taskForm.priority} onChange={setT('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Deadline</label><input type="date" value={taskForm.deadline} onChange={setT('deadline')} /></div>
            </div>
            {isManager && <div className="form-group"><label>Assign To</label>
              <select value={taskForm.assigned_to} onChange={setT('assigned_to')}>
                <option value="">Unassigned</option>
                {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={taskForm.is_adhoc} onChange={e => setTaskForm(f => ({ ...f, is_adhoc: e.target.checked }))} style={{ width: 'auto' }} />
                Mark as Ad-hoc Task
              </label>
            </div>
            {addTaskErr && <div className="error-msg" style={{ marginBottom: 8 }}>{addTaskErr}</div>}
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAddTask(false); setAddTaskErr(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Task</button>
            </div>
          </form>
        </Modal>
      )}
      </div>{/* end .print-body-hide */}
    </div>
  );
}
