import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Wrench, FolderOpen } from 'lucide-react';
import { StatusBadge, fmtDate, isOverdue } from '../../components/Shared';
import { api } from '../../api';
import StatCard from './StatCard';

export function pmWidget(id, ctx) {
  const { completingVisit, incompleteVisits, load, projects, setCompletingVisit, visits } = ctx;
  const activeProjects = projects.filter(p => !['closed', 'cancelled'].includes(p.status));
  switch (id) {
    case 'stat_cards': {
      const overdueVisits = incompleteVisits.filter(v => isOverdue(v.scheduled_date));
      const completedThis = visits.filter(v => v.status === 'completed');
      return (
        <div key={id} className="grid-4 mb-20">
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
        <div key={id} className="card u-49f14f8" style={{ borderLeft: `3px solid ${incompleteVisits.length ? 'var(--warning)' : 'var(--success)'}` }}>
          <div className="section-header">
            <div className="flex-center gap-8">
              <Wrench size={15} color={incompleteVisits.length ? 'var(--warning)' : 'var(--success)'} />
              <div className="section-title m-0">Visits Awaiting Completion</div>
              {incompleteVisits.length > 0 && (
                <span className="badge badge-on_hold ml-4">{incompleteVisits.length}</span>
              )}
            </div>
            <Link to="/maintenance-visits" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {incompleteVisits.length === 0
            ? <p className="text-muted text-sm m-0">All visits are up to date — great! ✓</p>
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
                          <td className="font-semibold">{v.customer_name}</td>
                          <td>{v.title}</td>
                          <td className={od ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                          <td><StatusBadge entityType="visit" s={v.status} /></td>
                          <td>
                            {v.status !== 'cancelled' && (
                              <button
                                className="btn btn-sm btn-success u-122b3a0"
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
        <div key={id} className="card mb-20">
          <div className="section-header">
            <div className="flex-center gap-8">
              <FolderOpen size={15} color="var(--primary)" />
              <div className="section-title m-0">All Active Projects</div>
              <span className="badge badge-active">{activeProjects.length}</span>
            </div>
            <Link to="/projects" style={{ fontSize:12, color:'var(--primary)' }}>View all →</Link>
          </div>
          {activeProjects.length === 0
            ? <p className="text-muted text-sm">No active projects</p>
            : <ul className="list-none">
                {activeProjects.slice(0, 8).map(p => (
                  <li key={p.id} className="u-710b0ff">
                    <Link to={`/projects/${p.id}`}
                      style={{ flex:1, fontWeight:600, minWidth:120, color:'var(--gray-900)' }}>{p.title}</Link>
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

    default: return null;
  }
}
