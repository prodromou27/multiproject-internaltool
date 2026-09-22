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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
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
          ? <div className="alert alert-success" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={14} /> All systems healthy — no outstanding issues detected
            </div>
          : alerts.map((a, i) => (
              <div key={i} className={`alert alert-${a.level === 'info' ? 'warning' : a.level}`}
                   style={{ marginBottom: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} /> System Health</div>
            <button className="btn btn-ghost btn-sm" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {healthBars.map(({ label, value, total, color }) => {
              const pct = Math.min(100, Math.round((value / total) * 100));
              return (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span style={{ color: 'var(--gray-400)' }}>{value}/{total} <strong style={{ color }}>{pct}%</strong></span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color, transition: 'width .6s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Quick counters */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, textAlign: 'center' }}>
            {[
              { label: 'Customers',       value: stats.customers,         color: '#0891b2' },
              { label: 'Pending Closure', value: projects.pending_closure, color: 'var(--warning)' },
              { label: 'Storage',         value: fileSize(stats.attachments.total_size), color: 'var(--gray-600)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={14} /> Recent Activity</div>
          {activity.length === 0
            ? <p className="text-muted text-sm">No activity recorded yet</p>
            : <ul style={{ listStyle: 'none' }}>
                {activity.slice(0, 7).map((e, i) => (
                  <li key={i} style={{
                    display: 'flex', gap: 10, padding: '8px 0',
                    borderBottom: i < Math.min(6, activity.length - 1) ? '1px solid var(--gray-100)' : 'none',
                    alignItems: 'flex-start',
                  }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[e.type] || <Activity size={15} color="var(--gray-400)" />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{e.actor}</strong>{' '}<span style={{ color: 'var(--gray-600)' }}>{e.description}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }} title={fmtDateTime(e.created_at)}>{timeSince(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
          }
        </div>
      </div>

      {/* ── Role breakdown ────────────────────────────────── */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}><UsersIcon size={14} /> Team Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { role: 'manager',  label: 'Managers',  count: users.managers,         color: '#7c3aed',          Icon: Shield },
            { role: 'engineer', label: 'Engineers', count: users.engineers,        color: '#0891b2',          Icon: Cog },
            { role: 'planner',  label: 'Planners',  count: users.planners || 0,    color: '#059669',          Icon: LayoutDashboard },
            { role: 'pm',       label: 'PMs',       count: users.pms || 0,         color: '#0ea5e9',          Icon: ClipboardList },
            { role: 'inactive', label: 'Inactive',  count: users.total - users.active, color: 'var(--gray-400)', Icon: UserX },
          ].map(({ label, count, color, Icon }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={color} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>{label}</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
    <div className="card" style={{ padding: 0 }}>
      <ul style={{ listStyle: 'none' }}>
        {events.map((e, i) => (
          <li key={i} style={{
            display: 'flex', gap: 12, padding: '12px 20px',
            borderBottom: i < events.length - 1 ? '1px solid var(--gray-100)' : 'none',
            alignItems: 'flex-start',
          }}>
            <span style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[e.type] || <Bell size={15} color="var(--gray-400)" />}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{e.actor}</strong>{' '}
                <span style={{ color: 'var(--gray-600)' }}>{e.description}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                {timeSince(e.created_at)} · {e.created_at ? fmtDateTime(e.created_at) : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
