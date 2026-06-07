import React, { useEffect, useState } from 'react';
import { CheckSquare, Download, Trash2, UserCheck, Clock, Search, X, Pencil } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';

const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed',
  cancelled: 'Cancelled', closed: 'Closed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  pending_approval: 'Pending Approval',
};

const MANAGER_STATUSES  = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled'];
const ENGINEER_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];

/* ── Edit Task Modal ──────────────────────────────────────── */
function EditTaskModal({ task, allUsers, isManager, onSave, onClose }) {
  const [form, setForm] = useState({
    title:       task.title || '',
    description: task.description || '',
    priority:    task.priority || 'medium',
    deadline:    task.deadline ? task.deadline.slice(0, 10) : '',
    assigned_to: task.assigned_to || '',
    status:      task.status || 'open',
    pending_from_customer: task.pending_from_customer || '',
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
            <label>Assigned To</label>
            <select value={form.assigned_to} onChange={set('assigned_to')}>
              <option value="">Unassigned</option>
              {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
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
              <span style={{ color: 'var(--danger)' }}>*</span>
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
        <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── "Waiting for Customer" reason dialog ─────────────────── */
function WaitingDialog({ onConfirm, onCancel, initial = '', title = 'Waiting for Customer' }) {
  const [reason, setReason] = useState(initial);
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
        Describe what is needed from the customer before work can continue.
      </p>
      <div className="form-group">
        <label>Pending From Customer <span style={{ color: 'var(--danger)' }}>*</span></label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Awaiting signed approval document, credentials for system access…"
          rows={3}
          autoFocus
        />
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}
        >
          Set Status
        </button>
      </div>
    </Modal>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const location = useLocation();
  const isManager = user.role === 'manager';
  const [tasks, setTasks]       = useState([]);
  const [projects, setProjects] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [filter, setFilter]     = useSavedFilter('tasks', 'all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Apply URL ?filter= on mount (e.g. from dashboard overdue link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) setFilter(urlFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch]     = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', project_id: '', is_adhoc: false });
  const [loading, setLoading]   = useState(true);
  const [editTask, setEditTask] = useState(null);
  const [createErr, setCreateErr] = useState('');
  const [bulkErr,   setBulkErr]   = useState('');

  /* ── Bulk selection ───────────────────────────────────── */
  const [selected, setSelected]   = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkBusy, setBulkBusy]   = useState(false);

  const load = () => Promise.all([
    api.tasks({}),
    api.projects(),
    isManager ? api.users() : Promise.resolve([])
  ]).then(([t, p, u]) => { setTasks(t); setProjects(p); setAllUsers(u); setLoading(false); setSelected(new Set()); });

  useEffect(() => { load(); }, [isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const engineers = allUsers.filter(u => u.role === 'engineer');

  async function createTask(e) {
    e.preventDefault(); setCreateErr('');
    try {
      await api.createTask({ ...form, project_id: form.project_id ? Number(form.project_id) : null, assigned_to: form.assigned_to ? Number(form.assigned_to) : null });
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', project_id: '', is_adhoc: false });
      load();
    } catch (err) { setCreateErr(err.message || 'Failed to create task'); }
  }

  // Pending "waiting_customer" dialog: { id, currentStatus } or { bulk: true, newStatus }
  const [waitingDialog, setWaitingDialog] = useState(null);
  const [bulkWaitingDialog, setBulkWaitingDialog] = useState(null); // { newStatus }

  function handleStatusChange(task, newStatus) {
    if (newStatus === 'waiting_customer' || newStatus === 'waiting_vendor') {
      setWaitingDialog({ id: task.id, newStatus, current: task.pending_from_customer || '' });
    } else {
      api.updateTask(task.id, { status: newStatus }).then(load);
    }
  }

  /* ── Bulk actions ─────────────────────────────────────── */
  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(t => t.id)));
  }

  async function applyBulk(action) {
    if (!selected.size) return;
    // waiting statuses require a reason — show dialog first
    if (action === 'waiting_customer' || action === 'waiting_vendor') {
      setBulkWaitingDialog({ newStatus: action });
      return;
    }
    setBulkBusy(true); setBulkErr('');
    try {
      if (action === 'delete') {
        if (!confirm(`Delete ${selected.size} task(s)?`)) return;
        await api.bulkUpdateTasks({ ids: [...selected], action: 'delete' });
      } else {
        await api.bulkUpdateTasks({ ids: [...selected], action: 'status', status: action });
      }
      load();
    } catch (e) { setBulkErr(e.message || 'Bulk action failed'); }
    finally { setBulkBusy(false); }
  }

  async function applyBulkWaiting(reason) {
    const status = bulkWaitingDialog?.newStatus || 'waiting_customer';
    setBulkWaitingDialog(null); setBulkErr('');
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map(id =>
        api.updateTask(id, { status, pending_from_customer: reason })
      ));
      load();
    } catch (e) { setBulkErr(e.message || 'Bulk action failed'); }
    finally { setBulkBusy(false); }
  }

  /* ── Export ───────────────────────────────────────────── */
  async function exportTasks() {
    try {
      const { token } = await api.downloadToken();
      const qs = filter !== 'all' ? `?filter=${filter}&token=${token}` : `?token=${token}`;
      const a = document.createElement('a');
      a.href = '/api/tasks/export' + qs;
      a.download = 'tasks.xlsx';
      a.click();
    } catch (e) { alert('Export failed: ' + e.message); }
  }

  const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor'];
  const DONE_STATUSES = ['completed', 'closed'];

  const _dueWeekNow = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  const _dueWeekEnd = new Date(_dueWeekNow.getTime() + 7 * 86400000);

  const filtered = tasks.filter(t => {
    // Status tab filter
    if (filter === 'open')             { if (!OPEN_STATUSES.includes(t.status)) return false; }
    else if (filter === 'done')        { if (!DONE_STATUSES.includes(t.status)) return false; }
    else if (filter === 'adhoc')       { if (!t.is_adhoc) return false; }
    else if (filter === 'waiting_customer') { if (t.status !== 'waiting_customer' && t.status !== 'waiting_vendor') return false; }
    else if (filter === 'overdue')     { if (!isOverdue(t.deadline) || ['completed','closed','cancelled'].includes(t.status)) return false; }
    else if (filter === 'due_week')    {
      if (!t.deadline) return false;
      if (['completed','closed','cancelled'].includes(t.status)) return false;
      const dl = new Date(t.deadline + 'T00:00:00');
      if (dl < _dueWeekNow || dl > _dueWeekEnd) return false;
    }
    // Priority filter
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    // My tasks filter
    if (myTasksOnly && t.assigned_to !== user.id) return false;
    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      const projectTitle = projects.find(p => p.id === t.project_id)?.title || '';
      if (!(t.title || '').toLowerCase().includes(q) &&
          !(t.assigned_to_name || '').toLowerCase().includes(q) &&
          !projectTitle.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const managerStatuses  = MANAGER_STATUSES;
  const engineerStatuses = ENGINEER_STATUSES;
  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Tasks</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportTasks} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Download size={13} /> Export
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Task</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks…"
              style={{ paddingLeft: 32, paddingRight: search ? 28 : undefined }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', padding: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: myTasksOnly ? 'var(--primary)' : 'var(--gray-600)', fontWeight: myTasksOnly ? 600 : 400, userSelect: 'none' }}>
            <input type="checkbox" checked={myTasksOnly} onChange={e => setMyTasksOnly(e.target.checked)} style={{ width: 'auto' }} />
            My Tasks
          </label>
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
            title="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="critical">⚡ Critical</option>
            <option value="high">↑ High</option>
            <option value="medium">→ Medium</option>
            <option value="low">↓ Low</option>
          </select>
          {priorityFilter !== 'all' && (
            <button onClick={() => setPriorityFilter('all')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', display:'flex', alignItems:'center', padding:2 }} title="Clear priority filter">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="filter-bar">
          {[
            ['all',             'All',                         tasks.length],
            ['open',            'Open / In Progress',          tasks.filter(t => OPEN_STATUSES.includes(t.status)).length],
            ['waiting_customer','Waiting on Customer/Vendor',  tasks.filter(t => t.status === 'waiting_customer' || t.status === 'waiting_vendor').length],
            ['due_week',        'Due This Week',               tasks.filter(t => { const dl = t.deadline ? new Date(t.deadline+'T00:00:00') : null; return dl && dl >= _dueWeekNow && dl <= _dueWeekEnd && !['completed','closed','cancelled'].includes(t.status); }).length],
            ['done',            'Completed',                   tasks.filter(t => DONE_STATUSES.includes(t.status)).length],
            ['overdue',         'Overdue',                     tasks.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length],
            ['adhoc',           'Ad-hoc',                      tasks.filter(t => t.is_adhoc).length],
          ].map(([k, l, count]) => (
            <button key={k} className={'filter-pill' + (filter === k ? ' active' : '') + (k === 'overdue' && count > 0 ? ' overdue-pill' : '')} onClick={() => setFilter(k)}>
              {l} <span style={{ opacity: .65 }}>({count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 16px', background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 8, marginBottom: 12, fontSize: 13,
        }}>
          <span style={{ fontWeight: 600, color: '#1d4ed8' }}>{selected.size} selected</span>
          <span style={{ color: '#93c5fd' }}>·</span>
          {isManager && (
            <>
              {['open','in_progress','waiting_customer','waiting_vendor','completed','pending_approval','closed','cancelled'].map(s => (
                <button key={s} className="btn btn-sm btn-ghost" disabled={bulkBusy}
                  onClick={() => applyBulk(s)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {(s === 'waiting_customer' || s === 'waiting_vendor') ? <Clock size={12} /> : <UserCheck size={12} />}
                  → {STATUS_LABELS[s]}
                </button>
              ))}
              <button className="btn btn-sm btn-danger" disabled={bulkBusy}
                onClick={() => applyBulk('delete')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
          {!isManager && (
            ['open','in_progress','waiting_customer','waiting_vendor','completed'].map(s => (
              <button key={s} className="btn btn-sm btn-ghost" disabled={bulkBusy}
                onClick={() => applyBulk(s)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {(s === 'waiting_customer' || s === 'waiting_vendor') ? <Clock size={12} /> : null}
                → {STATUS_LABELS[s]}
              </button>
            ))
          )}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}
            onClick={() => { setSelected(new Set()); setBulkErr(''); }}>Deselect all</button>
        </div>
        {bulkErr && <div className="error-msg" style={{ marginTop: 8 }}>{bulkErr}</div>}
        </>
      )}

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><CheckSquare size={40} strokeWidth={1.2} /></div>
          <p>{search.trim() ? `No tasks matching "${search}"` : myTasksOnly ? 'No tasks assigned to you in this view' : 'No tasks found'}</p>
          {(search.trim() || myTasksOnly) && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setSearch(''); setMyTasksOnly(false); setFilter('all'); }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    style={{ width: 15, height: 15, cursor: 'pointer' }} />
                </th>
                <th>Task</th><th>Project</th><th>Status</th><th>Priority</th>
                <th>Assigned To</th><th>Deadline</th><th>Update Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} style={{ background: selected.has(t.id) ? 'var(--primary-light)' : '' }}>
                  <td>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }} />
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{t.title}</span>
                    {t.is_adhoc ? <span className="badge badge-adhoc" style={{ marginLeft: 6 }}>adhoc</span> : null}
                  </td>
                  <td>{projects.find(p => p.id === t.project_id)?.title || <span className="text-muted">—</span>}</td>
                  <td><StatusBadge s={t.status} /></td>
                  <td><PriorityBadge p={t.priority} /></td>
                  <td>{t.assigned_to_name || '—'}</td>
                  <td className={isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status) ? 'overdue' : ''}>{fmtDate(t.deadline)}</td>
                  <td>
                    <select
                      value={t.status}
                      onChange={e => handleStatusChange(t, e.target.value)}
                      style={{ width: 'auto', padding: '3px 6px', fontSize: 12,
                        borderColor: t.status === 'waiting_customer' ? '#f97316' : undefined }}
                      disabled={!isManager && t.assigned_to !== user.id}
                    >
                      {(isManager ? managerStatuses : engineerStatuses).map(s => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    {(t.status === 'waiting_customer' || t.status === 'waiting_vendor') && t.pending_from_customer && (
                      <div style={{ fontSize: 11, color: t.status === 'waiting_vendor' ? '#6b21a8' : '#9a3412', marginTop: 3, maxWidth: 180, lineHeight: 1.3 }}>
                        ⏳ {t.pending_from_customer}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {(isManager || t.assigned_to === user.id) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '4px 6px', color: 'var(--gray-500)' }}
                        title="Edit task"
                        onClick={() => setEditTask(t)}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Waiting for Customer dialog (single task) */}
      {waitingDialog && (
        <WaitingDialog
          title={waitingDialog.newStatus === 'waiting_vendor' ? 'Waiting for Vendor' : 'Waiting for Customer'}
          initial={waitingDialog.current}
          onConfirm={reason => {
            api.updateTask(waitingDialog.id, { status: waitingDialog.newStatus, pending_from_customer: reason }).then(load);
            setWaitingDialog(null);
          }}
          onCancel={() => setWaitingDialog(null)}
        />
      )}

      {/* Waiting for Customer dialog (bulk) */}
      {bulkWaitingDialog && (
        <WaitingDialog
          title={bulkWaitingDialog.newStatus === 'waiting_vendor' ? 'Waiting for Vendor (bulk)' : 'Waiting for Customer (bulk)'}
          onConfirm={applyBulkWaiting}
          onCancel={() => setBulkWaitingDialog(null)}
        />
      )}

      {editTask && (
        <EditTaskModal
          task={editTask}
          allUsers={allUsers}
          isManager={isManager}
          onSave={() => { setEditTask(null); load(); }}
          onClose={() => setEditTask(null)}
        />
      )}

      {showCreate && (
        <Modal title="New Task" onClose={() => { setShowCreate(false); setCreateErr(''); }}>
          <form onSubmit={createTask}>
            {createErr && <div className="error-msg" style={{ marginBottom: 10 }}>{createErr}</div>}
            <div className="form-group"><label>Title *</label><input value={form.title} onChange={set('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={form.description} onChange={set('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={form.priority} onChange={set('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Deadline</label><input type="date" value={form.deadline} onChange={set('deadline')} /></div>
            </div>
            <div className="form-group"><label>Project (optional)</label>
              <select value={form.project_id} onChange={set('project_id')}>
                <option value="">No project (standalone)</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            {isManager && <div className="form-group"><label>Assign To</label>
              <select value={form.assigned_to} onChange={set('assigned_to')}>
                <option value="">Unassigned</option>
                {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={form.is_adhoc} onChange={e => setForm(f => ({ ...f, is_adhoc: e.target.checked }))} style={{ width: 'auto' }} />
                Mark as Ad-hoc Task
              </label>
            </div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
