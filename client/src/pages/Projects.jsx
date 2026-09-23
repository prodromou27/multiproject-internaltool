import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, FolderOpen, X, Bell, Pin } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup, ListSearch, ResultContext } from '../components/ListWorkspace';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { customerIdFromCreateIntent,useCreateIntent } from '../hooks/useCreateIntent';
import WaitingReasonDialog from '../components/WaitingReasonDialog';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, RagBadge, fmtDate, isOverdue, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useStatuses } from '../hooks/useStatuses';
import { useToast } from '../components/Toast';

/* ── Inline status dropdown ────────────────────────────────────── */
function InlineStatusSelect({ project, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const dropdownRef = useRef(null);
  const statusCtx = useStatuses();
  const statuses = (statusCtx?.config?.project || []).filter(s => s.value !== 'pending_approval');

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    function handleScroll(e) {
      // Ignore scroll events that originate inside the dropdown itself
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function handleTrigger(e) {
    e.preventDefault(); e.stopPropagation();
    if (!open) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(o => !o);
  }

  return (
    <div ref={ref} style={{ display: 'inline-block' }}>
      <div onClick={handleTrigger}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
        title="Click to change status"
      >
        <StatusBadge entityType="project" s={project.status} />
        <span style={{ fontSize: 9, color: 'var(--gray-400)', lineHeight: 1, marginTop: 1 }}>▾</span>
      </div>
      {open && (
        <div ref={dropdownRef} className="inline-dropdown" style={{ top: pos.top, left: pos.left, minWidth: 220 }}>
          {statuses.map(s => (
            <div
              key={s.value}
              className={`inline-dropdown-item${s.value === project.status ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); onUpdate(project, s.value); setOpen(false); }}
            >
              <StatusBadge entityType="project" s={s.value} />
              {s.value === project.status && <span className="inline-dropdown-check">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Inline priority dropdown ──────────────────────────────────── */
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low',    bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
  { value: 'medium', label: 'Medium', bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  { value: 'high',   label: 'High',   bg: '#fee2e2', text: '#991b1b', dot: '#f87171' },
];

function InlinePrioritySelect({ project, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target) &&
          dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    function handleScroll(e) {
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function handleTrigger(e) {
    e.preventDefault(); e.stopPropagation();
    if (!open) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(o => !o);
  }

  return (
    <div ref={ref} style={{ display: 'inline-block' }}>
      <div onClick={handleTrigger}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
        title="Click to change priority"
      >
        <PriorityBadge p={project.priority} />
        <span style={{ fontSize: 9, color: 'var(--gray-400)', lineHeight: 1, marginTop: 1 }}>▾</span>
      </div>
      {open && (
        <div ref={dropdownRef} className="inline-dropdown" style={{ top: pos.top, left: pos.left, minWidth: 150 }}>
          {PRIORITY_OPTIONS.map(p => (
            <div
              key={p.value}
              className={`inline-dropdown-item${p.value === project.priority ? ' active' : ''}`}
              onClick={e => { e.stopPropagation(); onUpdate(project, p.value); setOpen(false); }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                background: p.bg, color: p.text,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
                {p.label}
              </span>
              {p.value === project.priority && <span className="inline-dropdown-check">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
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
          <select value={value || ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} style={{ flex: 1 }}>
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setCreating(true)}>
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
            style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createAndSelect(); } if (e.key === 'Escape') setCreating(false); }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={createAndSelect} disabled={saving || !newName.trim()}>
            {saving ? '…' : 'Create'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setNewName(''); }} style={{ display: 'inline-flex', alignItems: 'center' }}><X size={13} /></button>
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
        <label>Assign Engineers <span style={{ color: 'var(--danger)' }}>*</span></label>
        {engineers.length === 0
          ? <p className="text-sm text-muted" style={{ marginTop: 4 }}>No engineers registered yet.</p>
          : <div className="flex flex-wrap gap-6 mt-4">
              {engineers.map(u => (
                <label key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '4px 8px',
                  background: form.member_ids.includes(u.id) ? '#dbeafe' : 'var(--gray-100)', borderRadius: 6, fontSize: 12,
                  border: form.member_ids.includes(u.id) ? '1px solid #93c5fd' : '1px solid transparent', userSelect: 'none',
                }}>
                  <input type="checkbox" checked={form.member_ids.includes(u.id)} onChange={() => { toggleMember(u.id); setMemberError(''); }} style={{ width: 'auto' }} />
                  {u.name}
                </label>
              ))}
            </div>
        }
        {memberError && <p className="text-danger text-sm mt-4">{memberError}</p>}
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
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

  const loadCustomers = () => load();
  const [loadError, setLoadError] = useState('');
  useCreateIntent({ allowed: isManager, ready: !loading && !loadError, onCreate: params => { const customerId=customerIdFromCreateIntent(params);setCreateInitial(customerId?{ customer_id:customerId }:null);setShowCreate(true); } });

  const { begin, isCurrent } = useLatestRequest(user.role);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return Promise.resolve();
    setLoading(true); setLoadError('');
    const options = { signal: request.signal };
    return Promise.all([
      api.projects(options),
      canManage ? api.users(options) : Promise.resolve([]),
      canManage ? api.customers(options) : Promise.resolve([]),
    ]).then(([p, u, c]) => {
      if (!isCurrent(request)) return;
      setProjects(p); setUsers(u); setCustomers(c);
    }).catch(error => {
      if (isCurrent(request)) setLoadError(error.message || 'Could not load this page');
    }).finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [canManage, begin, isCurrent]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) setFilter(urlFilter);
  }, [location.search, setFilter]);

  useEffect(() => { load(); }, [load]);

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
  const openProjects = projects.filter(p => !TERMINAL.includes(p.status));
  // Treat unknown saved filter values as 'open' so stale localStorage doesn't blank the list
  const activeFilter = VALID_FILTERS.includes(filter) ? filter : 'open';
  const overdueProjects = openProjects.filter(p => p.status !== 'pending_approval' && isOverdue(p.deadline));
  const statusFiltered = activeFilter === 'all'  ? projects
                       : activeFilter === 'overdue' ? overdueProjects
                       : activeFilter === 'open' ? openProjects
                       : projects.filter(p => p.status === activeFilter);
  const searchFiltered = search.trim()
    ? statusFiltered.filter(p => {
        const q = search.toLowerCase();
        return (p.title || '').toLowerCase().includes(q) ||
               (p.customer_name || '').toLowerCase().includes(q) ||
               (p.created_by_name || '').toLowerCase().includes(q);
      })
    : statusFiltered;
  const filtered = ragFilter === 'all'
    ? searchFiltered
    : searchFiltered.filter(p => p.rag_status === ragFilter);

  return (
    <div className="page">
      <PageHeader eyebrow="Operations" title="Projects" description="Customer delivery, project ownership and upcoming commitments." actions={<>
{isManager && <button className="btn btn-primary" onClick={() => { setCreateInitial(null);setShowCreate(true); }} disabled={loading || !!loadError}>+ New Project</button>}
      </>} />

      <div className="card mb-16">
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
              {l} <span style={{ opacity: .65 }}>({
                s === 'all'  ? projects.length :
                s === 'open' ? openProjects.length :
                s === 'overdue' ? overdueProjects.length :
                projects.filter(p => p.status === s).length
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
            const count = key === 'all' ? statusFiltered.length : statusFiltered.filter(p => p.rag_status === key).length;
            const isActive = ragFilter === key;
            return (
              <button key={key} onClick={() => setRagFilter(key)}
                className={`health-filter health-${key}${isActive ? ' active' : ''}`}>
                {key !== 'all' && <i aria-hidden="true" />}
                {label} <span style={{ opacity: .7 }}>({count})</span>
              </button>
            );
          })}
        </FilterGroup>
      </div>

      {!loading && !loadError && <ResultContext shown={filtered.length} total={projects.length} noun="projects"
        activeFilters={(search.trim() ? 1 : 0) + (activeFilter !== 'all' ? 1 : 0) + (ragFilter !== 'all' ? 1 : 0)}
        onClear={() => { setSearch(''); setFilter('all'); setRagFilter('all'); }} />}

      {loadError && <div className="error-msg mb-16" role="alert">
        {loadError} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {loadError && !loading ? <p role="status">This view is unavailable until it reloads successfully.</p> : loading ? <p className="text-muted">Loading…</p> : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><FolderOpen size={40} strokeWidth={1.2} /></div>
          <p>{search.trim() ? `No projects matching "${search}"` : 'No projects found'}</p>
          {search.trim() && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setSearch('')}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Health</th>
                <th>Tasks</th>
                <th>Deadline</th>
                <th>Created By</th>
                {isManager && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="flex-center gap-6">
                      {isManager && (
                        <button
                          onClick={e => handlePin(p, e)}
                          title={p.is_pinned ? 'Unpin project' : 'Pin to dashboard'}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 4,
                            color: p.is_pinned ? '#f59e0b' : 'var(--gray-300)',
                            flexShrink: 0, display: 'flex', alignItems: 'center',
                            transition: 'color .15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = p.is_pinned ? '#d97706' : 'var(--gray-500)'}
                          onMouseLeave={e => e.currentTarget.style.color = p.is_pinned ? '#f59e0b' : 'var(--gray-300)'}
                        >
                          {p.is_pinned ? <Pin size={13} /> : <Pin size={13} />}
                        </button>
                      )}
                      <Link to={`/projects/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</Link>
                    </div>
                  </td>
                  <td>
                    {p.customer_name
                      ? <span style={{ fontSize: 12, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 4 }}><Building2 size={12} /> {p.customer_name}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    {canManage && p.status === 'pending_approval'
                      ? <Link to="/approvals">Review closure</Link>
                      : canManage
                      ? <InlineStatusSelect project={p} onUpdate={handleStatusUpdate} />
                      : <StatusBadge entityType="project" s={p.status} />}
                  </td>
                  <td>
                    {canManage
                      ? <InlinePrioritySelect project={p} onUpdate={handlePriorityUpdate} />
                      : <PriorityBadge p={p.priority} />}
                  </td>
                  <td><RagBadge rag={p.rag_status} /></td>
                  <td>
                    {p.task_count > 0 ? (
                      <div className="flex-center gap-6">
                        <div>
                          <div className="flex-center gap-5">
                            <span style={{
                              fontSize: 11, fontWeight: 700,
                              color: p.completion_pct >= 100 ? '#10b981' : p.completion_pct >= 50 ? '#3b82f6' : 'var(--gray-600)',
                            }}>{p.completion_pct}%</span>
                            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{p.done_count}/{p.task_count}</span>
                          </div>
                          <div className="progress-bar" style={{ width: 64, marginTop: 3 }}>
                            <div className="progress-bar-fill" style={{
                              width: `${p.completion_pct}%`,
                              background: p.completion_pct >= 100 ? '#10b981' : p.completion_pct >= 50 ? '#3b82f6' : undefined,
                            }} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>No tasks</span>
                    )}
                  </td>
                  <td className={isOverdue(p.deadline) && !['closed','cancelled'].includes(p.status) ? 'overdue' : ''}>{fmtDate(p.deadline)}</td>
                  <td>{p.created_by_name}</td>
                  {isManager && (
                    <td>
                      {p.status === 'pending_approval' && (
                        <Link to={`/projects/${p.id}`}
                          className="btn btn-sm btn-warning"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                          title="Closure approval required"
                        >
                          <Bell size={11} /> Review
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
