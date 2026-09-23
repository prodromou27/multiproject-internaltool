import { useEffect, useState } from 'react';
import { Users as UsersIcon, FolderOpen, CheckCircle2, CheckSquare, Wrench, Building2, Loader2, Download, Database } from 'lucide-react';
import { api } from '../../api';
import { fmtDate, StatusBadge, PriorityBadge, isOverdue } from '../../components/Shared';

/* ══════════════════════════════════════════════════════════ */
/* ── PROJECTS ADMIN TAB ──────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function ProjectsAdminTab() {
  const [projects, setProjects] = useState([]);
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { api.projects().then(d => { setProjects(d ?? []); setLoading(false); }); }, []);

  const counts = ['all','in_progress','not_started','on_hold','pending_approval','closed','cancelled'].reduce((acc, k) => {
    acc[k] = k === 'all' ? projects.length : projects.filter(p => p.status === k).length;
    return acc;
  }, {});

  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.title.toLowerCase().includes(q) || (p.customer_name || '').toLowerCase().includes(q);
    const matchFilter = filter === 'all' || p.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      {/* summary stat row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',   count: counts.all,             color: 'var(--primary)' },
          { label: 'Active',  count: counts.active,          color: 'var(--success)' },
          { label: 'On Hold', count: counts.on_hold,         color: 'var(--gray-500)' },
          { label: 'Pending', count: counts.pending_closure, color: 'var(--warning)' },
          { label: 'Closed',  count: counts.closed,          color: 'var(--gray-400)' },
          { label: 'Overdue', count: projects.filter(p => isOverdue(p.deadline) && !['closed','cancelled','completed_engineer'].includes(p.status)).length, color: 'var(--danger)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color }}>{count}</span>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or customer…" style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
        <div className="flex gap-6 flex-wrap">
          {[['all','All'],['in_progress','In Progress'],['not_started','Not Started'],['on_hold','On Hold'],['pending_approval','Pending'],['closed','Closed'],['cancelled','Cancelled']].map(([k,l]) => (
            <button key={k} className={'btn btn-sm ' + (filter === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setFilter(k)}>
              {l} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><FolderOpen size={40} strokeWidth={1.2} /></div><p>No projects match</p></div>
        : (
          <div className="card table-wrap p-0">
            <table>
              <thead>
                <tr>
                  <th>Project</th><th>Customer</th><th>Status</th><th>Priority</th>
                  <th>Deadline</th><th>Created By</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const overdue = isOverdue(p.deadline) && !['closed','cancelled'].includes(p.status);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                      <td style={{ color: 'var(--gray-600)', fontSize: 12 }}>{p.customer_name || '—'}</td>
                      <td><StatusBadge entityType="project" s={p.status} /></td>
                      <td><PriorityBadge p={p.priority} /></td>
                      <td>
                        <span className={overdue ? 'overdue' : 'text-sm text-muted'}>
                          {p.deadline ? fmtDate(p.deadline) : '—'}
                        </span>
                        {overdue && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}>OVERDUE</span>}
                      </td>
                      <td className="text-sm text-muted">{p.created_by_name || '—'}</td>
                      <td className="text-sm text-muted">{fmtDate(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── MAINTENANCE ADMIN TAB ───────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function MaintenanceAdminTab() {
  const [visits,  setVisits]  = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.maintenanceVisits({}).then(d => { setVisits(d ?? []); setLoading(false); }); }, []);

  const counts = ['all','scheduled','in_progress','completed','cancelled'].reduce((acc, k) => {
    acc[k] = k === 'all' ? visits.length : visits.filter(v => v.status === k).length;
    return acc;
  }, {});
  const pendingReports = visits.filter(v => !v.report_sent && v.status !== 'cancelled').length;

  const filtered = visits.filter(v => {
    const q = search.toLowerCase();
    const matchSearch = !q || v.title.toLowerCase().includes(q) || (v.customer_name||'').toLowerCase().includes(q) || (v.engineer_names||'').toLowerCase().includes(q);
    const matchFilter = filter === 'all' || v.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      {/* summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',           count: counts.all,       color: 'var(--primary)' },
          { label: 'Scheduled',       count: counts.scheduled, color: 'var(--warning)' },
          { label: 'In Progress',     count: counts.in_progress, color: '#d97706' },
          { label: 'Completed',       count: counts.completed, color: 'var(--success)' },
          { label: 'Reports Pending', count: pendingReports,   color: pendingReports > 0 ? 'var(--danger)' : 'var(--gray-400)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color }}>{count}</span>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by visit, customer or engineer…" style={{ flex: 1, minWidth: 200, maxWidth: 340 }} />
        <div className="flex gap-6 flex-wrap">
          {[['all','All'],['scheduled','Scheduled'],['in_progress','In Progress'],['completed','Completed'],['cancelled','Cancelled']].map(([k,l]) => (
            <button key={k} className={'btn btn-sm ' + (filter === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setFilter(k)}>
              {l} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><Wrench size={40} strokeWidth={1.2} /></div><p>No visits match</p></div>
        : (
          <div className="card table-wrap p-0">
            <table>
              <thead>
                <tr>
                  <th>Visit</th><th>Customer</th><th>Date</th><th>Engineer(s)</th>
                  <th>Status</th><th>Report</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.title}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-600)' }}>{v.customer_name}</td>
                    <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : 'text-sm text-muted'}>{fmtDate(v.scheduled_date)}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-600)' }}>{v.engineer_names || <span className="text-muted">—</span>}</td>
                    <td><StatusBadge entityType="visit" s={v.status} /></td>
                    <td>
                      {v.report_sent_to_customer
                        ? <span className="badge badge-done">Sent to Customer</span>
                        : v.report_sent
                          ? <span className="badge badge-active">Awaiting Review</span>
                          : <span className="badge badge-open">Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── DATA EXPORT TAB ─────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function DataExportTab() {
  const [exporting, setExporting] = useState({});
  const [done,      setDone]      = useState({});

  async function exportCSV(name, fetchFn, cols) {
    setExporting(e => ({ ...e, [name]: true }));
    try {
      const rows = await fetchFn();
      const header = Object.keys(cols).join(',');
      const body = rows.map(row =>
        Object.values(cols).map(fn => {
          const v = typeof fn === 'function' ? fn(row) : row[fn];
          const s = (v === null || v === undefined) ? '' : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
      ).join('\n');
      const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(d => ({ ...d, [name]: true }));
      setTimeout(() => setDone(d => ({ ...d, [name]: false })), 3000);
    } finally {
      setExporting(e => ({ ...e, [name]: false }));
    }
  }

  const EXPORTS = [
    {
      name: 'users', label: 'Users', Icon: UsersIcon, color: 'var(--primary)',
      desc: 'All user accounts with role, status and login info',
      fn: () => api.adminUsers(),
      cols: { 'Name': 'name', 'Email': 'email', 'Role': 'role', 'Active': r => r.active ? 'Yes' : 'No', 'Projects': 'project_count', 'Open Tasks': 'open_tasks', 'Joined': 'created_at', 'Last Login': 'last_login' },
    },
    {
      name: 'projects', label: 'Projects', Icon: FolderOpen, color: '#7c3aed',
      desc: 'All projects with status, priority, deadline and customer',
      fn: () => api.projects(),
      cols: { 'Title': 'title', 'Status': 'status', 'Priority': 'priority', 'Deadline': 'deadline', 'Customer': 'customer_name', 'Created By': 'created_by_name', 'Created': 'created_at' },
    },
    {
      name: 'tasks', label: 'Tasks', Icon: CheckSquare, color: 'var(--warning)',
      desc: 'All tasks with assignment, status and deadline',
      fn: () => api.tasks({}),
      cols: { 'Title': 'title', 'Status': 'status', 'Priority': 'priority', 'Assigned To': 'assigned_to_name', 'Project': 'project_title', 'Ad-hoc': r => r.is_adhoc ? 'Yes' : 'No', 'Deadline': 'deadline', 'Created': 'created_at' },
    },
    {
      name: 'maintenance_visits', label: 'Maintenance Visits', Icon: Wrench, color: 'var(--tone-warning-text)',
      desc: 'All maintenance visits with engineer assignment and report status',
      fn: () => api.maintenanceVisits({}),
      cols: { 'Title': 'title', 'Customer': 'customer_name', 'Date': 'scheduled_date', 'Status': 'status', 'Engineers': 'engineer_names', 'Report Sent': r => r.report_sent ? 'Yes' : 'No', 'Sent to Customer': r => r.report_sent_to_customer ? 'Yes' : 'No' },
    },
    {
      name: 'customers', label: 'Customers', Icon: Building2, color: '#0891b2',
      desc: 'All customer records with contact information',
      fn: () => api.customers(),
      cols: { 'Name': 'name', 'Contact': 'contact_name', 'Email': 'contact_email', 'Phone': 'contact_phone', 'Notes': 'notes', 'Created': 'created_at' },
    },
  ];

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="card" style={{ marginBottom: 20, background: 'var(--primary-light)', border: '1px solid #bfdbfe' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Database size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--tone-info-text)' }}>
            All exports are generated client-side as CSV files. Every record currently in the database is included. Data is not filtered by date or status.
          </div>
        </div>
      </div>

      <div className="flex-col gap-12">
        {EXPORTS.map(({ name, label, Icon, color, desc, fn, cols }) => (
          <div key={name} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={20} color={color} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 1 }}>{desc}</div>
            </div>
            <button
              className={'btn btn-sm ' + (done[name] ? 'btn-success' : 'btn-ghost')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 120, justifyContent: 'center' }}
              onClick={() => exportCSV(name, fn, cols)}
              disabled={exporting[name]}
            >
              {exporting[name]
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
                : done[name]
                  ? <><CheckCircle2 size={13} /> Downloaded!</>
                  : <><Download size={13} /> Export CSV</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
