import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Building2, X, Bell, Pin } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch, ResultContext } from '../components/ListWorkspace';
import { DataTable, MetricStrip, Pagination, Surface } from '../components/EnterpriseUI';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { customerIdFromCreateIntent,useCreateIntent } from '../hooks/useCreateIntent';
import WaitingReasonDialog from '../components/WaitingReasonDialog';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, RagBadge, fmtDate, isOverdue, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useStatuses } from '../hooks/useStatuses';
import { useToast } from '../components/Toast';

/* ── Inline status dropdown ────────────────────────────────────── *
 * Built on Radix's unstyled DropdownMenu primitive instead of a hand-
 * rolled click-outside/scroll/position implementation. The trigger is a
 * real, keyboard-operable <button> with correct aria-haspopup/expanded;
 * the menu gets arrow-key navigation, Escape-to-close and click-outside
 * for free, and positions itself (no more manual getBoundingClientRect).
 * Visual classes (inline-dropdown*) are unchanged from the previous
 * implementation, so no CSS moved. */
function InlineStatusSelect({ project, onUpdate }) {
  const statusCtx = useStatuses();
  const statuses = (statusCtx?.config?.project || []).filter(s => s.value !== 'pending_approval');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="inline-dropdown-trigger" title="Click to change status">
          <StatusBadge entityType="project" s={project.status} />
          <span className="u-13f6d14">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="inline-dropdown" style={{ minWidth: 220 }} align="start" sideOffset={4}>
          {statuses.map(s => (
            <DropdownMenu.Item key={s.value} className={`inline-dropdown-item${s.value === project.status ? ' active' : ''}`}
              onSelect={() => onUpdate(project, s.value)}>
              <StatusBadge entityType="project" s={s.value} />
              {s.value === project.status && <span className="inline-dropdown-check">✓</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Inline priority dropdown ──────────────────────────────────── */
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low',    bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
  { value: 'medium', label: 'Medium', bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  { value: 'high',   label: 'High',   bg: '#fee2e2', text: '#991b1b', dot: '#f87171' },
];

function InlinePrioritySelect({ project, onUpdate }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="inline-dropdown-trigger" title="Click to change priority">
          <PriorityBadge p={project.priority} />
          <span className="u-13f6d14">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="inline-dropdown" style={{ minWidth: 150 }} align="start" sideOffset={4}>
          {PRIORITY_OPTIONS.map(p => (
            <DropdownMenu.Item key={p.value} className={`inline-dropdown-item${p.value === project.priority ? ' active' : ''}`}
              onSelect={() => onUpdate(project, p.value)}>
              <span className="u-7dc1f6e" style={{ background: p.bg, color: p.text }}>
                <span className="u-19c4840" style={{ background: p.dot }} />
                {p.label}
              </span>
              {p.value === project.priority && <span className="inline-dropdown-check">✓</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Customer selector with "create new" ──────────────────────── */
function CustomerPicker({ customers, value, onChange, onCustomerCreated }) {
  const toast = useToast();
  const [creating,  setCreating]  = useState(false);
  const [newName,   setNewName]   = useState('');
  const [saving,    setSaving]    = useState(false);

  async function createAndSelect() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await api.createCustomer({ name: newName.trim() });
      await onCustomerCreated();
      onChange(res.id);
      setCreating(false);
      setNewName('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!creating ? (
        <div className="flex-center gap-8">
          <select value={value || ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} className="flex-1">
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm u-86abdab" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
      ) : (
        <div className="flex-center gap-8">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Customer name…"
            className="flex-1"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createAndSelect(); } if (e.key === 'Escape') setCreating(false); }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={createAndSelect} disabled={saving || !newName.trim()}>
            {saving ? '…' : 'Create'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm inline-flex items-center" onClick={() => { setCreating(false); setNewName(''); }}><X size={13} /></button>
        </div>
      )}
    </div>
  );
}

/* ── Project Form ─────────────────────────────────────────────── */
function ProjectForm({ initial, users, customers, onSave, onClose, onCustomerCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ title: '', description: '', priority: 'medium', deadline: '', customer_id: null,...(initial || {}),member_ids:initial?.member_ids || [] }));
  const [saving,      setSaving]      = useState(false);
  const [memberError, setMemberError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggleMember = id => setForm(f => ({
    ...f,
    member_ids: f.member_ids.includes(id) ? f.member_ids.filter(x => x !== id) : [...f.member_ids, id],
  }));

  async function submit(e) {
    e.preventDefault();
    if (form.member_ids.length === 0) { setMemberError('Assign at least one engineer before saving.'); return; }
    setMemberError(''); setSaving(true);
    try { await onSave(form); onClose(); }
    catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  const engineers = users.filter(u => u.role === 'engineer');

  return (
    <form onSubmit={submit}>
      <div className="form-group"><label>Title *</label><input value={form.title} onChange={set('title')} required /></div>
      <div className="form-group"><label>Description</label><textarea value={form.description || ''} onChange={set('description')} /></div>
      <div className="form-row">
        <div className="form-group">
          <label>Priority</label>
          <select value={form.priority} onChange={set('priority')}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </div>
        <div className="form-group"><label>Deadline</label><input type="date" value={form.deadline || ''} onChange={set('deadline')} /></div>
      </div>
      <div className="form-group">
        <label>Customer</label>
        <CustomerPicker
          customers={customers}
          value={form.customer_id}
          onChange={id => setForm(f => ({ ...f, customer_id: id }))}
          onCustomerCreated={onCustomerCreated}
        />
      </div>
      <div className="form-group">
        <label>Assign Engineers <span className="u-497726e">*</span></label>
        {engineers.length === 0
          ? <p className="text-sm text-muted u-96ad609">No engineers registered yet.</p>
          : <div className="flex flex-wrap gap-6 mt-4">
              {engineers.map(u => (
                <label key={u.id} className="u-5a4e487" style={{ background: form.member_ids.includes(u.id) ? '#dbeafe' : 'var(--gray-100)', border: form.member_ids.includes(u.id) ? '1px solid #93c5fd' : '1px solid transparent' }}>
                  <input type="checkbox" checked={form.member_ids.includes(u.id)} onChange={() => { toggleMember(u.id); setMemberError(''); }} className="u-30e741d" />
                  {u.name}
                </label>
              ))}
            </div>
        }
        {memberError && <p className="text-danger text-sm mt-4">{memberError}</p>}
      </div>
      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function Projects() {
  const { user } = useAuth();
  const toast    = useToast();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const canManage  = isManager || isPlanner;
  const location  = useLocation();
  const [projects,   setProjects]   = useState([]);
  const [users,      setUsers]      = useState([]);
  const [customers,  setCustomers]  = useState([]);
  const [filter,     setFilter]     = useSavedFilter('projects', 'open');
  const [search,     setSearch]     = useState('');
  const [ragFilter,  setRagFilter]  = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createInitial,setCreateInitial]=useState(null);
  const [loading,    setLoading]    = useState(true);
  const [waitingDialog, setWaitingDialog] = useState(null);
  const [page,setPage]=useState(1);
  const [total,setTotal]=useState(0);
  const [counts,setCounts]=useState({});

  const loadCustomers = () => api.customers().then(setCustomers);
  const [loadError, setLoadError] = useState('');
  useCreateIntent({ allowed: isManager, ready: !loading && !loadError, onCreate: params => { const customerId=customerIdFromCreateIntent(params);setCreateInitial(customerId?{ customer_id:customerId }:null);setShowCreate(true); } });

  const { begin, isCurrent } = useLatestRequest(user.role);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return Promise.resolve();
    setLoading(true); setLoadError('');
    const options = { signal: request.signal };
    return api.pagedProjects({ page,page_size:25,search,status:activeFilter,rag:ragFilter },options).then(result => {
      if (!isCurrent(request)) return;
      setProjects(result.rows || []);setTotal(result.total || 0);setCounts(result.counts || {});
    }).catch(error => {
      if (isCurrent(request)) setLoadError(error.message || 'Could not load this page');
    }).finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [page,search,filter,ragFilter,begin,isCurrent]);

  useEffect(() => {
    if (!canManage) return;
    const controller=new AbortController(),options={ signal:controller.signal };
    Promise.all([api.users(options),api.customers(options)]).then(([u,c]) => { setUsers(u);setCustomers(c); }).catch(() => {});
    return () => controller.abort();
  },[canManage]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) setFilter(urlFilter);
  }, [location.search, setFilter]);

  useEffect(() => {
    const timer=setTimeout(load,250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => setPage(1),[search,filter,ragFilter]);

  /* ── Inline update handlers ─────────────────────────────────── */
  function handleStatusUpdate(project, newStatus) {
    if (newStatus === 'waiting_customer' || newStatus === 'waiting_vendor') {
      setWaitingDialog({ project, newStatus, current: project.pending_from_customer || '' });
    } else {
      api.updateProject(project.id, { status: newStatus })
        .then(() => { toast.success('Status updated'); load(); })
        .catch(e => toast.error(e.message));
    }
  }

  function handlePriorityUpdate(project, newPriority) {
    api.updateProject(project.id, { priority: newPriority })
      .then(() => { toast.success('Priority updated'); load(); })
      .catch(e => toast.error(e.message));
  }

  function handlePin(project, e) {
    e.preventDefault(); e.stopPropagation();
    const action = project.is_pinned ? api.unpinProject(project.id) : api.pinProject(project.id);
    action
      .then(() => { toast.success(project.is_pinned ? 'Project unpinned' : 'Project pinned to dashboard'); load(); })
      .catch(err => toast.error(err.message));
  }

  const TERMINAL = ['closed', 'cancelled'];
  const VALID_FILTERS = ['open','all','in_progress','not_started','on_hold','waiting_customer','waiting_vendor','delayed','pending_approval','overdue','closed','cancelled','reopened'];
  // Treat unknown saved filter values as 'open' so stale localStorage doesn't blank the list
  const activeFilter = VALID_FILTERS.includes(filter) ? filter : 'open';
  const filtered = projects;
  const columns = [
    { key:'title',label:'Title',render:p => <div className="flex-center gap-6">
      {isManager && <button onClick={event => handlePin(p,event)} title={p.is_pinned?'Unpin project':'Pin to dashboard'}
        className={`project-pin${p.is_pinned?' is-pinned':''}`} aria-pressed={!!p.is_pinned}><Pin size={13} /></button>}
      <Link to={`/projects/${p.id}`} className="font-semibold">{p.title}</Link>
    </div> },
    { key:'customer',label:'Customer',render:p => p.customer_name
      ? <span className="project-customer"><Building2 size={12} /> {p.customer_name}</span>
      : <span className="text-muted">—</span> },
    { key:'status',label:'Status',render:p => canManage && p.status==='pending_approval'
      ? <Link to="/approvals">Review closure</Link>
      : canManage ? <InlineStatusSelect project={p} onUpdate={handleStatusUpdate} /> : <StatusBadge entityType="project" s={p.status} /> },
    { key:'priority',label:'Priority',render:p => canManage
      ? <InlinePrioritySelect project={p} onUpdate={handlePriorityUpdate} /> : <PriorityBadge p={p.priority} /> },
    { key:'health',label:'Health',render:p => <RagBadge rag={p.rag_status} /> },
    { key:'tasks',label:'Tasks',render:p => p.task_count>0 ? <div className="project-progress">
      <div><strong>{p.completion_pct}%</strong><span>{p.done_count}/{p.task_count}</span></div>
      <div className="progress-bar"><div className="progress-bar-fill" style={{ width:`${p.completion_pct}%` }} /></div>
    </div> : <span className="text-muted text-sm">No tasks</span> },
    { key:'deadline',label:'Deadline',className:p => isOverdue(p.deadline) && !TERMINAL.includes(p.status)?'overdue':'',render:p => fmtDate(p.deadline) },
    { key:'owner',label:'Created By',render:p => p.created_by_name },
    ...(isManager ? [{ key:'action',label:'Action',render:p => p.status==='pending_approval'
      ? <Link to={`/projects/${p.id}`} className="btn btn-sm btn-warning project-review"><Bell size={11} /> Review</Link> : '—' }] : []),
  ];

  return (
    <div className="page">
      <PageHeader eyebrow="Operations" title="Projects" description="Customer delivery, project ownership and upcoming commitments." actions={<>
{isManager && <button className="btn btn-primary" onClick={() => { setCreateInitial(null);setShowCreate(true); }} disabled={loading || !!loadError}>+ New Project</button>}
      </>} />

      <MetricStrip items={[
        { key:'open',label:'Open projects',value:counts.open || 0,note:'Active delivery portfolio',tone:'info' },
        { key:'overdue',label:'Overdue',value:counts.overdue || 0,note:'Past deadline and still open',tone:(counts.overdue || 0)>0?'danger':'success' },
        { key:'approval',label:'Pending closure',value:counts.pending_approval || 0,note:'Awaiting management review',tone:(counts.pending_approval || 0)>0?'warning':'success' },
        { key:'risk',label:'Red health',value:counts.rag_red || 0,note:'Within the selected status scope',tone:(counts.rag_red || 0)>0?'danger':'success' },
      ]} />

      <Surface title="Portfolio filters" description="Search the permitted portfolio and narrow it by delivery state or health.">
        <ListSearch value={search} onChange={setSearch} label="Search projects" placeholder="Search projects, customers, or owners…" />
        <FilterGroup label="Status">
          {[
            ['open',              'Open'],
            ['all',               'All'],
            ['overdue',           'Overdue'],
            ['in_progress',       'In Progress'],
            ['not_started',       'Not Started'],
            ['on_hold',           'On Hold'],
            ['waiting_customer',  'Waiting for Customer'],
            ['waiting_vendor',    'Waiting for Vendor'],
            ['delayed',           'Delayed'],
            ['pending_approval',  'Pending Closure'],
            ['reopened',          'Reopened'],
            ['closed',            'Closed'],
            ['cancelled',         'Cancelled'],
          ].map(([s, l]) => (
            <button key={s} className={'filter-pill' + (activeFilter === s ? ' active' : '')} onClick={() => setFilter(s)}>
              {l} <span className="u-a697a8f">({
                counts[s] || 0
              })</span>
            </button>
          ))}
        </FilterGroup>
        {/* RAG health filter */}
        <FilterGroup label="Health">
          {[
            { key: 'all', label: 'All' }, { key: 'red', label: 'Red' },
            { key: 'amber', label: 'Amber' }, { key: 'green', label: 'Green' },
          ].map(({ key, label }) => {
            const count = counts[`rag_${key}`] || 0;
            const isActive = ragFilter === key;
            return (
              <button key={key} onClick={() => setRagFilter(key)}
                className={`health-filter health-${key}${isActive ? ' active' : ''}`}>
                {key !== 'all' && <i aria-hidden="true" />}
                {label} <span className="u-383082b">({count})</span>
              </button>
            );
          })}
        </FilterGroup>
      </Surface>

      {!loading && !loadError && <ResultContext shown={filtered.length} total={total} noun="projects"
        activeFilters={(search.trim() ? 1 : 0) + (activeFilter !== 'all' ? 1 : 0) + (ragFilter !== 'all' ? 1 : 0)}
        onClear={() => { setSearch(''); setFilter('all'); setRagFilter('all'); }} />}

      <DataTable columns={columns} rows={filtered} loading={loading} error={loadError} onRetry={load}
        caption="Projects in the selected portfolio view"
        empty={search.trim()?`No projects matching "${search}"`:'No projects found'}
        emptyAction={(search.trim() || activeFilter!=='all' || ragFilter!=='all')
          ? <button className="btn btn-ghost btn-sm" onClick={() => { setSearch('');setFilter('all');setRagFilter('all'); }}>Reset filters</button>
          : isManager ? <button className="btn btn-primary btn-sm" onClick={() => { setCreateInitial(null);setShowCreate(true); }}>Create the first project</button> : null} />
      <Pagination page={page} total={total} pageSize={25} loading={loading} onPageChange={setPage} label="Project pages" />

      {/* Waiting dialog for inline status change */}
      {waitingDialog && (
        <WaitingReasonDialog
          title={waitingDialog.newStatus === 'waiting_vendor' ? 'Waiting for Vendor' : 'Waiting for Customer'}
          initial={waitingDialog.current}
          onConfirm={async reason => {
            await api.updateProject(waitingDialog.project.id, {
              status: waitingDialog.newStatus,
              pending_from_customer: reason,
            });
            toast.success('Project status updated');
            load();
          }}
          onCancel={() => setWaitingDialog(null)}
        />
      )}

      {showCreate && (
        <Modal title="New Project" onClose={() => { setShowCreate(false);setCreateInitial(null); }}>
          <ProjectForm
            initial={createInitial}
            users={users}
            customers={customers}
            onSave={async form => { await api.createProject(form); toast.success('Project created'); await load(); }}
            onClose={() => { setShowCreate(false);setCreateInitial(null); }}
            onCustomerCreated={loadCustomers}
          />
        </Modal>
      )}
    </div>
  );
}
