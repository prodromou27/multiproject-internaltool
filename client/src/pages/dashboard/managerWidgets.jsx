import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Clock, Wrench, FolderOpen, ListTodo, Send, ClipboardCheck, CalendarX } from 'lucide-react';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../../components/Shared';
import { api } from '../../api';
import StatCard from './StatCard';

export function managerWidget(id, ctx) {
  const { active, incompleteVisits, load, myOpen, pendingClosure, reviewVisits, summary, visits } = ctx;
  switch (id) {
    case 'stat_cards':
      return summary ? (
        <div key={id} className="grid-4 mb-20">
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
            valueColor="var(--warning)" to="/approvals" />
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
        { label:'Red',   count:ragRed,   bg:'var(--danger-light)', text:'var(--tone-danger-text)', dot:'#ef4444' },
        { label:'Amber', count:ragAmber, bg:'var(--warning-light)', text:'var(--tone-warning-text)', dot:'#f59e0b' },
        { label:'Green', count:ragGreen, bg:'var(--success-light)', text:'var(--tone-success-text)', dot:'#22c55e' },
      ];
      return (
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <span style={{ width:8, height:8, borderRadius:'50%', background: ragRed ? '#ef4444' : ragAmber ? '#f59e0b' : '#22c55e', display:'inline-block' }} />
              <div className="section-title m-0">Project Health</div>
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
              <ul className="list-none">
                {atRisk.slice(0,5).map(p => (
                  <li key={p.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:p.rag_status==='red'?'#ef4444':'#f59e0b', flexShrink:0 }} />
                    <Link to={`/projects/${p.id}`} style={{ flex:1, fontWeight:600, color:'var(--gray-900)', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{p.title}</Link>
                    <StatusBadge entityType="project" s={p.status} />
                    {p.deadline && <span className={'text-sm '+(isOverdue(p.deadline)?'overdue':'text-muted')} style={{ flexShrink:0 }}>{fmtDate(p.deadline)}</span>}
                  </li>
                ))}
              </ul>
              {atRisk.length > 5 && <Link to="/projects" style={{ fontSize:12, color:'var(--primary)', display:'block', marginTop:8 }}>+{atRisk.length-5} more at-risk →</Link>}
            </>
          ) : (
            <p className="text-muted text-sm m-0">✓ All {ragGreen} active project{ragGreen !== 1 ? 's' : ''} are on track</p>
          )}
        </div>
      );
    }

    case 'task_overview':
      return summary ? (
        <div key={id} className="grid-2 mb-20">
          <div className="card">
            <div className="section-header">
              <div className="section-title m-0">Task Overview</div>
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
              <div className="section-title m-0">Engineer Workload</div>
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
            <div className="flex-center gap-8">
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
                    <td><Link to={`/projects/${p.id}`} className="font-semibold">{p.title}</Link></td>
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
            <div className="flex-center gap-8">
              <CalendarX size={15} color="var(--danger)" />
              <div className="section-title" style={{ margin:0, color:'var(--danger)' }}>Incomplete Maintenance Visits</div>
              <span className="badge badge-cancelled ml-4">{incompleteVisits.length}</span>
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
                      <td className="font-semibold">{v.customer_name}</td>
                      <td>{v.title}</td>
                      <td className={od ? 'overdue' : ''}>
                        {fmtDate(v.scheduled_date)}
                        {od && <span style={{ marginLeft:6, fontSize:11, color:'var(--danger)', fontWeight:600 }}>Overdue</span>}
                      </td>
                      <td style={{ color:'var(--gray-600)', fontSize:12 }}>{v.engineer_names || <span className="text-muted">Unassigned</span>}</td>
                      <td><StatusBadge entityType="visit" s={v.status} /></td>
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
            <div className="flex-center gap-8">
              <ClipboardCheck size={15} color="var(--primary)" />
              <div className="section-title" style={{ margin:0, color:'var(--primary)' }}>Reports to Approve for PM</div>
              <span className="badge badge-active ml-4">{reviewVisits.length}</span>
            </div>
            <Link to="/maintenance-visits?filter=awaiting_review" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Reported by</th><th>Action</th></tr></thead>
              <tbody>
                {reviewVisits.map(v => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.customer_name}</td>
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <Wrench size={15} color="var(--warning)" />
              <div className="section-title m-0">Maintenance Visits — This Month</div>
              <span className="badge badge-on_hold ml-4">{visits.length}</span>
            </div>
            <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Engineer(s)</th><th>Report</th></tr></thead>
              <tbody>
                {visits.slice(0,5).map(v => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.customer_name}</td>
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <FolderOpen size={15} color="var(--primary)" />
              <div className="section-title m-0">Active Projects</div>
              <span className="badge badge-active">{active.length}</span>
            </div>
            <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {active.length === 0
            ? <p className="text-muted text-sm">No active projects</p>
            : <ul className="list-none">
                {active.slice(0,6).map(p => (
                  <li key={p.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                    display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <Link to={`/projects/${p.id}`} style={{ flex:1, fontWeight:600, minWidth:120, color:'var(--gray-900)' }}>{p.title}</Link>
                    <StatusBadge entityType="project" s={p.status} />
                    {p.deadline && (
                      <span className={'text-sm ' + (isOverdue(p.deadline) && !['closed','cancelled'].includes(p.status) ? 'overdue' : 'text-muted')}>
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <ListTodo size={15} color="var(--primary)" />
              <div className="section-title m-0">Open Tasks</div>
              <span className="badge badge-open">{myOpen.length}</span>
              {overdueCount > 0 && (
                <Link to="/tasks?filter=overdue"
                  style={{ display:'inline-flex', alignItems:'center', gap:3,
                    fontSize:11, fontWeight:700, color:'var(--tone-danger-text)',
                    background:'var(--danger-light)', border:'1px solid #fecaca',
                    borderRadius:99, padding:'2px 8px', textDecoration:'none' }}>
                  ⚠ {overdueCount} overdue
                </Link>
              )}
            </div>
            <Link to="/tasks" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {myOpen.length === 0
            ? <p className="text-muted text-sm">No open tasks</p>
            : <ul className="list-none">
                {myOpen.slice(0,6).map(t => (
                  <li key={t.id} style={{ padding:'9px 0', borderBottom:'1px solid var(--gray-100)',
                    display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ flex:1, minWidth:120, color:'var(--gray-800)' }}>{t.title}</span>
                    {t.is_adhoc ? <span className="badge badge-adhoc">adhoc</span> : null}
                    <StatusBadge entityType="task" s={t.status} />
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
