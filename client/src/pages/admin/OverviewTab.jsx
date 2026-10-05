import { useEffect, useState, useCallback } from 'react';
import { UserX, CheckCircle2, AlertTriangle, ScrollText, Bell, Loader2, Activity, RefreshCw, TrendingUp, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { fileSize, timeSince, ACTIVITY_ICONS } from './shared';
import { MetricStrip } from '../../components/EnterpriseUI';
import { fmtDateTime } from '../../components/Shared';

/* ══════════════════════════════════════════════════════════ */
/* ── OVERVIEW TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.adminStats(), api.adminActivity(8)])
      .then(([s, a]) => { setStats(s); setActivity(a); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !stats) return (
    <div className="u-a8973f8">
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading overview…
    </div>
  );

  const { users, projects, tasks, maintenance } = stats;

  const alerts = [];
  if (projects.overdue > 0)
    alerts.push({ level: 'danger',  icon: <ShieldAlert size={14} />, msg: `${projects.overdue} project${projects.overdue !== 1 ? 's are' : ' is'} past deadline` });
  if (projects.pending_closure > 0)
    alerts.push({ level: 'warning', icon: <AlertTriangle size={14} />, msg: `${projects.pending_closure} project${projects.pending_closure !== 1 ? 's are' : ' is'} awaiting closure approval` });
  if (maintenance.report_pending > 0)
    alerts.push({ level: 'warning', icon: <AlertTriangle size={14} />, msg: `${maintenance.report_pending} maintenance report${maintenance.report_pending !== 1 ? 's' : ''} pending submission` });
  if (users.total - users.active > 0)
    alerts.push({ level: 'info',    icon: <UserX size={14} />, msg: `${users.total - users.active} user account${(users.total - users.active) !== 1 ? 's' : ''} deactivated` });

  const healthBars = [
    { label: 'Users active',       value: users.active,                                      total: Math.max(1, users.total), color: 'var(--primary)' },
    { label: 'Projects on track',  value: Math.max(0, projects.active - projects.overdue),   total: Math.max(1, projects.active), color: 'var(--primary)' },
    { label: 'Tasks completed',    value: tasks.done,                                         total: Math.max(1, tasks.total), color: 'var(--primary)' },
    { label: 'Visit reports sent',    value: maintenance.report_sent,                            total: Math.max(1, maintenance.total), color: 'var(--primary)' },
  ];

  return (
    <div>
      {/* ── Alert banner ──────────────────────────────────── */}
      <div className="mb-20">
        {alerts.length === 0
          ? <div className="alert alert-success u-97bc8b4">
              <CheckCircle2 size={14} /> All systems healthy — no outstanding issues detected
            </div>
          : alerts.map((a, i) => (
              <div key={i} className={`alert alert-${a.level === 'info' ? 'warning' : a.level} u-45b5ac7`}>
                {a.icon}{a.msg}
              </div>
            ))
        }
      </div>

      {/* ── Key metric cards ──────────────────────────────── */}
      <MetricStrip className="mb-20" items={[
        { label: 'Active users', value: users.active, note: `${users.managers} managers, ${users.engineers} engineers` },
        { label: 'Active projects', value: projects.active, note: projects.overdue ? `${projects.overdue} overdue` : 'None overdue', tone: projects.overdue ? 'danger' : undefined },
        { label: 'Open tasks', value: tasks.open, note: `${tasks.done} completed, ${tasks.adhoc} ad-hoc` },
        { label: 'Visit reports not sent', value: maintenance.report_pending, note: `${maintenance.report_sent} sent of ${maintenance.total} visits`, tone: maintenance.report_pending ? 'warning' : undefined },
      ]} />

      {/* ── Health + Recent Activity ──────────────────────── */}
      <div className="grid-2 mb-20">

        {/* System health bars */}
        <div className="card">
          <div className="u-99f74a6">
            <div className="section-title u-564c453"><TrendingUp size={14} /> System Health</div>
            <button className="btn btn-ghost btn-sm inline-flex items-center gap-4" onClick={load}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          <div className="u-2b1e4d1">
            {healthBars.map(({ label, value, total, color }) => {
              const pct = Math.min(100, Math.round((value / total) * 100));
              return (
                <div key={label}>
                  <div className="u-189fef4">
                    <span className="font-semibold">{label}</span>
                    <span className="u-1e2ea2c">{value}/{total} <strong>{pct}%</strong></span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill u-7f8ceac" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Quick counters */}
          <div className="u-e5c1aed">
            {[
              { label: 'Customers',       value: stats.customers },
              { label: 'Pending closure', value: projects.pending_closure, color: projects.pending_closure ? 'var(--warning)' : undefined },
              { label: 'Storage',         value: fileSize(stats.attachments.total_size) },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="u-3d57896" style={color ? { color } : undefined}>{value}</div>
                <div className="u-8e62657">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="section-title u-2cc326d"><Activity size={14} /> Recent Activity</div>
          {activity.length === 0
            ? <p className="text-muted text-sm">No activity recorded yet</p>
            : <ul className="list-none">
                {activity.slice(0, 7).map((e, i) => (
                  <li key={i} className={["u-d57244e", (i < Math.min(6, activity.length - 1) ? 'u-02c1276' : 'u-71a91da')].filter(Boolean).join(' ')}>
                    <span className="u-82d341f">{ACTIVITY_ICONS[e.type] || <Activity size={15} color="var(--gray-400)" />}</span>
                    <div className="flex-1 min-w-0">
                      <div className="u-b360f43">
                        <strong>{e.actor}</strong>{' '}<span className="u-31d6430">{e.description}</span>
                      </div>
                      <div className="u-ed87168" title={fmtDateTime(e.created_at)}>{timeSince(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
          }
        </div>
      </div>

      {/* ── Role breakdown ────────────────────────────────── */}
      <div className="card">
        <div className="section-title u-8cac894">Team breakdown</div>
        <MetricStrip items={[
          { label: 'Managers', value: users.managers },
          { label: 'Engineers', value: users.engineers },
          { label: 'Planners', value: users.planners || 0 },
          { label: 'PMs', value: users.pms || 0 },
          { label: 'Inactive', value: users.total - users.active },
        ]} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── SYSTEM STATS TAB ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function StatsTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.adminStats().then(setStats); }, []);
  if (!stats) return <p className="text-muted">Loading…</p>;
  const { users, projects, tasks, maintenance, customers, attachments } = stats;

  return (
    <div className="u-f22e0e6">
      <div>
        <div className="section-title">Users</div>
        <MetricStrip items={[
          { label: 'Total users', value: users.total, note: `${users.active} active` },
          { label: 'Managers', value: users.managers },
          { label: 'Engineers', value: users.engineers },
          { label: 'Inactive', value: users.total - users.active, note: 'deactivated' },
        ]} />
      </div>
      <div>
        <div className="section-title">Projects</div>
        <MetricStrip items={[
          { label: 'Total', value: projects.total, note: 'all time' },
          { label: 'Active', value: projects.active },
          { label: 'Closed', value: projects.closed },
          { label: 'Overdue', value: projects.overdue, note: 'past deadline', tone: projects.overdue ? 'danger' : undefined },
        ]} />
      </div>
      <div>
        <div className="section-title">Tasks</div>
        <MetricStrip items={[
          { label: 'Total tasks', value: tasks.total },
          { label: 'Open', value: tasks.open, note: 'awaiting action' },
          { label: 'Completed', value: tasks.done },
          { label: 'Ad-hoc', value: tasks.adhoc, note: 'unplanned' },
        ]} />
      </div>
      <div>
        <div className="section-title">Maintenance visits</div>
        <MetricStrip items={[
          { label: 'Visits', value: maintenance.total },
          { label: 'Reports not sent', value: maintenance.report_pending, tone: maintenance.report_pending ? 'warning' : undefined },
          { label: 'Reports sent', value: maintenance.report_sent },
          { label: 'Customers', value: customers },
        ]} />
      </div>
      <div>
        <div className="section-title">Storage</div>
        <MetricStrip items={[
          { label: 'Attachments', value: attachments.count, note: 'files uploaded' },
          { label: 'Storage used', value: fileSize(attachments.total_size), note: 'across all projects' },
        ]} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ACTIVITY TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function ActivityTab() {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.adminActivity(100).then(e => { setEvents(e); setLoading(false); }); }, []);

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!events.length) return <div className="empty"><div className="empty-icon"><ScrollText size={40} strokeWidth={1.2} /></div><p>No activity yet</p></div>;

  return (
    <div className="card p-0">
      <ul className="list-none">
        {events.map((e, i) => (
          <li key={i} className={["u-5796aaa", (i < events.length - 1 ? 'u-02c1276' : 'u-71a91da')].filter(Boolean).join(' ')}>
            <span className="u-12ece22">{ACTIVITY_ICONS[e.type] || <Bell size={15} color="var(--gray-400)" />}</span>
            <div className="flex-1 min-w-0">
              <div className="u-5e0faad">
                <strong>{e.actor}</strong>{' '}
                <span className="u-31d6430">{e.description}</span>
              </div>
              <div className="u-f6e5233">
                {timeSince(e.created_at)} · {e.created_at ? fmtDateTime(e.created_at) : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
