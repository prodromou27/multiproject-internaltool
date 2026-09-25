import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { fmtDate, isOverdue } from '../../components/Shared';

export function plannerWidget(id, ctx) {
  const { visits } = ctx;
  switch (id) {
    case 'stat_cards': {
      const upcoming    = visits.filter(v => v.status === 'scheduled');
      const completed   = visits.filter(v => v.status === 'completed');
      const rptPending  = visits.filter(v => v.status !== 'cancelled' && !v.report_sent);
      return (
        <div key={id} className="grid-4 mb-20">
          <div className="card stat">
            <div className="stat-value u-dc2e428">{upcoming.length}</div>
            <div className="stat-label">Scheduled</div>
          </div>
          <div className="card stat">
            <div className="stat-value u-5a45298">{completed.length}</div>
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
            <div className="flex-center gap-8">
              <Wrench size={15} color="var(--warning)" />
              <div className="section-title m-0">Upcoming Visits — This Month</div>
              <span className="badge badge-on_hold ml-4">{upcoming.length}</span>
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
                        <td className="font-semibold">{v.customer_name}</td>
                        <td>{v.title}</td>
                        <td className={isOverdue(v.scheduled_date) ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                        <td className="u-31d6430">{v.engineer_names || <span className="text-muted">—</span>}</td>
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
