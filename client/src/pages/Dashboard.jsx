import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw, CheckCircle2, AlertTriangle, Clock, Wrench,
  FolderOpen, ListTodo, Send, ClipboardCheck, CalendarX, X,
  Settings2, GripVertical,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../components/Shared';

/* ── Widget definitions per role ─────────────────────────── */
const WIDGET_DEFS = {
  manager: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'project_health',    label: 'Project Health (RAG)'         },
    { id: 'task_overview',     label: 'Task Overview & Workload'     },
    { id: 'pending_closure',   label: 'Pending Closure Approvals'    },
    { id: 'incomplete_visits', label: 'Incomplete Maintenance Visits' },
    { id: 'mv_review',         label: 'Reports to Approve for PM'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    { id: 'projects',          label: 'Active Projects'              },
    { id: 'tasks',             label: 'Open Tasks'                   },
  ],
  engineer: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'due_week',          label: 'Due This Week'                },
    { id: 'pending_reports',   label: 'Reports Pending (→ Mgmt)'    },
    { id: 'mv_this_month',     label: 'Visits This Month'            },
    { id: 'projects',          label: 'My Projects'                  },
    { id: 'tasks',             label: 'My Open Tasks'                },
  ],
  planner: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'upcoming_visits',   label: 'Upcoming Visits'              },
  ],
  pm: [
    { id: 'stat_cards',        label: 'Stats Overview'               },
    { id: 'pm_visits',         label: 'Visits Awaiting Completion'   },
    { id: 'projects',          label: 'All Active Projects'          },
  ],
};

/* ── Widget preferences — localStorage, per user+role ──────── */
function useWidgetPrefs(userId, role) {
  const storageKey = `dash_widgets_${userId}_${role}`;
  const defs       = WIDGET_DEFS[role] ?? WIDGET_DEFS.engineer;
  const defaultIds = defs.map(d => d.id);

  const [prefs, setPrefsState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.order) {
        const valid   = saved.order.filter(id => defaultIds.includes(id));
        const missing = defaultIds.filter(id => !valid.includes(id));
        return {
          order:  [...valid, ...missing],
          hidden: (saved.hidden ?? []).filter(id => defaultIds.includes(id)),
        };
      }
    } catch {}
    return { order: defaultIds, hidden: [] };
  });

  function persist(p) {
    setPrefsState(p);
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch {}
  }

  return {
    prefs,
    defs,
    isVisible: id => !prefs.hidden.includes(id),
    toggle:    id => persist({
      ...prefs,
      hidden: prefs.hidden.includes(id)
        ? prefs.hidden.filter(h => h !== id)
        : [...prefs.hidden, id],
    }),
    reorder: (from, to) => {
      const o = [...prefs.order];
      o.splice(to, 0, o.splice(from, 1)[0]);
      persist({ ...prefs, order: o });
    },
    reset: () => persist({ order: defaultIds, hidden: [] }),
  };
}

