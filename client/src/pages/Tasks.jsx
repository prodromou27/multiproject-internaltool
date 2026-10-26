import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftBanner, useFormDraft } from '../hooks/useFormDraft';
import CustomerSearchSelect from '../components/CustomerSearchSelect';
import { Check, CheckSquare, ChevronDown, Download, Trash2, UserCheck, Clock, X, Pencil, LockKeyhole, Columns3, ArrowUpDown, RefreshCw, Repeat } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HeaderMenu, PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch } from '../components/ListWorkspace';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { customerIdFromCreateIntent,useCreateIntent } from '../hooks/useCreateIntent';
import WaitingReasonDialog from '../components/WaitingReasonDialog';
import CustomerRecurringTasks from '../components/CustomerRecurringTasks';
import { DraftChecklist, LastUpdate, SubtaskProgress, SubtasksDialog, TaskTicket } from '../components/TaskSubtasks';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue, Modal, sentenceCase } from '../components/Shared';
import { businessToday } from '../utils/dates';
import { TASK_FILTERS } from '../utils/taskFilters';
import { usePref } from '../utils/prefs';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Pagination,Surface } from '../components/EnterpriseUI';
import LogHours from '../components/LogHours';
import { pageZoom } from '../utils/zoom';
import EditTaskModal, { STATUS_LABELS, MANAGER_STATUSES, ENGINEER_STATUSES } from '../components/EditTaskModal';
import { OtherEngineers, TaskPeople } from '../components/TaskPeople';
import { useLiveRefresh } from '../live';

const FINISHED = ['completed', 'closed', 'cancelled', 'pending_approval'];

/* A task's status in the list: the badge opens a short menu to change it, and
   the tick beside it marks the task done in one click. */
function TaskStatusControl({ task, statuses, onChange }) {
  const menu = useRef(null);
  const pick = (event, status) => { menu.current.open = false; if (status !== task.status) onChange(task, status); };
  // The table scrolls inside its box, so the menu is placed on the screen (not inside the box)
  // and closes on a click elsewhere or when the page scrolls.
  const place = () => {
    const details = menu.current; if (!details?.open) return;
    const at = details.querySelector('summary').getBoundingClientRect(), list = details.querySelector('.task-status-options');
    // Screen pixels (the button, the window) and the page's zoomed pixels (the list) differ by the display size.
    const z = pageZoom(), height = list.offsetHeight * z, width = list.offsetWidth * z;
    const below = window.innerHeight - at.bottom > height + 12;
    Object.assign(list.style, { position: 'fixed', left: `${Math.min(at.left, window.innerWidth - width - 8) / z}px`, top: `${(below ? at.bottom + 4 : at.top - height - 4) / z}px` });
  };
  useEffect(() => {
    const close = event => { if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false; };
    const closeOnScroll = () => { if (menu.current?.open) menu.current.open = false; };
    document.addEventListener('pointerdown', close); window.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('scroll', closeOnScroll, true); };
  }, []);
  return <div className="task-status">
    <details className="task-status-menu" ref={menu} onToggle={place}>
      <summary aria-label={`Status of ${task.title}: ${STATUS_LABELS[task.status] || task.status}. Change status`}><StatusBadge entityType="task" s={task.status} /><ChevronDown size={12} aria-hidden="true" /></summary>
      <div className="task-status-options" role="menu">
        {statuses.map(status => <button key={status} type="button" role="menuitemradio" aria-checked={status === task.status} onClick={event => pick(event, status)}>{sentenceCase(STATUS_LABELS[status])}</button>)}
      </div>
    </details>
    {!FINISHED.includes(task.status) && statuses.includes('completed') && <button type="button" className="task-done" aria-label={`Mark ${task.title} as done`} title="Mark as done" onClick={() => onChange(task, 'completed')}><Check size={14} aria-hidden="true" /></button>}
  </div>;
}
const TASK_COLUMNS = [
  ['project', 'Project or customer'], ['status', 'Status'], ['priority', 'Priority'],
  ['assignee', 'Assigned to'], ['deadline', 'Deadline'],
];

