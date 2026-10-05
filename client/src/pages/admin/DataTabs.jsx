import { useState } from 'react';
import { Users as UsersIcon, FolderOpen, CheckCircle2, CheckSquare, Wrench, Building2, Loader2, Download, Database } from 'lucide-react';
import { api } from '../../api';
import { localDateISO } from '../../utils/dates';

/* ══════════════════════════════════════════════════════════ */
/* ── PROJECTS ADMIN TAB ──────────────────────────────────── */
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
      a.download = `${name}_${localDateISO()}.csv`;
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
    <div className="u-48a0d2f">
      <div className="card u-1e20361">
        <div className="u-e2e5d77">
          <Database size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
          <div className="u-45801e5">
            All exports are generated client-side as CSV files. Every record currently in the database is included. Data is not filtered by date or status.
          </div>
        </div>
      </div>

      <div className="flex-col gap-12">
        {EXPORTS.map(({ name, label, Icon, color, desc, fn, cols }) => (
          <div key={name} className="card u-ad96c58">
            <div className="u-f40993d" style={{ background: color + '18' }}>
              <Icon size={20} color={color} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="u-4aaa243">{label}</div>
              <div className="u-f64ffdd">{desc}</div>
            </div>
            <button
              className={`${'btn btn-sm ' + (done[name] ? 'btn-success' : 'btn-ghost') || ''} u-bddbdd7`}
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
