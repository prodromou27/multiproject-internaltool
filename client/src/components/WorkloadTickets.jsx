import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLiveVersion } from '../live';
import './WorkloadTickets.css';

/* Workload → Tickets: what each engineer resolved in Request Tracker over the
   last 1, 3, 6 or 12 months. RT users are linked to engineers in Settings →
   Ticketing. Server: GET /workload/tickets (ticketOwners.js). */

const PERIODS = [1, 3, 6, 12];
const monthName = ym => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });

export default function WorkloadTickets() {
  const [months, setMonths] = useState(3), [data, setData] = useState(null), [error, setError] = useState('');
  const live = useLiveVersion();
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.workloadTickets({ months }, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [months, live]);
  const peak = Math.max(1, ...(data?.engineers || []).flatMap(engineer => engineer.by_month.map(month => month.count)));
  return <section className="card wt" aria-label="Tickets resolved">
    <header className="wt-head">
      <div>
        <h2>Tickets resolved</h2>
        {data && <p className="text-muted text-sm">{data.from} to {data.to}. Tickets resolved or closed in Request Tracker (not rejected) by the engineer who owned them, in any queue.</p>}
      </div>
      <div className="wt-periods" role="group" aria-label="Period">
        {PERIODS.map(value => <button type="button" key={value} className={`btn btn-sm ${months === value ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={months === value} onClick={() => setMonths(value)}>
          {value === 1 ? 'Last month' : `${value} months`}</button>)}
      </div>
    </header>
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : <>
      {data.unlinked_engineers > 0 && <p className="alert alert-warning wt-unlinked">{data.unlinked_engineers} engineer{data.unlinked_engineers === 1 ? ' is' : 's are'} not linked to a Request Tracker user. <Link to="/settings/ticketing">Link them in Settings → Ticketing</Link>.</p>}
      {!data.engineers.length ? <p className="text-muted">No one is linked to a Request Tracker user yet. Choose each engineer's RT user in <Link to="/settings/ticketing">Settings → Ticketing</Link>.</p> :
        <div className="table-wrap"><table className="wt-table">
          <thead><tr><th scope="col">Engineer</th><th scope="col" className="num">Resolved</th><th scope="col">By month</th><th scope="col" className="num">Avg. days to resolve</th><th scope="col" className="num">Open now</th><th scope="col">Main customers or queues</th></tr></thead>
          <tbody>{data.engineers.map(engineer => <tr key={engineer.id}>
            <th scope="row">{engineer.name}<small className="wt-rt">{engineer.sync_error ? <span className="text-danger" title={engineer.sync_error}>RT read failed</span> : engineer.synced_at ? `RT: ${engineer.rt_username}` : 'Waiting for RT…'}</small></th>
            <td className="num"><strong>{engineer.resolved}</strong></td>
            <td><div className="wt-bars" aria-label={engineer.by_month.map(month => `${monthName(month.month)} ${month.count}`).join(', ')}>
              {engineer.by_month.map(month => <span key={month.month} className="wt-bar" title={`${monthName(month.month)}: ${month.count}`}>
                <i style={{ height: `${Math.round(month.count / peak * 30)}px` }} /><small>{monthName(month.month)}</small></span>)}
            </div></td>
            <td className="num">{engineer.avg_days_to_resolve ?? '—'}</td>
            <td className="num">{engineer.open_now}</td>
            <td className="text-sm">{engineer.customers.length ? engineer.customers.slice(0, 3).map(customer => `${customer.name} (${customer.count})`).join(', ') : <span className="text-muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
  </section>;
}
