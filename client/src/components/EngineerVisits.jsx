import { Link } from 'react-router-dom';
import { Send, Wrench } from 'lucide-react';
import { StatusBadge, fmtDate, isOverdue } from './Shared';
import { api } from '../api';
import AddToCalendarButton from './AddToCalendarButton';

/* My Work: visit reports still to send to management, and this month's visits.
   Each shows only when it has something in it. */

export function PendingVisitReports({ reports, onSent }) {
  if (!reports.length) return null;
  return <div className="card u-49f14f8" style={{ borderLeft: '3px solid var(--danger)' }}>
    <div className="section-header">
      <div className="flex-center gap-8">
        <Send size={15} color="var(--danger)" />
        <div className="section-title u-1169661 u-497726e">Reports Pending — Send to Management</div>
        <span className="badge badge-cancelled u-46cec89">{reports.length}</span>
      </div>
      <Link to="/maintenance-visits?filter=report_pending" style={{ fontSize: 12, color: 'var(--primary)' }}>View all →</Link>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{reports.map(v => <tr key={v.id}>
        <td className="font-semibold">{v.customer_name}</td>
        <td><Link to="/maintenance-visits" style={{ color: 'var(--gray-800)', fontWeight: 500 }}>{v.title}</Link></td>
        <td className={isOverdue(v.scheduled_date) ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
        <td><StatusBadge entityType="visit" s={v.status} /></td>
        <td><button className="btn btn-sm btn-primary u-122b3a0" onClick={async () => { await api.markReportSent(v.id); onSent(); }}><Send size={11} /> Mark Sent</button></td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}

export function MonthVisits({ visits }) {
  if (!visits.length) return null;
  return <div className="card mb-20">
    <div className="section-header">
      <div className="flex-center gap-8">
        <Wrench size={15} color="var(--warning)" />
        <div className="section-title m-0">Maintenance Visits — This Month</div>
        <span className="badge badge-on_hold ml-4">{visits.length}</span>
      </div>
      <Link to="/maintenance-visits" style={{ fontSize: 12, color: 'var(--primary)' }}>View all →</Link>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Customer</th><th>Visit</th><th>Date</th><th>Report</th><th><span className="sr-only">Calendar</span></th></tr></thead>
      <tbody>{visits.slice(0, 5).map(v => <tr key={v.id}>
        <td className="font-semibold">{v.customer_name}</td>
        <td>{v.title}</td>
        <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
        <td>{v.report_sent_to_customer ? <span className="badge badge-done">Sent to PM</span> : v.report_sent ? <span className="badge badge-active">Report Complete</span> : <span className="badge badge-open">Pending</span>}</td>
        <td>{v.status !== 'cancelled' && <AddToCalendarButton visitId={v.id} title={v.title} compact />}</td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}
