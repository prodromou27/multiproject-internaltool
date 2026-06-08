import React, { useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, FolderOpen, X, Bell, Pin, Search } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, RagBadge, fmtDate, isOverdue, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useStatuses } from '../hooks/useStatuses';
import { useToast } from '../components/Toast';

/* ── Waiting for Customer/Vendor reason dialog ─────────────────── */
function WaitingDialog({ title = 'Waiting for Customer', initial = '', onConfirm, onCancel }) {
  const [reason, setReason] = useState(initial);
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
        Describe what is needed before work can continue.
      </p>
      <div className="form-group">
        <label>Reason <span style={{ color: 'var(--danger)' }}>*</span></label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Awaiting signed approval document…"
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

/* ── Inline status dropdown ────────────────────────────────────── */
function InlineStatusSelect({ project, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const dropdownRef = useRef(null);
  const statusCtx = useStatuses();
  const statuses = statusCtx?.config?.project || [];

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
        <StatusBadge s={project.status} />
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
              <StatusBadge s={s.value} />
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={value || ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} style={{ flex: 1 }}>
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
  const [form, setForm] = useState(
    initial || { title: '', description: '', priority: 'medium', deadline: '', customer_id: null, member_ids: [] }
  );
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
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
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
  const [loading,    setLoading]    = useState(true);
  const [waitingDialog, setWaitingDialog] = useState(null);

  const loadCustomers = () => api.customers().then(setCustomers);
  const load = () => Promise.all([
    api.projects(),
    canManage ? api.users()      : Promise.resolve([]),
    canManage ? api.customers()  : Promise.resolve([]),
  ]).then(([p, u, c]) => {
    setProjects(p); setUsers(u); setCustomers(c); setLoading(false);
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) setFilter(urlFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [canManage]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const VALID_FILTERS = ['open','all','in_progress','not_started','on_hold','waiting_customer','waiting_vendor','delayed','pending_approval','closed','cancelled','reopened'];
  const openProjects = projects.filter(p => !TERMINAL.includes(p.status));
  // Treat unknown saved filter values as 'open' so stale localStorage doesn't blank the list
  const activeFilter = VALID_FILTERS.includes(filter) ? filter : 'open';
  const statusFiltered = activeFilter === 'all'  ? projects
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
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        {isManager && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', marginBottom: 10, maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            style={{ paddingLeft: 32, paddingRight: search ? 28 : undefined }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="filter-bar">
          {[
            ['open',              'Open'],
            ['all',               'All'],
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
                projects.filter(p => p.status === s).length
              })</span>
            </button>
          ))}
        </div>
        {/* RAG health filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 500, marginRight: 2 }}>Health:</span>
          {[
            { key: 'all',   label: 'All',   dot: null,      activeBg: '#e0e7ff', activeText: '#3730a3' },
            { key: 'red',   label: 'Red',   dot: '#ef4444', activeBg: '#fef2f2', activeText: '#b91c1c' },
            { key: 'amber', label: 'Amber', dot: '#f59e0b', activeBg: '#fffbeb', activeText: '#92400e' },
            { key: 'green', label: 'Green', dot: '#22c55e', activeBg: '#f0fdf4', activeText: '#166534' },
          ].map(({ key, label, dot, activeBg, activeText }) => {
            const count = key === 'all' ? statusFiltered.length : statusFiltered.filter(p => p.rag_status === key).length;
            const isActive = ragFilter === key;
            return (
              <button
                key={key}
                onClick={() => setRagFilter(key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: isActive ? `1.5px solid ${activeText}` : '1.5px solid var(--gray-200)',
                  background: isActive ? activeBg : 'var(--gray-50)',
                  color: isActive ? activeText : 'var(--gray-500)',
                  transition: 'all .15s',
                }}
              >
                {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
                {label} <span style={{ opacity: .7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0 ? (
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    {canManage
                      ? <InlineStatusSelect project={p} onUpdate={handleStatusUpdate} />
                      : <StatusBadge s={p.status} />}
                  </td>
                  <td>
                    {canManage
                      ? <InlinePrioritySelect project={p} onUpdate={handlePriorityUpdate} />
                      : <PriorityBadge p={p.priority} />}
                  </td>
                  <td><RagBadge rag={p.rag_status} /></td>
                  <td>
                    {p.task_count > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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
        <WaitingDialog
          title={waitingDialog.newStatus === 'waiting_vendor' ? 'Waiting for Vendor' : 'Waiting for Customer'}
          initial={waitingDialog.current}
          onConfirm={reason => {
            api.updateProject(waitingDialog.project.id, {
              status: waitingDialog.newStatus,
              pending_from_customer: reason,
            }).then(load).catch(e => toast.error(e.message));
            setWaitingDialog(null);
          }}
          onCancel={() => setWaitingDialog(null)}
        />
      )}

      {showCreate && (
        <Modal title="New Project" onClose={() => setShowCreate(false)}>
          <ProjectForm
            users={users}
            customers={customers}
            onSave={async form => { await api.createProject(form); toast.success('Project created'); await load(); }}
            onClose={() => setShowCreate(false)}
            onCustomerCreated={loadCustomers}
          />
        </Modal>
      )}
    </div>
  );
}
