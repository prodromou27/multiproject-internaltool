import { useEffect,useMemo,useState } from 'react';
import { ExternalLink,RefreshCw } from 'lucide-react';
import { api } from '../api';
import ManagedCustomerReportBuilder from './ManagedCustomerReportBuilder';
import { fmtDateTime } from './Shared';
import { Surface } from './EnterpriseUI';
import { localDateISO } from '../utils/dates';
import { useLiveRefresh } from '../live';

/* Customer 360's Tickets and Reports tabs for a managed customer (formerly the
   separate Managed Customers dashboard). */

// Periods are calendar days in the user's own time zone, matching the local
// dates activities, tasks and visits are recorded with (not UTC).
const iso=date => localDateISO(date);
export function period(preset,from,to) {
  const now=new Date(),year=now.getFullYear(),month=now.getMonth();
  if (preset==='today') return { from:iso(now),to:iso(now) };
  if (preset==='week') { const start=new Date(year,month,now.getDate()-((now.getDay()+6)%7));return { from:iso(start),to:iso(now) }; }
  if (preset==='last_month') return { from:iso(new Date(year,month-1,1)),to:iso(new Date(year,month,0)) };
  if (preset==='quarter') { const first=Math.floor(month/3)*3;return { from:iso(new Date(year,first,1)),to:iso(now) }; }
  if (preset==='previous_quarter') { const first=Math.floor(month/3)*3;return { from:iso(new Date(year,first-3,1)),to:iso(new Date(year,first,0)) }; }
  if (preset==='year') return { from:`${year}-01-01`,to:iso(now) };
  if (preset==='custom') return { from,to };
  return { from:iso(new Date(year,month,1)),to:iso(now) };
}

const PRESETS=[['today','Today'],['week','This week'],['month','This month'],['last_month','Last month'],['quarter','Current quarter'],['previous_quarter','Previous quarter'],['year','Current year'],['custom','Custom']];

function usePeriod() {
  const [preset,setPreset]=useState('month'),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const range=useMemo(() => period(preset,from,to),[preset,from,to]);
  return { preset,setPreset,from,setFrom,to,setTo,range,usePeriodOf:due => { setFrom(due.from);setTo(due.to);setPreset('custom'); } };
}

function PeriodPicker({ value,onRefresh }) {
  return <Surface title="Reporting period" actions={<button className="btn btn-ghost btn-sm" onClick={onRefresh}><RefreshCw size={13} /> Refresh</button>}>
    <div className="filter-bar">{PRESETS.map(([key,label]) => <button key={key} type="button" className={`filter-pill${value.preset===key?' active':''}`} onClick={() => value.setPreset(key)}>{label}</button>)}
      {value.preset==='custom' && <><input type="date" aria-label="From" value={value.from} onChange={event => value.setFrom(event.target.value)} /><input type="date" aria-label="To" value={value.to} onChange={event => value.setTo(event.target.value)} /></>}</div>
  </Surface>;
}

function age(ticket) {
  if (!ticket.created_at_external) return '—';
  const end=ticket.resolved_at_external || ticket.closed_at_external || new Date().toISOString();
  const days=Math.max(0,Math.floor((new Date(end)-new Date(ticket.created_at_external))/86400000));
  return `${days}d`;
}
const Metric=({ label,value,note }) => <article className="ui-metric"><span>{label}</span><strong>{value ?? 0}</strong>{note && <small>{note}</small>}</article>;

function Distribution({ title,rows,valueKey='count',format=value => value }) {
  const max=Math.max(...rows.map(row => row[valueKey]),1);
  return <section className="card u-8e11ed6"><h3 className="u-53fc0b5">{title}</h3>{rows.some(row => row[valueKey]) ? <div className="u-9aa121f">{rows.filter(row => row[valueKey]).map(row => <div key={row.name}><div className="text-sm u-20fee6b"><span>{row.name}</span><strong>{format(row[valueKey])}</strong></div><div className="progress-bar u-fcfb7a6"><div className="progress-bar-fill" style={{ width:`${row[valueKey]/max*100}%` }} /></div></div>)}</div> : <p className="text-muted text-sm">No matching records.</p>}</section>;
}

function TicketFilters({ filters,setFilters,facets }) {
  const change=(key,value) => setFilters(current => ({ ...current,[key]:value,page:1 }));
  return <div className="card filter-bar u-87c136d">
    <input value={filters.search} onChange={event => change('search',event.target.value)} placeholder="Search ticket number or subject..." aria-label="Search tickets" className="u-bec7b1d" />
    <select value={filters.status} onChange={event => change('status',event.target.value)} aria-label="Ticket status"><option value="">All statuses</option>{facets.statuses.map(value => <option key={value}>{value}</option>)}</select>
    <select value={filters.priority} onChange={event => change('priority',event.target.value)} aria-label="Ticket priority"><option value="">All priorities</option>{facets.priorities.map(value => <option key={value}>{value}</option>)}</select>
    <select value={filters.owner} onChange={event => change('owner',event.target.value)} aria-label="Ticket owner"><option value="">All owners</option>{facets.owners.map(value => <option key={value}>{value}</option>)}</select>
    <label className="text-sm">Created from <input type="date" value={filters.from} onChange={event => change('from',event.target.value)} /></label>
    <label className="text-sm">to <input type="date" value={filters.to} onChange={event => change('to',event.target.value)} /></label>
  </div>;
}