/* ── Edit Task Modal ──────────────────────────────────────── */
const ALL_TASK_COLUMNS = TASK_COLUMNS.map(([id]) => id);
// Stored task preferences are checked before use (an old browser or another version).
const isPresetList = value => Array.isArray(value) && value.length <= 20 && value.every(p => p && typeof p.name === 'string' && (p.filter === undefined || TASK_FILTERS.includes(p.filter)));
const isColumnList = value => Array.isArray(value) && value.every(id => ALL_TASK_COLUMNS.includes(id));

export default function Tasks() {
  const { user } = useAuth();
  const location  = useLocation();
  const navigate  = useNavigate();
  // Opened from a customer (Customer 360): only that customer's tasks.
  const urlCustomer = new URLSearchParams(location.search).get('create') ? null : new URLSearchParams(location.search).get('customer_id');
  const customerFilter = urlCustomer && /^[1-9]\d*$/.test(urlCustomer) ? urlCustomer : '';
  const toast     = useToast();
  const confirm   = useConfirm();
  const isManager = user.role === 'manager';
  const [showRepeating, setShowRepeating] = useState(false);
  const [tasks, setTasks]       = useState([]);
  const [projects, setProjects] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [filter, setFilter]     = useSavedFilter('tasks', 'open', { param: 'filter', allowed: TASK_FILTERS });
  const [priorityFilter, setPriorityFilter] = useState('all');

  const [search, setSearch]     = useState('');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  // Saved filters and columns follow the person between browsers (utils/prefs.js).
  const [presets, setPresets] = usePref('tasks.presets', isPresetList, []);
  const [columnList, setColumnList] = usePref('tasks.columns', isColumnList, ALL_TASK_COLUMNS);
  const visibleColumns = new Set(columnList);
  const [sort, setSort] = useState({ key: 'deadline', direction: 'asc' });
  const [showCreate, setShowCreate] = useState(false);
  const [createTeams, setCreateTeams] = useState([]);
  useEffect(() => {
    if (!showCreate) return;
    (isManager ? api.teams() : api.teamsMine().then(result => result.teams || [])).then(setCreateTeams).catch(() => setCreateTeams([]));
  }, [showCreate, isManager]);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', project_id: '', customer_id: '', is_adhoc: false });
  const [loading, setLoading]   = useState(true);
  const [editTask, setEditTask] = useState(null);
  const [subtasksFor, setSubtasksFor] = useState(null);
  const [createErr, setCreateErr] = useState('');
  const [bulkErr,   setBulkErr]   = useState('');

  /* ── Bulk selection ───────────────────────────────────── */
  const [selected, setSelected]   = useState(new Set());
  const [bulkBusy, setBulkBusy]   = useState(false);

  const [loadError, setLoadError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [loadedQuery, setLoadedQuery] = useState(null);
  const pageSize = 25;
  const today = businessToday();
  const activeFilter = TASK_FILTERS.includes(filter) ? filter : 'open';
  // More filters, kept in the address so a filtered view can be shared or bookmarked.
  const more = new URLSearchParams(location.search);
  const moreFilters = { engineer: more.get('engineer') || '', team: more.get('team') || '', project: more.get('project') || '', status: more.get('status') || '', due_from: more.get('due_from') || '', due_to: more.get('due_to') || '' };
  const setMore = (key, value) => {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    navigate({ search: next.toString() ? `?${next}` : '' }, { replace: true });
  };
  const clearMore = () => {
    const next = new URLSearchParams(location.search);
    for (const key of Object.keys(moreFilters)) next.delete(key);
    navigate({ search: next.toString() ? `?${next}` : '' }, { replace: true });
  };
  const moreCount = Object.values(moreFilters).filter(Boolean).length;
  const [loggingFor, setLoggingFor] = useState(null);
  const [filterTeams, setFilterTeams] = useState([]);
  useEffect(() => { (isManager ? api.teams() : api.teamsMine().then(result => result.teams || [])).then(rows => setFilterTeams(Array.isArray(rows) ? rows : [])).catch(() => setFilterTeams([])); }, [isManager]);
  const baseParams = new URLSearchParams({ filter: activeFilter, priority: priorityFilter, as_of: today, sort: sort.key, direction: sort.direction });
  if (debouncedSearch) baseParams.set('search', debouncedSearch);
  if (myTasksOnly) baseParams.set('assigned_to', String(user.id));
  if (moreFilters.engineer && /^[1-9]\d*$/.test(moreFilters.engineer)) baseParams.set('assigned_to', moreFilters.engineer);
  if (/^[1-9]\d*$/.test(moreFilters.team)) baseParams.set('team_id', moreFilters.team);
  if (/^[1-9]\d*$/.test(moreFilters.project)) baseParams.set('project_id', moreFilters.project);
  if (MANAGER_STATUSES.includes(moreFilters.status)) baseParams.set('status', moreFilters.status);
  if (/^\d{4}-\d{2}-\d{2}$/.test(moreFilters.due_from)) baseParams.set('due_from', moreFilters.due_from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(moreFilters.due_to)) baseParams.set('due_to', moreFilters.due_to);
  if (customerFilter) baseParams.set('customer_id', customerFilter);
  const queryKey = baseParams.toString();
  const page = paging.key === queryKey ? paging.page : 1;
  const query = `${queryKey}&page=${page}&page_size=${pageSize}`;
  const busy = loading || loadedQuery !== query;
  const references = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useCreateIntent({ allowed: ['manager', 'engineer'].includes(user.role), ready: !busy && !loadError, onCreate: params => { const customerId=customerIdFromCreateIntent(params);if(customerId) setForm(current => ({ ...current,customer_id:String(customerId),project_id:'' }));setShowCreate(true); } });

  const { begin, isCurrent } = useLatestRequest(`${user.id}:${user.role}:${query}`);
  const load = useCallback((loadOptions) => {
    const quiet = loadOptions?.quiet === true;
    const request = begin();
    if (request.signal.aborted) return Promise.resolve();
    if (!quiet) { setLoading(true); setSelected(new Set()); }
    setLoadError('');
    const options = { signal: request.signal };
    const referenceKey = `${user.id}:${user.role}`;
    const referenceData = references.current?.key === referenceKey
      ? Promise.resolve(references.current.data)
      : Promise.all([api.projects(options), api.users(options)]);   // engineers pick colleagues to work with on a task
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
  useLiveRefresh(() => load({ quiet: true }));

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
    toast.success(`Saved filter preset “${name}”`);
  }

  function deletePreset(name) {
    setPresets(presets.filter(p => p.name !== name));
  }

  function toggleColumn(id) {
    setColumnList(current => current.includes(id) ? current.filter(column => column !== id) : [...current, id]);
  }

  function changeSort(key) {
    setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

  const taskDraft = useFormDraft({ name: 'task:new', value: form });
  // Who leads a new task: the chosen engineer, or (an engineer adding it) themselves; a team has none.
  const createLead = () => String(form.assigned_to).startsWith('t:') ? 0 : form.assigned_to ? Number(form.assigned_to) : isManager ? 0 : Number(user.id);
  async function createTask(e) {
    e.preventDefault(); setCreateErr('');
    if (!isManager && !form.project_id && !form.customer_id) { setCreateErr('Choose the customer or project this task is for'); return; }
    try {
      // A project's task takes the project's customer; otherwise it belongs to the chosen customer.
      const team = String(form.assigned_to).startsWith('t:') ? Number(form.assigned_to.slice(2)) : null;
      await api.createTask({ ...form, project_id: form.project_id ? Number(form.project_id) : null, customer_id: !form.project_id && form.customer_id ? Number(form.customer_id) : null,
        assigned_to: !team && form.assigned_to ? Number(form.assigned_to) : null, team_id: team, subtasks: form.subtasks || [], ticket_reference: form.ticket_reference?.trim() || null,
        engineer_ids: (form.engineer_ids || []).filter(id => id !== createLead()) });
      setShowCreate(false);
      taskDraft.clear();
      setForm({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', project_id: '', customer_id: '', is_adhoc: false });
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

  async function applyBulkPriority(priority) {
    if (!selected.size || !priority) return;
    setBulkBusy(true); setBulkErr('');
    try {
      await api.bulkUpdateTasks({ ids: [...selected], action: 'priority', priority });
      toast.success(`${selected.size} task(s) updated`);
      load();
    } catch (e) { setBulkErr(e.message || 'Bulk action failed'); }
    finally { setBulkBusy(false); }
  }

  async function applyBulkAssign(value) {
    if (!selected.size || !value) return;
    setBulkBusy(true); setBulkErr('');
    try {
      const body = { ids: [...selected], action: 'assign' };
      if (value.startsWith('t:')) body.team_id = Number(value.slice(2));
      else if (value !== 'unassign') body.assigned_to = Number(value);
      await api.bulkUpdateTasks(body);
      toast.success(`${selected.size} task(s) reassigned`);
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
      <PageHeader title="Tasks" actions={<>
<div className="flex gap-8 flex-wrap">
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); }} disabled={busy || !!loadError}>+ New Task</button>
          <HeaderMenu>
            {isManager && <button type="button" onClick={() => setShowRepeating(true)}><Repeat size={14} aria-hidden="true" /> Repeating tasks</button>}
            <button type="button" onClick={exportTasks} disabled={busy || !!loadError || search.trim() !== debouncedSearch}><Download size={14} aria-hidden="true" /> Export all matching</button>
            <button type="button" disabled={busy} onClick={() => { references.current = null; load(); }}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          </HeaderMenu>
        </div>
      </>} />

      {/* Our own work that repeats (no customer): backup reviews, SSL renewals… */}
      {showRepeating && <Modal title="Repeating tasks" onClose={() => setShowRepeating(false)} wide>
        <p className="text-muted text-sm">Internal work that comes round on a schedule. A customer's repeating tasks are on its Customer 360 → Tasks.</p>
        <CustomerRecurringTasks customerId={null} internal canManage engineers={engineers} />
      </Modal>}

      {/* Filters */}
      <Surface label="Task filters">
        <div className="u-95535a3">
          <ListSearch value={search} onChange={setSearch} label="Search tasks" placeholder="Search tasks, projects, or assignees…" />
          {customerFilter && <span className="filter-pill active">{tasks.find(task => String(task.customer_id) === customerFilter)?.customer_name || 'One customer'} <button type="button" className="btn btn-ghost btn-sm" aria-label="Show tasks for every customer" onClick={() => navigate('/tasks')}><X size={12} /></button></span>}
          <label className={["u-eb3a034", (myTasksOnly ? 'u-dc2e428' : 'u-31d6430'), (myTasksOnly ? 'u-eed0f8f' : 'u-7e3a944')].filter(Boolean).join(' ')}>
            <input type="checkbox" checked={myTasksOnly} onChange={e => setMyTasksOnly(e.target.checked)} className="u-30e741d" />
            My Tasks
          </label>
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="u-aedcdf0"
            title="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="critical">⚡ Critical</option>
            <option value="high">↑ High</option>
            <option value="medium">→ Medium</option>
            <option value="low">↓ Low</option>
          </select>
          {priorityFilter !== 'all' && (
            <button onClick={() => setPriorityFilter('all')} className="u-0c38224" title="Clear priority filter">
              <X size={13} />
            </button>
          )}
          <details className="column-picker task-more-filters" open={moreCount > 0 || undefined}>
            <summary className="btn btn-ghost btn-sm">More filters{moreCount ? ` (${moreCount})` : ''}</summary>
            <div className="column-picker-menu" style={{ minWidth: 260 }}>
              {(isManager || user.role === 'planner') && <label>Engineer<select aria-label="Engineer" value={moreFilters.engineer} onChange={e => setMore('engineer', e.target.value)}><option value="">Anyone</option>{engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
              {filterTeams.length > 0 && <label>Team<select aria-label="Team" value={moreFilters.team} onChange={e => setMore('team', e.target.value)}><option value="">Any team</option>{filterTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
              <label>Project<select aria-label="Project" value={moreFilters.project} onChange={e => setMore('project', e.target.value)}><option value="">Any project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
              <label>Status<select aria-label="Task status" value={moreFilters.status} onChange={e => setMore('status', e.target.value)}><option value="">Any status</option>{MANAGER_STATUSES.map(s => <option key={s} value={s}>{sentenceCase(s.replaceAll('_', ' '))}</option>)}</select></label>
              <label>Due from<input aria-label="Due from" type="date" value={moreFilters.due_from} onChange={e => setMore('due_from', e.target.value)} /></label>
              <label>Due to<input aria-label="Due to" type="date" value={moreFilters.due_to} onChange={e => setMore('due_to', e.target.value)} /></label>
              {moreCount > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={clearMore}>Clear these filters</button>}
            </div>
          </details>
          {/* Which columns the table shows: a view option, beside the filters. */}
          <details className="column-picker">
            <summary className="btn btn-ghost btn-sm"><Columns3 size={13} /> Columns</summary>
            <div className="column-picker-menu">
              {TASK_COLUMNS.map(([id, label]) => <label key={id}><input type="checkbox" checked={visibleColumns.has(id)} onChange={() => toggleColumn(id)} /> {label}</label>)}
            </div>
          </details>
          {/* Saved filters live in one menu rather than a row of their own. */}
          <details className="preset-manage task-presets">
            <summary>Saved filters{presets.length ? ` (${presets.length})` : ''}</summary>
            <div className="preset-menu">
              {presets.map(p => <div key={p.name}><button type="button" className="preset-apply" onClick={event => { event.currentTarget.closest('details').open = false; applyPreset(p); }}>{p.name}</button><button type="button" onClick={() => deletePreset(p.name)} aria-label={`Delete ${p.name}`}>×</button></div>)}
              {!presets.length && <p className="text-muted text-sm">None saved yet.</p>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={savePreset}>Save current filters</button>
            </div>
          </details>
        </div>
        <FilterGroup label="View">
          {/* The everyday views always; the others only when they have tasks (or are chosen). */}
          {[
            ['all', 'All'], ['open', 'Open / In Progress'],
            ['waiting_customer', 'Waiting on Customer/Vendor', true],
            ['due_today', 'Due Today', true], ['due_week', 'Due Next 7 Days'],
            ['pending_approval', 'Pending Approval', true], ['done', 'Completed'],
            ['overdue', 'Overdue'], ['adhoc', 'Ad-hoc', true],
          ].filter(([key, , optional]) => !optional || busy || counts[key] > 0 || activeFilter === key).map(([key, label]) => <button key={key} className={'filter-pill' + (activeFilter === key ? ' active' : '') + (key === 'overdue' && counts[key] > 0 ? ' overdue-pill' : '')} onClick={() => setFilter(key)}>
            {label} <span className="u-a697a8f">({busy ? '...' : counts[key] || 0})</span>
          </button>)}
        </FilterGroup>
      </Surface>

      {/* Bulk action bar */}
      {selected.size > 0 && !busy && !loadError && (
        <>
        <div className="bulk-action-bar">
          <strong>{selected.size} selected</strong>
          <span className="bulk-action-separator">·</span>
          {isManager && (
            <>
              {['open','in_progress','waiting_customer','waiting_vendor','completed','pending_approval','closed','cancelled'].map(s => (
                <button key={s} className="btn btn-sm btn-ghost inline-flex items-center gap-4" disabled={bulkBusy}
                  onClick={() => applyBulk(s)}
                 
                >
                  {(s === 'waiting_customer' || s === 'waiting_vendor') ? <Clock size={12} /> : <UserCheck size={12} />}
                  → {STATUS_LABELS[s]}
                </button>
              ))}
              <span className="bulk-action-separator">·</span>
              <select className="bulk-action-select" disabled={bulkBusy} value="" aria-label="Set priority"
                onChange={e => { const v = e.target.value; e.target.value = ''; applyBulkPriority(v); }}>
                <option value="" disabled>Set priority…</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <select className="bulk-action-select" disabled={bulkBusy} value="" aria-label="Reassign"
                onChange={e => { const v = e.target.value; e.target.value = ''; applyBulkAssign(v); }}>
                <option value="" disabled>Reassign to…</option>
                <option value="unassign">— Unassign —</option>
                <optgroup label="Engineers">
                  {engineers.map(eng => <option key={eng.id} value={String(eng.id)}>{eng.name}</option>)}
                </optgroup>
                {filterTeams.length > 0 && <optgroup label="Teams">
                  {filterTeams.map(team => <option key={team.id} value={`t:${team.id}`}>{team.name}</option>)}
                </optgroup>}
              </select>
              <button className="btn btn-sm btn-danger inline-flex items-center gap-4" disabled={bulkBusy}
                onClick={() => applyBulk('delete')}

              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
          {!isManager && (
            ['open','in_progress','waiting_customer','waiting_vendor','completed'].map(s => (
              <button key={s} className="btn btn-sm btn-ghost inline-flex items-center gap-4" disabled={bulkBusy}
                onClick={() => applyBulk(s)}
               
              >
                {(s === 'waiting_customer' || s === 'waiting_vendor') ? <Clock size={12} /> : null}
                → {STATUS_LABELS[s]}
              </button>
            ))
          )}
          <button className="btn btn-sm btn-ghost u-6d00061"
            onClick={() => { setSelected(new Set()); setBulkErr(''); }}>Deselect all</button>
        </div>
        {bulkErr && <div className="error-msg u-8a77e5a">{bulkErr}</div>}
        </>
      )}

      {loadError && <div className="error-msg mb-16" role="alert">
        {loadError} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {loadError && !loading ? <p role="status">This view is unavailable until it reloads successfully.</p> : busy ? <div className="skeleton-table" aria-label="Loading tasks"><span /><span /><span /><span /><span /></div> : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><CheckSquare size={40} strokeWidth={1.2} /></div>
          <p>{search.trim() ? `No tasks matching "${search}"` : myTasksOnly ? 'No tasks assigned to you in this view' : 'No tasks found'}</p>
          {(search.trim() || myTasksOnly) && (
            <button className="btn btn-ghost btn-sm mt-12" onClick={() => { setSearch(''); setMyTasksOnly(false); setFilter('all'); }}>
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
                <th className="u-82b9d86">
                  <input type="checkbox" aria-label="Select all tasks on this page" checked={allSelected} onChange={toggleAll}
                    className="u-2cfdba3" />
                </th>
                <th><button className="table-sort" onClick={() => changeSort('task')}>Task <ArrowUpDown size={11} /></button></th>
                {visibleColumns.has('project') && <th><button className="table-sort" onClick={() => changeSort('project')}>Project <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('status') && <th><button className="table-sort" onClick={() => changeSort('status')}>Status <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('priority') && <th><button className="table-sort" onClick={() => changeSort('priority')}>Priority <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('assignee') && <th><button className="table-sort" onClick={() => changeSort('assignee')}>Assigned to <ArrowUpDown size={11} /></button></th>}
                {visibleColumns.has('deadline') && <th><button className="table-sort" onClick={() => changeSort('deadline')}>Deadline <ArrowUpDown size={11} /></button></th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(t => (
                <tr key={t.id} style={{ background: selected.has(t.id) ? 'var(--primary-light)' : '' }}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)}
                      className="u-2cfdba3" />
                  </td>
                  <td>
                    <button type="button" className="task-title-open" onClick={() => setSubtasksFor(t)} title="Open the task: status, subtasks and updates">{t.title}</button>
                    {t.ticket_reference && <> <TaskTicket task={t} /></>}
                    {t.subtasks_total > 0 && <> <SubtaskProgress total={t.subtasks_total} done={t.subtasks_done} onClick={() => setSubtasksFor(t)} /></>}
                    {t.last_update && <div><LastUpdate update={t.last_update} /></div>}
                    {t.is_adhoc ? <span className="badge badge-adhoc u-391ef12">adhoc</span> : null}
                    {t.is_blocked ? (
                      <span className="badge badge-blocked u-391ef12" title={`Blocked by ${t.dep_count || 1} unfinished task(s)`}>
                        <LockKeyhole size={10} /> Blocked
                      </span>
                    ) : null}
                  </td>
                  {visibleColumns.has('project') && <td>{t.project_title || projects.find(p => p.id === t.project_id)?.title || (t.customer_name ? <>{t.customer_name} <span className="text-muted text-sm">(customer)</span></> : <span className="text-muted">—</span>)}</td>}
                  {visibleColumns.has('status') && <td>{isManager || t.assigned_to === user.id || t.assigned_to == null
                    ? <TaskStatusControl task={t} statuses={isManager ? managerStatuses : engineerStatuses} onChange={handleStatusChange} />
                    : <StatusBadge entityType="task" s={t.status} />}</td>}
                  {visibleColumns.has('priority') && <td><PriorityBadge p={t.priority} /></td>}
                  {visibleColumns.has('assignee') && <td><TaskPeople task={t} fallback="—" /></td>}
                  {visibleColumns.has('deadline') && <td className={isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status) ? 'overdue' : ''}>{fmtDate(t.deadline)}</td>}

                  <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                    {(isManager || t.assigned_to === user.id || (t.team_id && !t.assigned_to)) && user.role !== 'planner' && (
                      <button className="btn btn-ghost btn-sm" title="Log hours" aria-label={`Log hours on ${t.title}`} onClick={() => setLoggingFor(t)}><Clock size={13} /></button>
                    )}
                    {(isManager || t.assigned_to === user.id) && (
                      <button
                        className="btn btn-ghost btn-sm u-51719e9"
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

      {!loadError && <Pagination page={page} total={total} pageSize={pageSize} loading={busy || bulkBusy}
        onPageChange={nextPage => setPaging({ key:queryKey,page:nextPage })} label="Task pages"
        summary={busy ? 'Loading tasks…' : total ? `${(page-1)*pageSize+1}-${Math.min(page*pageSize,total)} of ${total} matching tasks · Bulk selection applies to this page.` : '0 matching tasks'} />}
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

      {subtasksFor && <SubtasksDialog task={subtasksFor} onClose={() => { setSubtasksFor(null); load(); }} />}

      {loggingFor && <LogHours target={{ task_id: loggingFor.id }} title={loggingFor.title} onClose={() => setLoggingFor(null)} />}
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
        <Modal title="New Task" onClose={() => { setShowCreate(false);setCreateErr(''); }}>
          <form onSubmit={createTask}>
            <DraftBanner draft={taskDraft} onRestore={data => data && setForm(data)} />
            {createErr && <div className="error-msg u-761d3ad">{createErr}</div>}
            <div className="form-group"><label htmlFor="task-title">Title *</label><input id="task-title" value={form.title} onChange={set('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={form.description} onChange={set('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={form.priority} onChange={set('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Deadline</label><input type="date" value={form.deadline} onChange={set('deadline')} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label htmlFor="task-customer">Customer{isManager ? ' (optional)' : ''}</label>
                {/* Searches the customers this person may add tasks for. */}
                <CustomerSearchSelect id="task-customer" value={form.customer_id} emptyLabel={isManager ? 'No customer' : 'Select a customer'}
                  onChange={customerId => setForm(f => ({ ...f, customer_id: customerId ? String(customerId) : '', project_id: f.project_id && projects.find(p => String(p.id) === f.project_id)?.customer_id === Number(customerId) ? f.project_id : '' }))} />
              </div>
              <div className="form-group"><label htmlFor="task-project">Project (optional)</label>
                <select id="task-project" value={form.project_id} onChange={e => { const chosen = projects.find(p => String(p.id) === e.target.value); setForm(f => ({ ...f, project_id: e.target.value, customer_id: chosen?.customer_id ? String(chosen.customer_id) : f.customer_id })); }}>
                  <option value="">No project</option>
                  {projects.filter(project => !form.customer_id || project.customer_id === Number(form.customer_id)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group"><label htmlFor="task-assignee">Who does it</label>
              {/* An engineer or a team ("t:<id>"): a team task is taken by whoever in the team starts or completes it. */}
              <select id="task-assignee" value={form.assigned_to} onChange={set('assigned_to')}>
                <option value="">{isManager ? 'Unassigned' : 'Me'}</option>
                {isManager && <optgroup label="Engineers">{engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>}
                {createTeams.length > 0 && <optgroup label={isManager ? 'Teams' : 'My teams'}>{createTeams.map(t => <option key={t.id} value={`t:${t.id}`}>{t.name} (team)</option>)}</optgroup>}
              </select>
            </div>
            <OtherEngineers id="task-other-engineers" engineers={engineers} leadId={createLead()} value={form.engineer_ids || []} onChange={ids => setForm(current => ({ ...current, engineer_ids: ids }))} />
<div className="form-group"><label htmlFor="task-ticket">Ticket (optional)</label><input id="task-ticket" value={form.ticket_reference || ''} onChange={set('ticket_reference')} maxLength={50} placeholder="e.g. RT#12345" /></div>
            <fieldset className="ct-subtasks"><legend>Subtasks</legend>
              <small className="text-muted">Optional. The task is completed when all its subtasks are done.</small>
              <DraftChecklist value={form.subtasks || []} onChange={list => setForm(current => ({ ...current, subtasks: list }))} customerId={!form.project_id && form.customer_id ? Number(form.customer_id) : null} />
            </fieldset>
            <div className="form-group">
              <label className="u-ea06b0c">
                <input type="checkbox" checked={form.is_adhoc} onChange={e => setForm(f => ({ ...f, is_adhoc: e.target.checked }))} className="u-30e741d" />
                Mark as Ad-hoc Task
              </label>
            </div>
            <div className="modal-footer u-cc45258">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowCreate(false); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
