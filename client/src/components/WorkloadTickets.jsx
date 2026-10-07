import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useLiveVersion } from '../live';
import './WorkloadTickets.css';

/* Workload → By engineer: each engineer's tickets resolved (Request Tracker,
   any queue), tasks done, visits, service activities and time logged over the
   last 1, 3, 6 or 12 months, with what is open now. A row opens to the month
   by month detail. Server: GET /workload/engineers (workloadSummary.js). */

const PERIODS = [1, 3, 6, 12];
const KINDS = [['tickets', 'Tickets'], ['tasks', 'Tasks'], ['visits', 'Visits'], ['activities', 'Activities']];
const monthName = ym => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
const monthLong = ym => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const items = month => month.tickets + month.tasks + month.visits + month.activities;

function TicketCell({ tickets }) {
  if (!tickets.linked) return <td className="num"><Link to="/settings/ticketing" className="text-muted text-sm" title="Not linked to a Request Tracker user">Not linked</Link></td>;
  return <td className="num"><strong>{tickets.resolved}</strong>
    {tickets.sync_error ? <small className="wt-rt text-danger" title={tickets.sync_error}>RT read failed</small> : !tickets.synced_at && <small className="wt-rt">Waiting for RT…</small>}</td>;
}

export default function WorkloadTickets() {
  const [months, setMonths] = useState(3), [data, setData] = useState(null), [error, setError] = useState(''), [open, setOpen] = useState(null);
  const live = useLiveVersion();
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.workloadEngineers({ months }, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [months, live]);
  const peak = Math.max(1, ...(data?.engineers || []).flatMap(engineer => engineer.by_month.map(items)));
  return <section className="card wt" aria-label="Workload by engineer">
    <header className="wt-head">
      <div>
        <h2>By engineer</h2>
        {data && <p className="text-muted text-sm">{data.from} to {data.to}. Tickets resolved in Request Tracker (any queue, not rejected), tasks completed, maintenance visits completed, service activities and time logged.</p>}
      </div>
      <div className="wt-periods" role="group" aria-label="Period">
        {PERIODS.map(value => <button type="button" key={value} className={`btn btn-sm ${months === value ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={months === value} onClick={() => setMonths(value)}>
          {value === 1 ? 'Last month' : `${value} months`}</button>)}
      </div>
    </header>
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : <>
      {data.unlinked_engineers > 0 && <p className="alert alert-warning wt-unlinked">{data.unlinked_engineers} engineer{data.unlinked_engineers === 1 ? ' is' : 's are'} not linked to a Request Tracker user, so their tickets are not counted. <Link to="/settings/ticketing">Link them in Settings → Ticketing</Link>.</p>}
      {!data.engineers.length ? <p className="text-muted">No active engineers.</p> : <>
        <div className="wt-legend" aria-hidden="true">{KINDS.map(([key, label]) => <span key={key}><i className={`wt-k-${key}`} />{label}</span>)}</div>
        <div className="table-wrap"><table className="wt-table">
          <thead><tr>
            <th scope="col">Engineer</th><th scope="col" className="num">Tickets resolved</th><th scope="col" className="num">Tasks done</th><th scope="col" className="num">Visits</th>
            <th scope="col" className="num">Activities</th><th scope="col" className="num">Time logged</th><th scope="col">Open now</th><th scope="col">By month</th><th scope="col">Main customers</th>
          </tr></thead>
          <tbody>{data.engineers.map(engineer => {
            const expanded = open === engineer.id;
            return <Fragment key={engineer.id}>
              <tr>
                <th scope="row"><button type="button" className="wt-expand" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : engineer.id)}>
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{engineer.name}</button></th>
                <TicketCell tickets={engineer.tickets} />
                <td className="num"><strong>{engineer.tasks.done}</strong></td>
                <td className="num"><strong>{engineer.visits.completed}</strong></td>
                <td className="num"><strong>{engineer.activities.count}</strong><small className="wt-rt">{engineer.activities.hours} h</small></td>
                <td className="num">{engineer.logged_hours} h</td>
                <td className="text-sm wt-open">
                  {engineer.tickets.linked && <span>{engineer.tickets.open_now} ticket{engineer.tickets.open_now === 1 ? '' : 's'}</span>}
                  <span>{engineer.tasks.open} task{engineer.tasks.open === 1 ? '' : 's'}{engineer.tasks.overdue > 0 && <strong className="text-danger"> ({engineer.tasks.overdue} overdue)</strong>}</span>
                  {engineer.visits.upcoming > 0 && <span>{engineer.visits.upcoming} visit{engineer.visits.upcoming === 1 ? '' : 's'} planned</span>}
                </td>
                <td><div className="wt-bars" aria-label={engineer.by_month.map(month => `${monthName(month.month)}: ${items(month)} items`).join(', ')}>
                  {engineer.by_month.map(month => <span key={month.month} className="wt-bar" title={`${monthLong(month.month)}: ${KINDS.map(([key, label]) => `${month[key]} ${label.toLowerCase()}`).join(', ')}`}>
                    <span className="wt-stack">{KINDS.map(([key]) => month[key] > 0 && <i key={key} className={`wt-k-${key}`} style={{ height: `${Math.max(1, Math.round(month[key] / peak * 30))}px` }} />)}</span>
                    <small>{monthName(month.month)}</small></span>)}
                </div></td>
                <td className="text-sm">{engineer.customers.length ? engineer.customers.slice(0, 3).map(customer => customer.name).join(', ') : <span className="text-muted">—</span>}</td>
              </tr>
              {expanded && <tr className="wt-detail"><td colSpan={9}>
                <table className="wt-months">
                  <thead><tr><th scope="col">Month</th>{KINDS.map(([key, label]) => <th scope="col" key={key} className="num">{label}</th>)}<th scope="col" className="num">Activity hours</th></tr></thead>
                  <tbody>{engineer.by_month.map(month => <tr key={month.month}><th scope="row">{monthLong(month.month)}</th>{KINDS.map(([key]) => <td key={key} className="num">{month[key]}</td>)}<td className="num">{month.hours}</td></tr>)}</tbody>
                </table>
                <p className="text-sm">
                  {engineer.tickets.linked && <>RT user <strong>{engineer.rt_username}</strong>{engineer.tickets.avg_days_to_resolve !== null && engineer.tickets.avg_days_to_resolve !== undefined && <> · {engineer.tickets.avg_days_to_resolve} days on average to resolve a ticket</>}. </>}
                  {engineer.customers.length > 0 && <>Work for: {engineer.customers.map(customer => `${customer.name} (${customer.count})`).join(', ')}.</>}
                </p>
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
      </>}
    </>}
  </section>;
}