function TicketAnalytics({ id,range,refresh }) {
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(() => {
    if (!range.from || !range.to) { setData(null);return; }
    const controller=new AbortController();setError('');
    api.managedCustomerTicketAnalytics(id,range,{ signal:controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  },[id,range,refresh]);
  if (!range.from || !range.to) return <div className="card empty"><p>Select both custom dates to load ticket analytics.</p></div>;
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <div className="skeleton-table"><span /><span /></div>;
  return <div className="u-13f24e7"><h2 className="u-afc5f97">Current ticket backlog</h2><div className="u-e49cec5"><Metric label="Total open" value={data.current.total_open} /><Metric label="High / critical" value={data.current.priorities.filter(row => ['High','Critical'].includes(row.name)).reduce((sum,row) => sum+row.count,0)} /></div>
    <div className="u-b5f0188"><Distribution title="Open by status" rows={data.current.statuses} /><Distribution title="Open by priority" rows={data.current.priorities} /><Distribution title="Open ticket aging" rows={data.current.aging} /><Distribution title="Open by owner" rows={data.current.owners} /></div>
    <h2 className="u-afc5f97">Selected period, {data.period.from} to {data.period.to}</h2><div className="u-43e3628"><Metric label="Created" value={data.period.created} /><Metric label="Resolved" value={data.period.resolved} /><Metric label="Closed" value={data.period.closed} /><Metric label="Rejected" value={data.period.rejected} /><Metric label="SLA breaches" value={data.period.sla_breaches} /></div>
  </div>;
}

function TicketList({ id,refresh }) {
  const [filters,setFilters]=useState({ search:'',status:'',priority:'',owner:'',from:'',to:'',page:1 });
  const [data,setData]=useState({ rows:[],total:0,page:1,page_size:25,facets:{ statuses:[],priorities:[],owners:[] } });
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(() => {
    const controller=new AbortController(),timer=setTimeout(() => {
      setLoading(true);setError('');
      const params=Object.fromEntries(Object.entries({ ...filters,page_size:25 }).filter(([,value]) => value!==''));
      api.managedCustomerTickets(id,params,{ signal:controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    },250);
    return () => { clearTimeout(timer);controller.abort(); };
  },[id,filters,refresh]);
  const pages=Math.max(1,Math.ceil(data.total/data.page_size));
  return <>
    <TicketFilters filters={filters} setFilters={setFilters} facets={data.facets} />
    {error ? <div className="error-msg" role="alert">{error}</div> : loading && !data.rows.length ? <div className="skeleton-table"><span /><span /><span /></div> : !data.rows.length ? <div className="card empty"><p>No tickets match these filters.</p></div> : <div className="card table-wrap"><table>
      <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th><th>Owner</th><th>Created</th><th>Updated</th><th>Age</th><th>Source</th></tr></thead>
      <tbody>{data.rows.map(ticket => <tr key={ticket.id}><td className="u-9b6e378">{ticket.ticket_number}</td><td>{ticket.subject}</td><td>{ticket.normalized_status}</td><td>{ticket.normalized_priority || '—'}</td><td>{ticket.owner_name || 'Unassigned'}</td><td className="text-sm">{fmtDateTime(ticket.created_at_external)}</td><td className="text-sm">{fmtDateTime(ticket.updated_at_external)}</td><td>{age(ticket)}</td><td>{ticket.external_url ? <a href={ticket.external_url} target="_blank" rel="noreferrer" aria-label={`Open ticket ${ticket.ticket_number} in Request Tracker`}><ExternalLink size={15} /></a> : '—'}</td></tr>)}</tbody>
    </table></div>}
    <nav className="approval-pagination" aria-label="Ticket pages"><span>{data.total} ticket{data.total===1?'':'s'}, page {data.page} of {pages}</span><button className="btn btn-ghost btn-sm" disabled={loading || filters.page===1} onClick={() => setFilters(current => ({ ...current,page:current.page-1 }))}>Previous</button><button className="btn btn-ghost btn-sm" disabled={loading || filters.page>=pages} onClick={() => setFilters(current => ({ ...current,page:current.page+1 }))}>Next</button></nav>
  </>;
}

/** Customer 360 → Tickets: the customer's Request Tracker backlog and history. */
export function CustomerTickets({ customerId }) {
  const value=usePeriod(),[refresh,setRefresh]=useState(0);
  useLiveRefresh(() => setRefresh(count => count+1));
  return <div className="cs-managed-section">
    <PeriodPicker value={value} onRefresh={() => setRefresh(count => count+1)} />
    <TicketAnalytics id={customerId} range={value.range} refresh={refresh} />
    <TicketList id={customerId} refresh={refresh} />
  </div>;
}

/** Customer 360 → Reports: build, review and send the customer's service reports. */
export function CustomerReports({ customerId }) {
  const value=usePeriod(),[refresh,setRefresh]=useState(0),[due,setDue]=useState(null);
  useLiveRefresh(() => setRefresh(count => count+1));
  const { from,to }=value.range;
  useEffect(() => {
    if (!from || !to) return undefined;
    const controller=new AbortController();
    api.managedCustomerOverview(customerId,{ from,to },{ signal:controller.signal }).then(data => { if (!controller.signal.aborted) setDue(data?.report_due || null); }).catch(() => {});
    return () => controller.abort();
  },[customerId,from,to,refresh]);
  return <div className="cs-managed-section">
    <PeriodPicker value={value} onRefresh={() => setRefresh(count => count+1)} />
    <ManagedCustomerReportBuilder customerId={customerId} range={value.range} due={due} onUsePeriod={value.usePeriodOf} onChanged={() => setRefresh(count => count+1)} />
  </div>;
}
