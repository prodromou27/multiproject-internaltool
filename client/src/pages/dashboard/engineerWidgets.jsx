import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Wrench, FolderOpen, ListTodo, Send, ClipboardCheck, Building2, Ticket } from 'lucide-react';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../../components/Shared';
import { api } from '../../api';
import StatCard from './StatCard';

export function engineerWidget(id, ctx) {
  const { active, load, myManagedCustomers, myOpen, pendingReports, visits } = ctx;
  switch (id) {
    case 'stat_cards':
      return (
        <div key={id} className="grid-5 mb-20">
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <Clock size={15} color="#f59e0b" />
              <div className="section-title m-0">Due This Week</div>
              {dueThisWeek.length > 0 && <span className="badge badge-on_hold ml-4">{dueThisWeek.length}</span>}
            </div>
            <Link to="/tasks?filter=due_week" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {dueThisWeek.length === 0
            ? <p className="text-muted text-sm">No tasks due in the next 7 days ✓</p>
            : <ul className="list-none">
                {dueThisWeek.map(t => {
                  const isToday = t.deadline.slice(0,10) === todayStr;
                  const isTomorrow = t.deadline.slice(0,10) === new Date(now.getTime()+86400000).toISOString().slice(0,10);
                  const label = isToday ? 'Due today' : isTomorrow ? 'Tomorrow' : fmtDate(t.deadline);
                  return (
                    <li key={t.id} className="u-710b0ff">
                      <PriorityBadge p={t.priority} />
                      <span className="u-06d0741">{t.title}</span>
                      <span className="u-2bde71f" style={{ color: isToday ? '#b91c1c' : isTomorrow ? '#92400e' : '#78716c', background: isToday ? '#fef2f2' : isTomorrow ? '#fffbeb' : 'var(--gray-100)' }}>
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
        <div key={id} className="card u-49f14f8"
          style={{ borderLeft:`3px solid ${pendingReports.length ? 'var(--danger)' : 'var(--success)'}` }}>
          <div className="section-header">
            <div className="flex-center gap-8">
              <Send size={15} color={pendingReports.length ? 'var(--danger)' : 'var(--success)'} />
              <div className="section-title u-1169661"
                style={{ color: pendingReports.length ? 'var(--danger)' : 'var(--success)' }}>
                Reports Pending — Send to Management
              </div>
              <span className={`badge ${pendingReports.length ? 'badge-cancelled' : 'badge-done'} u-46cec89`}>
                {pendingReports.length === 0 ? 'All sent ✓' : pendingReports.length}
              </span>
            </div>
            <Link to="/maintenance-visits?filter=report_pending" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {pendingReports.length === 0
            ? <p className="text-muted text-sm m-0">No pending reports — great job! 🎉</p>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {pendingReports.map(v => (
                      <tr key={v.id}>
                        <td className="font-semibold">{v.customer_name}</td>
                        <td><Link to="/maintenance-visits" style={{ color:'var(--gray-800)', fontWeight:500 }}>{v.title}</Link></td>
                        <td className={isOverdue(v.scheduled_date) ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                        <td><StatusBadge entityType="visit" s={v.status} /></td>
                        <td>
                          <button className="btn btn-sm btn-primary u-122b3a0"
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
              <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Report</th></tr></thead>
              <tbody>
                {visits.slice(0,5).map(v => (
                  <tr key={v.id}>
                    <td className="font-semibold">{v.customer_name}</td>
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <FolderOpen size={15} color="var(--primary)" />
              <div className="section-title m-0">My Projects</div>
              <span className="badge badge-active">{active.length}</span>
            </div>
            <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {active.length === 0
            ? <p className="text-muted text-sm">No active projects</p>
            : <ul className="list-none">
                {active.slice(0,6).map(p => (
                  <li key={p.id} className="u-710b0ff">
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
      const engOverdueCount = myOpen.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length;
      return (
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <ListTodo size={15} color="var(--primary)" />
              <div className="section-title m-0">My Open Tasks</div>
              <span className="badge badge-open">{myOpen.length}</span>
              {engOverdueCount > 0 && (
                <Link to="/tasks?filter=overdue"
                  style={{ display:'inline-flex', alignItems:'center', gap:3,
                    fontSize:11, fontWeight:700, color:'var(--tone-danger-text)',
                    background:'var(--danger-light)', border:'1px solid #fecaca',
                    borderRadius:99, padding:'2px 8px', textDecoration:'none' }}>
                  ⚠ {engOverdueCount} overdue
                </Link>
              )}
            </div>
            <Link to="/tasks" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {myOpen.length === 0
            ? <p className="text-muted text-sm">No open tasks</p>
            : <ul className="list-none">
                {myOpen.slice(0,6).map(t => (
                  <li key={t.id} className="u-710b0ff">
                    <span className="u-036d7cd">{t.title}</span>
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

    case 'managed_customers': {
      if (!myManagedCustomers.length) return null;
      return (
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <Building2 size={15} color="var(--primary)" />
              <div className="section-title m-0">My Managed Customers</div>
              <span className="badge badge-open">{myManagedCustomers.length}</span>
            </div>
            <span className="text-sm text-muted">Your team is the responsible team</span>
          </div>
          <ul className="list-none">
            {myManagedCustomers.map(c => (
              <li key={c.id} className="u-710b0ff">
                <Link to={`/customers/${c.id}/service-profile`} className="font-semibold" style={{ flex:1, minWidth:120 }}>{c.name}</Link>
                {c.ticketing_enabled
                  ? <span className={'badge ' + (c.open_tickets ? 'badge-open' : 'badge-done')} title="Open tickets"><Ticket size={11} /> {c.open_tickets}</span>
                  : <span className="badge badge-on_hold">No ticketing</span>}
                {c.activities_this_month > 0 && <span className="text-sm text-muted">{c.activities_this_month} activities this month</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    default: return null;
  }
}
