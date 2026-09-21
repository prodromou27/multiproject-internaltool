import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckSquare, Download, Trash2, UserCheck, Clock, Search, X, Pencil, LockKeyhole, Columns3, ArrowUpDown } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../components/PageLayout';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useCreateIntent } from '../hooks/useCreateIntent';
import WaitingReasonDialog from '../components/WaitingReasonDialog';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue, Modal } from '../components/Shared';
import { localDateISO } from '../utils/dates';
import { TASK_FILTERS } from '../utils/taskFilters';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

const STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', completed: 'Completed',
  cancelled: 'Cancelled', closed: 'Closed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  pending_approval: 'Pending Approval',
};

const MANAGER_STATUSES  = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed', 'pending_approval', 'closed', 'cancelled'];
const ENGINEER_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor', 'completed'];
const TASK_COLUMNS = [
  ['project', 'Project'], ['status', 'Status'], ['priority', 'Priority'],
  ['assignee', 'Assigned To'], ['deadline', 'Deadline'], ['update', 'Update Status'],
];

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

export default function Tasks() {
  const { user } = useAuth();
  const location  = useLocation();
  const toast     = useToast();
  const confirm   = useConfirm();
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
    if (TASK_FILTERS.includes(urlFilter)) setFilter(urlFilter);
  }, [location.search, setFilter]);
  const [search, setSearch]     = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hub_task_filter_presets') || '[]'); } catch { return []; }
  });
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hub_task_columns') || JSON.stringify(TASK_COLUMNS.map(([id]) => id)))); }
    catch { return new Set(TASK_COLUMNS.map(([id]) => id)); }
  });
  const [sort, setSort] = useState({ key: 'deadline', direction: 'asc' });
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

  const [loadError, setLoadError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [loadedQuery, setLoadedQuery] = useState(null);
  const pageSize = 25;
  const today = localDateISO(new Date());
  const activeFilter = TASK_FILTERS.includes(filter) ? filter : 'all';
  const baseParams = new URLSearchParams({ filter: activeFilter, priority: priorityFilter, as_of: today, sort: sort.key, direction: sort.direction });
  if (debouncedSearch) baseParams.set('search', debouncedSearch);
  if (myTasksOnly) baseParams.set('assigned_to', String(user.id));
  const queryKey = baseParams.toString();
  const page = paging.key === queryKey ? paging.page : 1;
  const query = `${queryKey}&page=${page}&page_size=${pageSize}`;
  const busy = loading || loadedQuery !== query;
  const references = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useCreateIntent({ allowed: ['manager', 'engineer'].includes(user.role), ready: !busy && !loadError, onCreate: () => { setShowCreate(true); } });

  const { begin, isCurrent } = useLatestRequest(`${user.id}:${user.role}:${query}`);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return Promise.resolve();
    setLoading(true); setLoadError(''); setSelected(new Set());
    const options = { signal: request.signal };
    const referenceKey = `${user.id}:${user.role}`;
    const referenceData = references.current?.key === referenceKey
      ? Promise.resolve(references.current.data)
      : Promise.all([api.projects(options), isManager ? api.users(options) : Promise.resolve([])]);
    return Promise.all([api.tasks(Object.fromEntries(new URLSearchParams(query)), options), referenceData])
      .then(([result, data]) => {
        if (!isCurrent(request)) return;
        references.current = { key: referenceKey, data };
        setTasks(result.rows); setTotal(result.total); setCounts(result.counts); setLoadedQuery(query);
        setProjects(data[0]); setAllUsers(data[1]);
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > lastPage) setPaging({ key: queryKey, page: lastPage });
      }).catch(error => {
        if (isCurrent(request)) setLoadError(error.message || 'Could not load this page');
      }).finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [query, queryKey, page, isManager, user.id, user.role, begin, isCurrent]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const engineers = allUsers.filter(u => u.role === 'engineer');

  function applyPreset(preset) {
    setFilter(preset.filter || 'all');
    setPriorityFilter(preset.priorityFilter || 'all');
    setMyTasksOnly(!!preset.myTasksOnly);
    setSearch(preset.search || '');
  }

  function savePreset() {
    const name = window.prompt('Preset name')?.trim();
    if (!name) return;
    const next = [...presets.filter(p => p.name.toLowerCase() !== name.toLowerCase()),
      { name, filter, priorityFilter, myTasksOnly, search }];
    setPresets(next);
    localStorage.setItem('hub_task_filter_presets', JSON.stringify(next));
    toast.success(`Saved filter preset “${name}”`);
  }

  function deletePreset(name) {
    const next = presets.filter(p => p.name !== name);
    setPresets(next);
    localStorage.setItem('hub_task_filter_presets', JSON.stringify(next));
  }

  function toggleColumn(id) {
    setVisibleColumns(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem('hub_task_columns', JSON.stringify([...next]));
      return next;
    });
  }

  function changeSort(key) {
    setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

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

  async function handleStatusChange(task, newStatus) {
    if (newStatus === 'waiting_customer' || newStatus === 'waiting_vendor') {
      setWaitingDialog({ id: task.id, newStatus, current: task.pending_from_customer || '' });
    } else {
      try {
        await api.updateTask(task.id, { status: newStatus });
        toast.success('Task status updated');
        load();
      } catch (error) {
        toast.error(error.message || 'Could not update task');
      }
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
      setBulkWaitingDialog({ newStatus: action, ids: [...selected] });
      return;
    }
    if (action === 'delete') {
      const ok = await confirm(`Delete ${selected.size} task(s)? This cannot be undone.`, { title: 'Delete Tasks' });
      if (!ok) return;
    }
    setBulkBusy(true); setBulkErr('');
    try {
      if (action === 'delete') {
        await api.bulkUpdateTasks({ ids: [...selected], action: 'delete' });
        toast.success(`${selected.size} task(s) deleted`);
      } else {
        await api.bulkUpdateTasks({ ids: [...selected], action: 'status', status: action });
        toast.success(`${selected.size} task(s) updated`);
      }
      load();
    } catch (e) { setBulkErr(e.message || 'Bulk action failed'); }
    finally { setBulkBusy(false); }
  }

  async function applyBulkWaiting(reason) {
    setBulkBusy(true);
    try {
      const response = await api.bulkUpdateTasks({ ids: bulkWaitingDialog.ids, action: 'status', status: bulkWaitingDialog.newStatus, pending_from_customer: reason });
      toast.success(`${response.affected} task(s) updated`);
      load();
    } finally { setBulkBusy(false); }
  }

  /* ── Export ───────────────────────────────────────────── */
  async function exportTasks() {
    try {
      const qs = new URLSearchParams({ filter: activeFilter, priority: priorityFilter, as_of: today, sort: sort.key, direction: sort.direction });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (myTasksOnly) qs.set('assigned_to', String(user.id));
      const { token } = await api.downloadToken();
      qs.set('token', token);
      const a = document.createElement('a');
      a.href = '/api/tasks/export?' + qs;
      a.download = 'tasks.xlsx';
      a.click();
    } catch (e) { toast.error('Export failed: ' + e.message); }
  }

  const filtered = tasks;
  const sortedFiltered = tasks;

  const managerStatuses  = MANAGER_STATUSES;
  const engineerStatuses = ENGINEER_STATUSES;
  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  return (
    <div className="page">
      <PageHeader eyebrow="Operations" title="Tasks" description="Prioritize assigned work, track progress and manage deadlines." actions={<>
<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportTasks} disabled={busy || !!loadError || search.trim() !== debouncedSearch} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Download size={13} /> Export all matching
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { references.current = null; load(); }}>Refresh</button>
          <details className="column-picker">
            <summary className="btn btn-ghost btn-sm"><Columns3 size={13} /> Columns</summary>
            <div className="column-picker-menu">
              {TASK_COLUMNS.map(([id, label]) => <label key={id}><input type="checkbox" checked={visibleColumns.has(id)} onChange={() => toggleColumn(id)} /> {label}</label>)}
            </div>
          </details>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} disabled={busy || !!loadError}>+ New Task</button>
        </div>
      </>} />

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filter-presets">
          <select defaultValue="" onChange={e => { const preset = presets.find(p => p.name === e.target.value); if (preset) applyPreset(preset); e.target.value = ''; }}>
            <option value="">Apply saved preset…</option>
            {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={savePreset}>Save current filters</button>
          {presets.length > 0 && (
            <details className="preset-manage">
              <summary>Manage</summary>
              <div className="preset-menu">
                {presets.map(p => <div key={p.name}><span>{p.name}</span><button type="button" onClick={() => deletePreset(p.name)} aria-label={`Delete ${p.name}`}>×</button></div>)}
              </div>
            </details>
          )}
        </div>
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
            ['all', 'All'], ['open', 'Open / In Progress'],
            ['waiting_customer', 'Waiting on Customer/Vendor'],
            ['due_today', 'Due Today'], ['due_week', 'Due Next 7 Days'],
            ['pending_approval', 'Pending Approval'], ['done', 'Completed'],
            ['overdue', 'Overdue'], ['adhoc', 'Ad-hoc'],
          ].map(([key, label]) => <button key={key} className={'filter-pill' + (activeFilter === key ? ' active' : '') + (key === 'overdue' && counts[key] > 0 ? ' overdue-pill' : '')} onClick={() => setFilter(key)}>
            {label} <span style={{ opacity: .65 }}>({busy ? '...' : counts[key] || 0})</span>
          </button>)}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && !busy && !loadError && (
        <>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 16px', background: 'var(--primary-light)', border: '1px solid #bfdbfe',
          borderRadius: 8, marginBottom: 12, fontSize: 13,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--tone-info-text)' }}>{selected.size} selected</span>
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

      {loadError && <div className="error-msg" role="alert" style={{ marginBottom: 16 }}>
        {loadError} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {loadError && !loading ? <p role="status">This view is unavailable until it reloads successfully.</p> : busy ? <div className="skeleton-table" aria-label="Loading tasks"><span /><span /><span /><span /><span /></div> : filtered.length === 0 ? (
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
          <table aria-busy={busy}>
            <caption className="sr-only">Tasks on the current page. Bulk selection applies to this page.</caption>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Select all tasks on this page" checked={allSelected} onChange={toggleAll}
                    style={{ width: 15, height: 15, cursor: 'pointer' }} />
                </th>
                <th><button className="table-sort" onClick={() => changeSort('task')}>Task <ArrowUpDown size={11} /></button></th>
                {visibleColumns.has('project') && <th><button className="table-sort" onClick={() => changeSort('project')}>Project <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('status') && <th><button className="table-sort" onClick={() => changeSort('status')}>Status <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('priority') && <th><button className="table-sort" onClick={() => changeSort('priority')}>Priority <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('assignee') && <th><button className="table-sort" onClick={() => changeSort('assignee')}>Assigned To <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('deadline') && <th><button className="table-sort" onClick={() => changeSort('deadline')}>Deadline <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('update') && <th>Update Status</th>}<th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(t => (
                <tr key={t.id} style={{ background: selected.has(t.id) ? 'var(--primary-light)' : '' }}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }} />
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{t.title}</span>
                    {t.is_adhoc ? <span className="badge badge-adhoc" style={{ marginLeft: 6 }}>adhoc</span> : null}
                    {t.is_blocked ? (
                      <span className="badge badge-blocked" style={{ marginLeft: 6 }} title={`Blocked by ${t.dep_count || 1} unfinished task(s)`}>
                        <LockKeyhole size={10} /> Blocked
                      </span>
                    ) : null}
                  </td>
                  {visibleColumns.has('project') && <td>{t.project_title || projects.find(p => p.id === t.project_id)?.title || <span className="text-muted">—</span>}</td>}
                  {visibleColumns.has('status') && <td><StatusBadge entityType="task" s={t.status} /></td>}
                  {visibleColumns.has('priority') && <td><PriorityBadge p={t.priority} /></td>}
                  {visibleColumns.has('assignee') && <td>{t.assigned_to_name || '—'}</td>}
                  {visibleColumns.has('deadline') && <td className={isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status) ? 'overdue' : ''}>{fmtDate(t.deadline)}</td>}
                  {visibleColumns.has('update') && <td>
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
                  </td>}
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

      {!loadError && <nav aria-label="Task pages" className="flex gap-8" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 16 }}>
        <p role="status">{busy ? 'Loading tasks...' : total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total} matching tasks` : '0 matching tasks'} - Bulk selection applies to this page.</p>
        <div className="flex gap-8">
          <button className="btn btn-ghost btn-sm" disabled={busy || page <= 1 || bulkBusy} onClick={() => setPaging({ key: queryKey, page: page - 1 })}>Previous</button>
          <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button className="btn btn-ghost btn-sm" disabled={busy || page * pageSize >= total || bulkBusy} onClick={() => setPaging({ key: queryKey, page: page + 1 })}>Next</button>
        </div>
      </nav>}
      {/* Waiting for Customer dialog (single task) */}
      {waitingDialog && (
        <WaitingReasonDialog
          title={waitingDialog.newStatus === 'waiting_vendor' ? 'Waiting for Vendor' : 'Waiting for Customer'}
          initial={waitingDialog.current}
          onConfirm={async reason => {
            await api.updateTask(waitingDialog.id, { status: waitingDialog.newStatus, pending_from_customer: reason });
            toast.success('Task status updated');
            load();
          }}
          onCancel={() => setWaitingDialog(null)}
        />
      )}

      {/* Waiting for Customer dialog (bulk) */}
      {bulkWaitingDialog && (
        <WaitingReasonDialog
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
            <div className="form-group"><label>{isManager ? 'Project (optional)' : 'Assigned Project *'}</label>
              <select value={form.project_id} onChange={set('project_id')} required={!isManager}>
                <option value="">{isManager ? 'No project (standalone)' : 'Select an assigned project'}</option>
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
