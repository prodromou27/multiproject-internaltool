import { useEffect, useState, useCallback } from 'react';
import { Users as UsersIcon, Shield, Cog, UserX, FolderOpen, CheckCircle2, Lock, AlertTriangle, CheckSquare, Inbox, Zap, Wrench, ClipboardList, Send, Building2, Paperclip, HardDrive, ScrollText, Bell, Loader2, Activity, RefreshCw, TrendingUp, ShieldAlert, LayoutDashboard } from 'lucide-react';
import { api } from '../../api';
import { fileSize, timeSince, ACTIVITY_ICONS, StatCard } from './shared';
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
    { label: 'Users Active',       value: users.active,                                      total: Math.max(1, users.total),        color: 'var(--success)' },
    { label: 'Projects On Track',  value: Math.max(0, projects.active - projects.overdue),   total: Math.max(1, projects.active),    color: 'var(--primary)' },
    { label: 'Tasks Completed',    value: tasks.done,                                         total: Math.max(1, tasks.total),        color: 'var(--success)' },
    { label: 'MV Reports Sent',    value: maintenance.report_sent,                            total: Math.max(1, maintenance.total),  color: 'var(--primary)' },
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
      <div className="grid-4 mb-20">
        <StatCard Icon={UsersIcon}   label="Active Users"    value={users.active}               sub={`${users.managers} managers · ${users.engineers} engineers`}    color="var(--primary)" />
        <StatCard Icon={FolderOpen}  label="Active Projects" value={projects.active}            sub={projects.overdue ? `⚠ ${projects.overdue} overdue` : 'All on track'}  color={projects.overdue ? 'var(--danger)' : 'var(--success)'} />
        <StatCard Icon={CheckSquare} label="Open Tasks"      value={tasks.open}                 sub={`${tasks.done} completed · ${tasks.adhoc} ad-hoc`}              color="var(--warning)" />
        <StatCard Icon={Wrench}      label="MV Reports Due"  value={maintenance.report_pending} sub={`${maintenance.report_sent} sent · ${maintenance.total} total`}  color={maintenance.report_pending > 0 ? 'var(--warning)' : 'var(--success)'} />
      </div>

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
                    <span className="u-1e2ea2c">{value}/{total} <strong style={{ color }}>{pct}%</strong></span>
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
              { label: 'Customers',       value: stats.customers,         color: '#0891b2' },
              { label: 'Pending Closure', value: projects.pending_closure, color: 'var(--warning)' },
              { label: 'Storage',         value: fileSize(stats.attachments.total_size), color: 'var(--gray-600)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="u-3d57896" style={{ color }}>{value}</div>
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
                  <li key={i} className="u-d57244e" style={{ borderBottom: i < Math.min(6, activity.length - 1) ? '1px solid var(--gray-100)' : 'none' }}>
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
        <div className="section-title u-8cac894"><UsersIcon size={14} /> Team Breakdown</div>
        <div className="u-aa8878b">
          {[
            { role: 'manager',  label: 'Managers',  count: users.managers,         color: '#7c3aed',          Icon: Shield },
            { role: 'engineer', label: 'Engineers', count: users.engineers,        color: '#0891b2',          Icon: Cog },
            { role: 'planner',  label: 'Planners',  count: users.planners || 0,    color: '#059669',          Icon: LayoutDashboard },
            { role: 'pm',       label: 'PMs',       count: users.pms || 0,         color: '#0ea5e9',          Icon: ClipboardList },
            { role: 'inactive', label: 'Inactive',  count: users.total - users.active, color: 'var(--gray-400)', Icon: UserX },
          ].map(({ label, count, color, Icon }) => (
            <div key={label} className="u-a3b5c73">
              <div className="u-433b31a" style={{ background: color + '18' }}>
                <Icon size={18} color={color} />
              </div>
              <div>
                <div className="u-76bc9ef" style={{ color }}>{count}</div>
                <div className="u-c945d44">{label}</div>
              </div>
            </div>
          ))}
        </div>
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
        <div className="section-title flex-center gap-6"><UsersIcon size={14} /> Users</div>
        <div className="grid-4">
          <StatCard Icon={UsersIcon}     label="Total Users"    value={users.total}               sub={`${users.active} active`}   color="var(--primary)" />
          <StatCard Icon={Shield}        label="Managers"       value={users.managers}             sub="management role"            color="#7c3aed" />
          <StatCard Icon={Cog}           label="Engineers"      value={users.engineers}            sub="engineering role"           color="#0891b2" />
          <StatCard Icon={UserX}         label="Inactive"       value={users.total - users.active} sub="deactivated"                color="var(--gray-400)" />
        </div>
      </div>
      <div>
        <div className="section-title flex-center gap-6"><FolderOpen size={14} /> Projects</div>
        <div className="grid-4">
          <StatCard Icon={FolderOpen}    label="Total"          value={projects.total}           sub="all time"               color="var(--primary)" />
          <StatCard Icon={CheckCircle2}  label="Active"         value={projects.active}          sub="in progress"            color="var(--success)" />
          <StatCard Icon={Lock}          label="Closed"         value={projects.closed}          sub="completed"              color="var(--gray-600)" />
          <StatCard Icon={AlertTriangle} label="Overdue"        value={projects.overdue}         sub="past deadline"          color="var(--danger)" />
        </div>
      </div>
      <div>
        <div className="section-title flex-center gap-6"><CheckSquare size={14} /> Tasks</div>
        <div className="grid-4">
          <StatCard Icon={CheckSquare}   label="Total Tasks"    value={tasks.total}   sub="active & completed"  color="var(--primary)" />
          <StatCard Icon={Inbox}         label="Open"           value={tasks.open}    sub="awaiting action"     color="var(--warning)" />
          <StatCard Icon={CheckCircle2}  label="Completed"      value={tasks.done}    sub="done"                color="var(--success)" />
          <StatCard Icon={Zap}           label="Ad-hoc"         value={tasks.adhoc}   sub="unplanned"           color="#db2777" />
        </div>
      </div>
      <div>
        <div className="section-title flex-center gap-6"><Wrench size={14} /> Maintenance Visits</div>
        <div className="grid-4">
          <StatCard Icon={Wrench}        label="Total MVs"          value={maintenance.total}          sub="all visits"         color="var(--primary)" />
          <StatCard Icon={ClipboardList} label="Reports Pending"    value={maintenance.report_pending} sub="not yet sent"       color="var(--warning)" />
          <StatCard Icon={Send}          label="Reports Sent"       value={maintenance.report_sent}    sub="delivered"          color="var(--success)" />
          <StatCard Icon={Building2}     label="Customers"          value={customers}                  sub="registered clients" color="#0891b2" />
        </div>
      </div>
      <div>
        <div className="section-title flex-center gap-6"><Paperclip size={14} /> Storage</div>
        <div className="grid-2">
          <StatCard Icon={Paperclip}     label="Attachments"    value={attachments.count}               sub="files uploaded"      color="#7c3aed" />
          <StatCard Icon={HardDrive}     label="Storage Used"   value={fileSize(attachments.total_size)} sub="across all projects" color="var(--gray-600)" />
        </div>
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
          <li key={i} className="u-5796aaa" style={{ borderBottom: i < events.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
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