/* ── Widget Customizer Modal ──────────────────────────────── */
function WidgetCustomizer({ prefs, defs, onToggle, onReorder, onReset, onClose }) {
  const [dragFrom, setDragFrom] = useState(null);
  const [overIdx,  setOverIdx]  = useState(null);

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)',
        display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={onClose}
    >
      <div
        style={{ background:'#fff', borderRadius:14, padding:24,
          width:420, maxWidth:'94vw', boxShadow:'0 20px 60px rgba(0,0,0,.18)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>Customize Dashboard</div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:4 }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize:12, color:'#6b7280', marginBottom:16 }}>
          Drag to reorder &bull; Show/Hide to toggle visibility
        </p>

        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {prefs.order.map((id, idx) => {
            const def    = defs.find(d => d.id === id);
            if (!def) return null;
            const hidden = prefs.hidden.includes(id);
            return (
              <div
                key={id}
                draggable
                onDragStart={e => { setDragFrom(idx); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
                onDragOver={e => { e.preventDefault(); setOverIdx(idx); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverIdx(null); }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== idx) onReorder(dragFrom, idx);
                  setDragFrom(null); setOverIdx(null);
                }}
                style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'10px 12px', borderRadius:8, cursor:'grab',
                  background: overIdx === idx ? '#eff6ff' : hidden ? '#f9fafb' : '#fff',
                  border:`1px solid ${overIdx === idx ? '#93c5fd' : '#e5e7eb'}`,
                  opacity: dragFrom === idx ? 0.35 : hidden ? 0.65 : 1,
                  transition:'background .1s, border-color .1s',
                  userSelect:'none',
                }}
              >
                <GripVertical size={14} color="#d1d5db" style={{ flexShrink:0 }} />
                <span style={{ flex:1, fontSize:13,
                  fontWeight: hidden ? 400 : 600,
                  color: hidden ? '#9ca3af' : '#111827' }}>
                  {def.label}
                </span>
                <button
                  onClick={() => onToggle(id)}
                  style={{
                    padding:'3px 12px', borderRadius:20, fontSize:11, fontWeight:700,
                    border:'none', cursor:'pointer', flexShrink:0,
                    background: hidden ? '#f3f4f6' : '#dbeafe',
                    color:      hidden ? '#6b7280' : '#1d4ed8',
                    transition:'all .1s',
                  }}
                >
                  {hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', marginTop:18 }}>
          <button
            onClick={onReset}
            style={{ background:'none', border:'1px solid #e5e7eb', borderRadius:8,
              padding:'6px 14px', fontSize:12, cursor:'pointer', color:'#6b7280' }}
          >
            Reset to default
          </button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ── Overdue Banner ──────────────────────────────────────── */
function OverdueBanner({ overdueProjects, overdueTasks }) {
  const KEY = 'hub_overdue_banner_dismissed';
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(KEY) === '1');

  if (dismissed || (overdueProjects.length === 0 && overdueTasks.length === 0)) return null;

  const dismiss = () => { sessionStorage.setItem(KEY, '1'); setDismissed(true); };

  return (
    <div style={{
      background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10,
      padding:'12px 16px', marginBottom:20,
      display:'flex', alignItems:'flex-start', gap:12,
    }}>
      <AlertTriangle size={16} color="#ef4444" style={{ flexShrink:0, marginTop:2 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:13, color:'#b91c1c', marginBottom:4 }}>
          Overdue items need attention
        </div>
        <div style={{ fontSize:12, color:'#dc2626', display:'flex', gap:16, flexWrap:'wrap' }}>
          {overdueProjects.length > 0 && (
            <span>
              <strong>{overdueProjects.length}</strong> overdue project{overdueProjects.length !== 1 ? 's' : ''}:{' '}
              {overdueProjects.slice(0, 3).map((p, i) => (
                <span key={p.id}>{i > 0 ? ', ' : ''}
                  <Link to={`/projects/${p.id}`} style={{ color:'#dc2626', fontWeight:600 }}>{p.title}</Link>
                </span>
              ))}
              {overdueProjects.length > 3 && ` +${overdueProjects.length - 3} more`}
            </span>
          )}
          {overdueTasks.length > 0 && (
            <span><strong>{overdueTasks.length}</strong> overdue task{overdueTasks.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <button onClick={dismiss}
        style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', padding:2, flexShrink:0 }}>
        <X size={14} />
      </button>
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────── */
function StatCard({ icon: Icon, iconBg, iconColor, value, label, valueColor, to }) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <div
      className="card"
      style={{ padding:'16px 20px', cursor:clickable ? 'pointer' : 'default', transition:'transform .15s, box-shadow .15s' }}
      onClick={clickable ? () => navigate(to) : undefined}
      onMouseEnter={clickable ? e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,.1)'; } : undefined}
      onMouseLeave={clickable ? e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; } : undefined}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:iconBg,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon size={18} color={iconColor} />
        </div>
      </div>
      <div style={{ fontSize:28, fontWeight:800, color:valueColor || 'var(--gray-900)', letterSpacing:'-.5px' }}>{value}</div>
      <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:3, fontWeight:500 }}>{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { user } = useAuth();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isEngineer = user.role === 'engineer';
  const isPM       = user.role === 'pm';

  const [projects,         setProjects]         = useState([]);
  const [tasks,            setTasks]            = useState([]);
  const [summary,          setSummary]          = useState(null);
  const [visits,           setVisits]           = useState([]);
  const [reviewVisits,     setReviewVisits]     = useState([]);
  const [incompleteVisits, setIncompleteVisits] = useState([]);
  const [pendingReports,   setPendingReports]   = useState([]);
  const [completingVisit,  setCompletingVisit]  = useState(null); // visit id being completed
  const [error,            setError]            = useState('');
  const [loading,          setLoading]          = useState(true);
  const [showCustomizer,   setShowCustomizer]   = useState(false);

  const { prefs, defs, isVisible, toggle, reorder, reset } = useWidgetPrefs(user.id, user.role);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const calls = [
        (isPlanner) ? Promise.resolve([]) : api.projects(),
        (isPlanner || isPM) ? Promise.resolve([]) : api.tasks({}),
        isManager ? api.reportSummary() : Promise.resolve(null),
        api.maintenanceVisits({ month: new Date().toISOString().slice(0,7), overview:1 }),
        isManager ? api.maintenanceVisits({ review_pending:1 }) : Promise.resolve([]),
        (isManager || isPM) ? api.maintenanceVisits({ not_completed:1 }) : Promise.resolve([]),
        isEngineer ? api.maintenanceVisits({ pending_report:1 }) : Promise.resolve([]),
      ];
      const [pR, tR, sR, vR, rR, iR, prR] = await Promise.allSettled(calls);
      if (pR.status  === 'fulfilled') setProjects(pR.value ?? []);
      if (tR.status  === 'fulfilled') setTasks(tR.value ?? []);
      if (sR.status  === 'fulfilled') setSummary(sR.value);
      if (vR.status  === 'fulfilled') setVisits(vR.value ?? []);
      if (rR.status  === 'fulfilled') setReviewVisits(rR.value ?? []);
      if (iR.status  === 'fulfilled') setIncompleteVisits(iR.value ?? []);
      if (prR.status === 'fulfilled') setPendingReports(prR.value ?? []);
      const failed = [pR, tR, sR, vR, rR, iR, prR]
        .filter(r => r.status === 'rejected').map(r => r.reason?.message || 'Unknown');
      if (failed.length) setError(`Some data could not be loaded: ${failed.join(' · ')}`);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally { setLoading(false); }
  }, [isManager, isPlanner, isEngineer, isPM]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="page">
      <div style={{ display:'flex', alignItems:'center', gap:12, color:'var(--gray-400)', paddingTop:48 }}>
        <RefreshCw size={18} style={{ animation:'spin 1s linear infinite' }} />
        Loading dashboard…
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  /* ── Derived data ─────────────────────────────────────── */
  const TASK_TERMINAL = ['completed', 'closed', 'cancelled'];
  const active          = projects.filter(p => p.status === 'active' || p.status === 'on_hold');
  const pendingClosure  = projects.filter(p => p.status === 'pending_approval');
  const myOpen          = tasks.filter(t => !TASK_TERMINAL.includes(t.status));
  const overdueProjects = projects.filter(p => isOverdue(p.deadline) && !['closed', 'cancelled', 'pending_approval'].includes(p.status));
  const overdueTasks    = tasks.filter(t => isOverdue(t.deadline) && !TASK_TERMINAL.includes(t.status));

  /* ════════════════════════════════════════════════════════
     Widget render helpers — return null when widget has no
     content so it silently disappears (not "hidden by user")
  ════════════════════════════════════════════════════════ */

  /* ── Planner widgets ──────────────────────────────────── */
  function plannerWidget(id) {
    switch (id) {
      case 'stat_cards': {
        const upcoming    = visits.filter(v => v.status === 'scheduled');
        const completed   = visits.filter(v => v.status === 'completed');
        const rptPending  = visits.filter(v => v.status !== 'cancelled' && !v.report_sent);
        return (
          <div key={id} className="grid-4" style={{ marginBottom:20 }}>
            <div className="card stat">
              <div className="stat-value" style={{ color:'var(--primary)' }}>{upcoming.length}</div>
              <div className="stat-label">Scheduled</div>
            </div>
            <div className="card stat">
              <div className="stat-value" style={{ color:'var(--success)' }}>{completed.length}</div>
              <div className="stat-label">Completed (this month)</div>
            </div>
            <div className="card stat">
              <div className="stat-value" style={{ color: rptPending.length ? 'var(--warning)' : 'var(--success)' }}>{rptPending.length}</div>
              <div className="stat-label">Reports Pending</div>
            </div>
            <div className="card stat">
              <div className="stat-value">{visits.length}</div>
              <div className="stat-label">Total This Month</div>
            </div>
          </div>
        );
      }
      case 'upcoming_visits': {
        const upcoming = visits.filter(v => v.status === 'scheduled');
        return (
          <div key={id} className="card">
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Wrench size={15} color="var(--warning)" />
                <div className="section-title" style={{ margin:0 }}>Upcoming Visits — This Month</div>
                <span className="badge badge-on_hold" style={{ marginLeft:4 }}>{upcoming.length}</span>
              </div>
              <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {upcoming.length === 0
              ? <p className="text-muted text-sm">No upcoming visits this month</p>
              : <div className="table-wrap">
                  <table>
                    <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Engineer(s)</th><th>Report</th></tr></thead>
                    <tbody>
                      {upcoming.map(v => (
                        <tr key={v.id}>
                          <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                          <td>{v.title}</td>
                          <td className={isOverdue(v.scheduled_date) ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                          <td style={{ color:'var(--gray-600)' }}>{v.engineer_names || <span className="text-muted">—</span>}</td>
                          <td>{v.report_sent
                            ? <span className="badge badge-done">Sent</span>
                            : <span className="badge badge-open">Pending</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        );
      }
      default: return null;
    }
  }

  /* ── Manager widgets ──────────────────────────────────── */
  function managerWidget(id) {
    switch (id) {
      case 'stat_cards':
        return summary ? (
          <div key={id} className="grid-4" style={{ marginBottom:20 }}>
            <StatCard icon={FolderOpen}    iconBg="#eff6ff" iconColor="#3b82f6"
              value={summary.total ?? 0} label="Total Projects" to="/projects" />
            <StatCard icon={CheckCircle2}  iconBg="#f0fdf4" iconColor="#22c55e"
              value={summary.byStatus?.find(s => s.status === 'closed')?.count ?? 0}
              label="Closed" valueColor="var(--success)" to="/projects?filter=closed" />
            <StatCard icon={AlertTriangle} iconBg="#fef2f2" iconColor="#ef4444"
              value={summary.overdue ?? 0} label="Overdue" valueColor="var(--danger)"
              to="/search?q=overdue+projects" />
            <StatCard icon={Clock}         iconBg="#fffbeb" iconColor="#f59e0b"
              value={summary.pendingClosure?.length ?? 0} label="Pending Closure"
              valueColor="var(--warning)" to="/projects?filter=pending_approval" />
          </div>
        ) : null;

      case 'project_health': {
        if (active.length === 0) return null;
        const ragRed   = active.filter(p => p.rag_status === 'red').length;
        const ragAmber = active.filter(p => p.rag_status === 'amber').length;
        const ragGreen = active.filter(p => p.rag_status === 'green').length;
        const atRisk   = active
          .filter(p => p.rag_status === 'red' || p.rag_status === 'amber')
          .sort((a, b) => (a.rag_status === 'red' && b.rag_status !== 'red' ? -1 : 1));
        const RAG = [
          { label:'Red',   count:ragRed,   bg:'#fef2f2', text:'#b91c1c', dot:'#ef4444' },
          { label:'Amber', count:ragAmber, bg:'#fffbeb', text:'#92400e', dot:'#f59e0b' },
          { label:'Green', count:ragGreen, bg:'#f0fdf4', text:'#166534', dot:'#22c55e' },
        ];
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background: ragRed ? '#ef4444' : ragAmber ? '#f59e0b' : '#22c55e', display:'inline-block' }} />
                <div className="section-title" style={{ margin:0 }}>Project Health</div>
                <span className="text-sm text-muted">({active.length} active)</span>
              </div>
              <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {/* RAG breakdown row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom: atRisk.length ? 16 : 0 }}>
              {RAG.map(({ label, count, bg, text, dot }) => (
                <div key={label} style={{ background:bg, borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                  <div style={{ fontSize:26, fontWeight:800, color:text, lineHeight:1 }}>{count}</div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:5, fontSize:11, color:text, marginTop:5, fontWeight:600 }}>
                    <span style={{ width:7, height:7, borderRadius:'50%', background:dot, display:'inline-block', flexShrink:0 }} />
                    {label}
                  </div>
                </div>
              ))}
            </div>
            {atRisk.length > 0 ? (
              <>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>At-Risk Projects</div>
                <ul style={{ listStyle:'none' }}>
                  {atRisk.slice(0,5).map(p => (
                    <li key={p.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:p.rag_status==='red'?'#ef4444':'#f59e0b', flexShrink:0 }} />
                      <Link to={`/projects/${p.id}`} style={{ flex:1, fontWeight:600, color:'var(--gray-900)', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{p.title}</Link>
                      <StatusBadge s={p.status} />
                      {p.deadline && <span className={'text-sm '+(isOverdue(p.deadline)?'overdue':'text-muted')} style={{ flexShrink:0 }}>{fmtDate(p.deadline)}</span>}
                    </li>
                  ))}
                </ul>
                {atRisk.length > 5 && <Link to="/projects" style={{ fontSize:12, color:'var(--primary)', display:'block', marginTop:8 }}>+{atRisk.length-5} more at-risk →</Link>}
              </>
            ) : (
              <p className="text-muted text-sm" style={{ margin:0 }}>✓ All {ragGreen} active project{ragGreen !== 1 ? 's' : ''} are on track</p>
            )}
          </div>
        );
      }

      case 'task_overview':
        return summary ? (
          <div key={id} className="grid-2" style={{ marginBottom:20 }}>
            <div className="card">
              <div className="section-header">
                <div className="section-title" style={{ margin:0 }}>Task Overview</div>
                <Link to="/tasks" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
              </div>
              {summary.taskStats ? (
                <div className="grid-3">
                  {[
                    { label:'Open',        value: summary.taskStats.open        ?? 0, color:'var(--primary)'  },
                    { label:'In Progress', value: summary.taskStats.in_progress ?? 0, color:'var(--warning)'  },
                    { label:'Done',        value: summary.taskStats.done        ?? 0, color:'var(--success)'  },
                  ].map(s => (
                    <div key={s.label} className="stat" style={{ padding:'4px 0' }}>
                      <div className="stat-value" style={{ fontSize:26, color:s.color }}>{s.value}</div>
                      <div className="stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted text-sm">No task data</p>}
            </div>
            <div className="card">
              <div className="section-header">
                <div className="section-title" style={{ margin:0 }}>Engineer Workload</div>
              </div>
              {summary.engineerLoad?.length > 0
                ? summary.engineerLoad.slice(0,5).map(e => (
                    <div key={e.name} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <div style={{ width:26, height:26, borderRadius:'50%', background:'linear-gradient(135deg,#3b82f6,#6366f1)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>
                        {e.name?.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ width:100, fontSize:12, fontWeight:600, flexShrink:0,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.name}</span>
                      <div style={{ flex:1 }}>
                        <div className="progress-bar" style={{ height:6 }}>
                          <div className="progress-bar-fill" style={{
                            width: e.task_count ? `${(e.done_count / e.task_count) * 100}%` : '0%',
                            background:'var(--success)' }} />
                        </div>
                      </div>
                      <span style={{ fontSize:11, color:'var(--gray-500)', flexShrink:0 }}>{e.done_count}/{e.task_count}</span>
                    </div>
                  ))
                : <p className="text-muted text-sm">No engineers yet</p>
              }
            </div>
          </div>
        ) : null;

      case 'pending_closure':
        return pendingClosure.length > 0 ? (
          <div key={id} className="card" style={{ marginBottom:20, borderLeft:'3px solid var(--warning)' }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Clock size={15} color="var(--warning)" />
                <div className="section-title" style={{ margin:0, color:'var(--warning)' }}>Pending Closure Approval</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Project</th><th>Priority</th><th>Deadline</th><th>Action</th></tr></thead>
                <tbody>
                  {pendingClosure.map(p => (
                    <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`} style={{ fontWeight:600 }}>{p.title}</Link></td>
                      <td><PriorityBadge p={p.priority} /></td>
                      <td className={isOverdue(p.deadline) ? 'overdue' : ''}>{fmtDate(p.deadline) || '—'}</td>
                      <td><Link to={`/projects/${p.id}`} className="btn btn-sm btn-success">Review</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null;

      case 'incomplete_visits':
        return incompleteVisits.length > 0 ? (
          <div key={id} className="card" style={{ marginBottom:20, borderLeft:'3px solid var(--danger)' }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <CalendarX size={15} color="var(--danger)" />
                <div className="section-title" style={{ margin:0, color:'var(--danger)' }}>Incomplete Maintenance Visits</div>
                <span className="badge badge-cancelled" style={{ marginLeft:4 }}>{incompleteVisits.length}</span>
              </div>
              <Link to="/maintenance-visits?filter=report_pending" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Visit</th><th>Scheduled Date</th><th>Engineer(s)</th><th>Status</th></tr></thead>
                <tbody>
                  {incompleteVisits.slice(0,8).map(v => {
                    const od = isOverdue(v.scheduled_date);
                    return (
                      <tr key={v.id}>
                        <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                        <td>{v.title}</td>
                        <td className={od ? 'overdue' : ''}>
                          {fmtDate(v.scheduled_date)}
                          {od && <span style={{ marginLeft:6, fontSize:11, color:'var(--danger)', fontWeight:600 }}>Overdue</span>}
                        </td>
                        <td style={{ color:'var(--gray-600)', fontSize:12 }}>{v.engineer_names || <span className="text-muted">Unassigned</span>}</td>
                        <td><StatusBadge s={v.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null;

      case 'mv_review':
        return reviewVisits.length > 0 ? (
          <div key={id} className="card" style={{ marginBottom:20, borderLeft:'3px solid var(--primary)' }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <ClipboardCheck size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0, color:'var(--primary)' }}>Reports to Approve for PM</div>
                <span className="badge badge-active" style={{ marginLeft:4 }}>{reviewVisits.length}</span>
              </div>
              <Link to="/maintenance-visits?filter=awaiting_review" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Reported by</th><th>Action</th></tr></thead>
                <tbody>
                  {reviewVisits.map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                      <td>{v.title}</td>
                      <td>{fmtDate(v.scheduled_date)}</td>
                      <td style={{ fontSize:12, color:'var(--gray-600)' }}>{v.report_sent_by_name || '—'}</td>
                      <td>
                        <button className="btn btn-sm btn-success"
                          style={{ display:'inline-flex', alignItems:'center', gap:4 }}
                          onClick={async () => { await api.markCustomerSent(v.id); load(); }}>
                          <Send size={12} /> Confirm Sent
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null;

      case 'mv_this_month':
        return visits.length > 0 ? (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Wrench size={15} color="var(--warning)" />
                <div className="section-title" style={{ margin:0 }}>Maintenance Visits — This Month</div>
                <span className="badge badge-on_hold" style={{ marginLeft:4 }}>{visits.length}</span>
              </div>
              <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Engineer(s)</th><th>Report</th></tr></thead>
                <tbody>
                  {visits.slice(0,5).map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                      <td>{v.title}</td>
                      <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                      <td style={{ color:'var(--gray-600)' }}>{v.engineer_names || <span className="text-muted">—</span>}</td>
                      <td>
                        {v.report_sent_to_customer
                          ? <span className="badge badge-done">Sent to PM</span>
                          : v.report_sent
                            ? <span className="badge badge-active">Report Complete</span>
                            : <span className="badge badge-open">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null;

      case 'projects':
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FolderOpen size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0 }}>Active Projects</div>
                <span className="badge badge-active">{active.length}</span>
              </div>
              <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {active.length === 0
              ? <p className="text-muted text-sm">No active projects</p>
              : <ul style={{ listStyle:'none' }}>
                  {active.slice(0,6).map(p => (
                    <li key={p.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                      display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <Link to={`/projects/${p.id}`} style={{ flex:1, fontWeight:600, minWidth:120, color:'var(--gray-900)' }}>{p.title}</Link>
                      <StatusBadge s={p.status} />
                      {p.deadline && (
                        <span className={'text-sm ' + (isOverdue(p.deadline) && p.status !== 'closed' ? 'overdue' : 'text-muted')}>
                          {fmtDate(p.deadline)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
            }
          </div>
        );

      case 'tasks': {
        const overdueCount = myOpen.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length;
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <ListTodo size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0 }}>Open Tasks</div>
                <span className="badge badge-open">{myOpen.length}</span>
                {overdueCount > 0 && (
                  <Link to="/tasks?filter=overdue"
                    style={{ display:'inline-flex', alignItems:'center', gap:3,
                      fontSize:11, fontWeight:700, color:'#b91c1c',
                      background:'#fef2f2', border:'1px solid #fecaca',
                      borderRadius:99, padding:'2px 8px', textDecoration:'none' }}>
                    ⚠ {overdueCount} overdue
                  </Link>
                )}
              </div>
              <Link to="/tasks" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {myOpen.length === 0
              ? <p className="text-muted text-sm">No open tasks</p>
              : <ul style={{ listStyle:'none' }}>
                  {myOpen.slice(0,6).map(t => (
                    <li key={t.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                      display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ flex:1, minWidth:120, color:'var(--gray-800)' }}>{t.title}</span>
                      {t.is_adhoc ? <span className="badge badge-adhoc">adhoc</span> : null}
                      <StatusBadge s={t.status} />
                      {t.deadline && (
                        <span className={'text-sm ' + (isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status) ? 'overdue' : 'text-muted')}>
                          {fmtDate(t.deadline)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
            }
          </div>
        );
      }

      default: return null;
    }
  }

  /* ── Engineer widgets ─────────────────────────────────── */
  function engineerWidget(id) {
    switch (id) {
      case 'stat_cards':
        return (
          <div key={id} className="grid-5" style={{ marginBottom:20 }}>
            <StatCard icon={FolderOpen}    iconBg="#eff6ff" iconColor="#3b82f6"
              value={active.length} label="Open Projects" valueColor="var(--primary)" to="/projects" />
            <StatCard icon={Wrench}        iconBg="#fef9c3" iconColor="#ca8a04"
              value={visits.length} label="Visits This Month" to="/maintenance-visits" />
            <StatCard icon={Clock}         iconBg="#fff7ed" iconColor="#f59e0b"
              value={visits.filter(v => v.status === 'scheduled').length}
              label="Scheduled" valueColor="var(--warning)" to="/maintenance-visits?filter=upcoming" />
            <StatCard icon={CheckCircle2}  iconBg="#f0fdf4" iconColor="#22c55e"
              value={visits.filter(v => v.status === 'completed').length}
              label="Completed" valueColor="var(--success)" to="/maintenance-visits?filter=past" />
            <StatCard icon={ClipboardCheck}
              iconBg={pendingReports.length ? '#fef2f2' : '#f0fdf4'}
              iconColor={pendingReports.length ? '#ef4444' : '#22c55e'}
              value={pendingReports.length} label="Reports Pending"
              valueColor={pendingReports.length ? 'var(--danger)' : 'var(--success)'}
              to="/maintenance-visits?filter=report_pending" />
          </div>
        );

      case 'due_week': {
        const now = new Date(); now.setHours(0,0,0,0);
        const weekEnd = new Date(now.getTime() + 7 * 86400000);
        const todayStr = now.toISOString().slice(0,10);
        const dueThisWeek = myOpen
          .filter(t => {
            if (!t.deadline) return false;
            const dl = new Date(t.deadline + 'T00:00:00');
            return dl >= now && dl <= weekEnd;
          })
          .sort((a, b) => a.deadline < b.deadline ? -1 : 1);
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Clock size={15} color="#f59e0b" />
                <div className="section-title" style={{ margin:0 }}>Due This Week</div>
                {dueThisWeek.length > 0 && <span className="badge badge-on_hold" style={{ marginLeft:4 }}>{dueThisWeek.length}</span>}
              </div>
              <Link to="/tasks?filter=due_week" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {dueThisWeek.length === 0
              ? <p className="text-muted text-sm">No tasks due in the next 7 days ✓</p>
              : <ul style={{ listStyle:'none' }}>
                  {dueThisWeek.map(t => {
                    const isToday = t.deadline.slice(0,10) === todayStr;
                    const isTomorrow = t.deadline.slice(0,10) === new Date(now.getTime()+86400000).toISOString().slice(0,10);
                    const label = isToday ? 'Due today' : isTomorrow ? 'Tomorrow' : fmtDate(t.deadline);
                    return (
                      <li key={t.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <PriorityBadge p={t.priority} />
                        <span style={{ flex:1, minWidth:120, color:'var(--gray-800)', fontSize:13 }}>{t.title}</span>
                        <span style={{
                          fontSize:11, fontWeight:700, flexShrink:0, borderRadius:99, padding:'2px 8px',
                          color: isToday ? '#b91c1c' : isTomorrow ? '#92400e' : '#78716c',
                          background: isToday ? '#fef2f2' : isTomorrow ? '#fffbeb' : 'var(--gray-100)',
                        }}>
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
            }
          </div>
        );
      }

      case 'pending_reports':
        return (
          <div key={id} className="card"
            style={{ marginBottom:20, borderLeft:`3px solid ${pendingReports.length ? 'var(--danger)' : 'var(--success)'}` }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Send size={15} color={pendingReports.length ? 'var(--danger)' : 'var(--success)'} />
                <div className="section-title"
                  style={{ margin:0, color: pendingReports.length ? 'var(--danger)' : 'var(--success)' }}>
                  Reports Pending — Send to Management
                </div>
                <span className={`badge ${pendingReports.length ? 'badge-cancelled' : 'badge-done'}`} style={{ marginLeft:4 }}>
                  {pendingReports.length === 0 ? 'All sent ✓' : pendingReports.length}
                </span>
              </div>
              <Link to="/maintenance-visits?filter=report_pending" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {pendingReports.length === 0
              ? <p className="text-muted text-sm" style={{ margin:0 }}>No pending reports — great job! 🎉</p>
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      {pendingReports.map(v => (
                        <tr key={v.id}>
                          <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                          <td><Link to="/maintenance-visits" style={{ color:'var(--gray-800)', fontWeight:500 }}>{v.title}</Link></td>
                          <td className={isOverdue(v.scheduled_date) ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                          <td><StatusBadge s={v.status} /></td>
                          <td>
                            <button className="btn btn-sm btn-primary"
                              style={{ display:'inline-flex', alignItems:'center', gap:4 }}
                              onClick={async () => { await api.markReportSent(v.id); load(); }}>
                              <Send size={11} /> Mark Sent
                            </button>
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

      case 'mv_this_month':
        return visits.length > 0 ? (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Wrench size={15} color="var(--warning)" />
                <div className="section-title" style={{ margin:0 }}>Maintenance Visits — This Month</div>
                <span className="badge badge-on_hold" style={{ marginLeft:4 }}>{visits.length}</span>
              </div>
              <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Report</th></tr></thead>
                <tbody>
                  {visits.slice(0,5).map(v => (
                    <tr key={v.id}>
                      <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                      <td>{v.title}</td>
                      <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                      <td>
                        {v.report_sent_to_customer
                          ? <span className="badge badge-done">Sent to PM</span>
                          : v.report_sent
                            ? <span className="badge badge-active">Report Complete</span>
                            : <span className="badge badge-open">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null;

      case 'projects':
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FolderOpen size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0 }}>My Projects</div>
                <span className="badge badge-active">{active.length}</span>
              </div>
              <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {active.length === 0
              ? <p className="text-muted text-sm">No active projects</p>
              : <ul style={{ listStyle:'none' }}>
                  {active.slice(0,6).map(p => (
                    <li key={p.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                      display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <Link to={`/projects/${p.id}`} style={{ flex:1, fontWeight:600, minWidth:120, color:'var(--gray-900)' }}>{p.title}</Link>
                      <StatusBadge s={p.status} />
                      {p.deadline && (
                        <span className={'text-sm ' + (isOverdue(p.deadline) && p.status !== 'closed' ? 'overdue' : 'text-muted')}>
                          {fmtDate(p.deadline)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
            }
          </div>
        );

      case 'tasks': {
        const engOverdueCount = myOpen.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length;
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <ListTodo size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0 }}>My Open Tasks</div>
                <span className="badge badge-open">{myOpen.length}</span>
                {engOverdueCount > 0 && (
                  <Link to="/tasks?filter=overdue"
                    style={{ display:'inline-flex', alignItems:'center', gap:3,
                      fontSize:11, fontWeight:700, color:'#b91c1c',
                      background:'#fef2f2', border:'1px solid #fecaca',
                      borderRadius:99, padding:'2px 8px', textDecoration:'none' }}>
                    ⚠ {engOverdueCount} overdue
                  </Link>
                )}
              </div>
              <Link to="/tasks" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {myOpen.length === 0
              ? <p className="text-muted text-sm">No open tasks</p>
              : <ul style={{ listStyle:'none' }}>
                  {myOpen.slice(0,6).map(t => (
                    <li key={t.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                      display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ flex:1, minWidth:120, color:'var(--gray-800)' }}>{t.title}</span>
                      {t.is_adhoc ? <span className="badge badge-adhoc">adhoc</span> : null}
                      <StatusBadge s={t.status} />
                      {t.deadline && (
                        <span className={'text-sm ' + (isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status) ? 'overdue' : 'text-muted')}>
                          {fmtDate(t.deadline)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
            }
          </div>
        );
      }

      default: return null;
    }
  }

  /* ── PM widgets ──────────────────────────────────────────── */
  function pmWidget(id) {
    const activeProjects = projects.filter(p => !['closed', 'cancelled'].includes(p.status));
    switch (id) {
      case 'stat_cards': {
        const overdueVisits = incompleteVisits.filter(v => isOverdue(v.scheduled_date));
        const completedThis = visits.filter(v => v.status === 'completed');
        return (
          <div key={id} className="grid-4" style={{ marginBottom:20 }}>
            <StatCard icon={FolderOpen}    iconBg="#eff6ff" iconColor="#3b82f6"
              value={activeProjects.length} label="Active Projects" to="/projects" />
            <StatCard icon={Wrench}        iconBg="#fef9c3" iconColor="#ca8a04"
              value={incompleteVisits.length} label="Visits Pending" to="/maintenance-visits" />
            <StatCard icon={AlertTriangle} iconBg="#fef2f2" iconColor="#ef4444"
              value={overdueVisits.length} label="Overdue Visits"
              valueColor={overdueVisits.length ? 'var(--danger)' : undefined} to="/maintenance-visits" />
            <StatCard icon={CheckCircle2}  iconBg="#f0fdf4" iconColor="#22c55e"
              value={completedThis.length} label="Completed (Month)"
              valueColor="var(--success)" to="/maintenance-visits" />
          </div>
        );
      }

      case 'pm_visits':
        return (
          <div key={id} className="card" style={{ marginBottom:20,
            borderLeft: `3px solid ${incompleteVisits.length ? 'var(--warning)' : 'var(--success)'}` }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <Wrench size={15} color={incompleteVisits.length ? 'var(--warning)' : 'var(--success)'} />
                <div className="section-title" style={{ margin:0 }}>Visits Awaiting Completion</div>
                {incompleteVisits.length > 0 && (
                  <span className="badge badge-on_hold" style={{ marginLeft:4 }}>{incompleteVisits.length}</span>
                )}
              </div>
              <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {incompleteVisits.length === 0
              ? <p className="text-muted text-sm" style={{ margin:0 }}>All visits are up to date — great! ✓</p>
              : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Customer</th><th>Visit</th><th>Scheduled</th><th>Status</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {incompleteVisits.slice(0, 8).map(v => {
                        const od = isOverdue(v.scheduled_date);
                        return (
                          <tr key={v.id}>
                            <td style={{ fontWeight:600 }}>{v.customer_name}</td>
                            <td>{v.title}</td>
                            <td className={od ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                            <td><StatusBadge s={v.status} /></td>
                            <td>
                              {v.status !== 'cancelled' && (
                                <button
                                  className="btn btn-sm btn-success"
                                  style={{ display:'inline-flex', alignItems:'center', gap:4 }}
                                  disabled={completingVisit === v.id}
                                  onClick={async () => {
                                    if (completingVisit) return;
                                    setCompletingVisit(v.id);
                                    try { await api.completeVisit(v.id); load(); }
                                    finally { setCompletingVisit(null); }
                                  }}
                                >
                                  <CheckCircle2 size={11} /> {completingVisit === v.id ? 'Saving…' : 'Mark Complete'}
                                </button>
                              )}
                            </td>
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

      case 'projects':
        return (
          <div key={id} className="card" style={{ marginBottom:20 }}>
            <div className="section-header">
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <FolderOpen size={15} color="var(--primary)" />
                <div className="section-title" style={{ margin:0 }}>All Active Projects</div>
                <span className="badge badge-active">{activeProjects.length}</span>
              </div>
              <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
            </div>
            {activeProjects.length === 0
              ? <p className="text-muted text-sm">No active projects</p>
              : <ul style={{ listStyle:'none' }}>
                  {activeProjects.slice(0, 8).map(p => (
                    <li key={p.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                      display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <Link to={`/projects/${p.id}`}
                        style={{ flex:1, fontWeight:600, minWidth:120, color:'var(--gray-900)' }}>{p.title}</Link>
                      <StatusBadge s={p.status} />
                      {p.deadline && (
                        <span className={'text-sm ' + (isOverdue(p.deadline) && p.status !== 'closed' ? 'overdue' : 'text-muted')}>
                          {fmtDate(p.deadline)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
            }
          </div>
        );

      default: return null;
    }
  }

  /* ── Render ───────────────────────────────────────────── */
  const renderFn = isManager ? managerWidget : isPlanner ? plannerWidget : isPM ? pmWidget : engineerWidget;

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {user.name.split(' ')[0]} 👋</h1>
          <div className="page-subtitle">
            {isPlanner ? 'Maintenance planning overview' : isPM ? 'Project & maintenance visit overview' : "Here's what's happening across your projects"}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowCustomizer(true)}
            style={{ display:'inline-flex', alignItems:'center', gap:5 }}
          >
            <Settings2 size={13} /> Customize
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load}
            style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-warning" style={{ marginBottom:20 }}>
          <AlertTriangle size={14} style={{ flexShrink:0 }} /> {error}
        </div>
      )}

      <OverdueBanner overdueProjects={overdueProjects} overdueTasks={overdueTasks} />

      {/* Widgets rendered in user-defined order */}
      {prefs.order.map(id => isVisible(id) ? renderFn(id) : null)}

      {/* Customizer modal */}
      {showCustomizer && (
        <WidgetCustomizer
          prefs={prefs}
          defs={defs}
          onToggle={toggle}
          onReorder={reorder}
          onReset={reset}
          onClose={() => setShowCustomizer(false)}
        />
      )}
    </div>
  );
}
