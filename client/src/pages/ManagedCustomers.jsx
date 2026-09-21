import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,Building2,ExternalLink,RefreshCw } from 'lucide-react';
import { Link,useParams } from 'react-router-dom';
import { api } from '../api';

const iso=date => date.toISOString().slice(0,10);
const formatDate=value => value ? new Date(value).toLocaleString() : '—';
function period(preset,from,to) {
  const now=new Date();
  if (preset==='today') return { from:iso(now),to:iso(now) };
  if (preset==='week') { const start=new Date(now);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));return { from:iso(start),to:iso(now) }; }
  if (preset==='last_month') return { from:iso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1))),to:iso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0))) };
  if (preset==='quarter') { const month=Math.floor(now.getUTCMonth()/3)*3;return { from:iso(new Date(Date.UTC(now.getUTCFullYear(),month,1))),to:iso(now) }; }
  if (preset==='previous_quarter') { const month=Math.floor(now.getUTCMonth()/3)*3;return { from:iso(new Date(Date.UTC(now.getUTCFullYear(),month-3,1))),to:iso(new Date(Date.UTC(now.getUTCFullYear(),month,0))) }; }
  if (preset==='year') return { from:`${now.getUTCFullYear()}-01-01`,to:iso(now) };
  if (preset==='custom') return { from,to };
  return { from:`${iso(now).slice(0,7)}-01`,to:iso(now) };
}
function age(ticket) {
  if (!ticket.created_at_external) return '—';
  const end=ticket.resolved_at_external || ticket.closed_at_external || new Date().toISOString();
  const days=Math.max(0,Math.floor((new Date(end)-new Date(ticket.created_at_external))/86400000));
  return `${days}d`;
}
const Metric=({ label,value,note }) => <div className="card" style={{ padding:18 }}><div className="text-muted text-sm">{label}</div><div style={{ fontSize:28,fontWeight:750,marginTop:4 }}>{value ?? 0}</div>{note && <div className="text-muted text-sm mt-4">{note}</div>}</div>;

function Landing() {
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');
  useEffect(() => { const controller=new AbortController();api.managedCustomers({ signal:controller.signal }).then(result => setRows(result.rows || [])).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });return () => controller.abort(); },[]);
  const filtered=rows.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="page"><div className="page-header"><div><h1 className="page-title"><Building2 size={22} /> Managed Customers</h1><p className="text-muted text-sm mt-4">Current service health across customers enrolled in Managed Services</p></div></div>
    <div className="card" style={{ marginBottom:16 }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search managed customers..." style={{ maxWidth:360 }} /></div>
    {error ? <div className="error-msg" role="alert">{error}</div> : loading ? <div className="skeleton-table"><span /><span /><span /></div> : !filtered.length ? <div className="card empty"><p>No managed customers match this view.</p><p className="text-muted text-sm">Enable Managed Services from a customer’s Customer 360 profile.</p></div> : <div className="card table-wrap"><table><thead><tr><th>Customer</th><th>Open tickets</th><th>Pending</th><th>Activities this month</th><th>Open tasks</th><th>Active projects</th><th>Last ticket sync</th><th>Service manager</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><Link to={`/managed-customers/${row.id}`} style={{ fontWeight:700 }}>{row.name}</Link><div className="text-muted text-sm">{row.responsible_team || 'No responsible team'}</div></td><td>{row.open_tickets}</td><td>{row.pending_tickets}</td><td>{row.activities_this_month}</td><td>{row.open_tasks}</td><td>{row.active_projects}</td><td className="text-sm">{row.last_successful_sync_at || 'Never'}</td><td>{row.service_manager || 'Unassigned'}</td></tr>)}</tbody></table></div>}
  </div>;
}

function TicketFilters({ filters,setFilters,facets }) {
  const change=(key,value) => setFilters(current => ({ ...current,[key]:value,page:1 }));
  return <div className="card filter-bar" style={{ marginBottom:16 }}>
    <input value={filters.search} onChange={event => change('search',event.target.value)} placeholder="Search ticket number or subject..." style={{ minWidth:260 }} />
    <select value={filters.status} onChange={event => change('status',event.target.value)} aria-label="Ticket status"><option value="">All statuses</option>{facets.statuses.map(value => <option key={value}>{value}</option>)}</select>
    <select value={filters.priority} onChange={event => change('priority',event.target.value)} aria-label="Ticket priority"><option value="">All priorities</option>{facets.priorities.map(value => <option key={value}>{value}</option>)}</select>
    <select value={filters.owner} onChange={event => change('owner',event.target.value)} aria-label="Ticket owner"><option value="">All owners</option>{facets.owners.map(value => <option key={value}>{value}</option>)}</select>
    <label className="text-sm">Created from <input type="date" value={filters.from} onChange={event => change('from',event.target.value)} /></label>
    <label className="text-sm">to <input type="date" value={filters.to} onChange={event => change('to',event.target.value)} /></label>
  </div>;
}

function Distribution({ title,rows }) {
  const max=Math.max(...rows.map(row => row.count),1);
  return <section className="card" style={{ padding:18 }}><h3 style={{ fontSize:14,marginBottom:14 }}>{title}</h3>{rows.some(row => row.count) ? <div style={{ display:'grid',gap:10 }}>{rows.filter(row => row.count).map(row => <div key={row.name}><div className="text-sm" style={{ display:'flex',justifyContent:'space-between',gap:12 }}><span>{row.name}</span><strong>{row.count}</strong></div><div className="progress-bar" style={{ height:6,marginTop:5 }}><div className="progress-bar-fill" style={{ width:`${row.count/max*100}%` }} /></div></div>)}</div> : <p className="text-muted text-sm">No matching tickets.</p>}</section>;
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
  return <div style={{ marginBottom:22 }}><h2 style={{ fontSize:15,marginBottom:10 }}>Current ticket backlog</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:18 }}><Metric label="Total open" value={data.current.total_open} /><Metric label="High / critical" value={data.current.priorities.filter(row => ['High','Critical'].includes(row.name)).reduce((sum,row) => sum+row.count,0)} /></div>
    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12,marginBottom:22 }}><Distribution title="Open by status" rows={data.current.statuses} /><Distribution title="Open by priority" rows={data.current.priorities} /><Distribution title="Open ticket aging" rows={data.current.aging} /><Distribution title="Open by owner" rows={data.current.owners} /></div>
    <h2 style={{ fontSize:15,marginBottom:10 }}>Selected period · {data.period.from} to {data.period.to}</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20 }}><Metric label="Created" value={data.period.created} /><Metric label="Resolved" value={data.period.resolved} /><Metric label="Closed" value={data.period.closed} /><Metric label="Rejected" value={data.period.rejected} /><Metric label="SLA breaches" value={data.period.sla_breaches} /></div>
  </div>;
}

function Tickets({ id,range,refresh }) {
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
    <TicketAnalytics id={id} range={range} refresh={refresh} />
    <TicketFilters filters={filters} setFilters={setFilters} facets={data.facets} />
    {error ? <div className="error-msg" role="alert">{error}</div> : loading && !data.rows.length ? <div className="skeleton-table"><span /><span /><span /></div> : !data.rows.length ? <div className="card empty"><p>No tickets match these filters.</p></div> : <div className="card table-wrap"><table>
      <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th><th>Owner</th><th>Created</th><th>Updated</th><th>Age</th><th>Source</th></tr></thead>
      <tbody>{data.rows.map(ticket => <tr key={ticket.id}><td style={{ fontWeight:650 }}>{ticket.ticket_number}</td><td>{ticket.subject}</td><td>{ticket.normalized_status}</td><td>{ticket.normalized_priority || '—'}</td><td>{ticket.owner_name || 'Unassigned'}</td><td className="text-sm">{formatDate(ticket.created_at_external)}</td><td className="text-sm">{formatDate(ticket.updated_at_external)}</td><td>{age(ticket)}</td><td>{ticket.external_url ? <a href={ticket.external_url} target="_blank" rel="noreferrer" aria-label={`Open ticket ${ticket.ticket_number} in Request Tracker`}><ExternalLink size={15} /></a> : '—'}</td></tr>)}</tbody>
    </table></div>}
    <nav className="approval-pagination" aria-label="Ticket pages"><span>{data.total} ticket{data.total===1?'':'s'} · Page {data.page} of {pages}</span><button className="btn btn-ghost btn-sm" disabled={loading || filters.page===1} onClick={() => setFilters(current => ({ ...current,page:current.page-1 }))}>Previous</button><button className="btn btn-ghost btn-sm" disabled={loading || filters.page>=pages} onClick={() => setFilters(current => ({ ...current,page:current.page+1 }))}>Next</button></nav>
  </>;
}

function Dashboard({ id }) {
  const [tab,setTab]=useState('overview'),[preset,setPreset]=useState('month'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const range=useMemo(() => period(preset,from,to),[preset,from,to]);
  useEffect(() => { if (!range.from || !range.to) return;const controller=new AbortController();setLoading(true);setError('');api.managedCustomerOverview(id,range,{ signal:controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });return () => controller.abort(); },[id,range,retry]);
  return <div className="page"><div className="page-header"><div><Link to="/managed-customers" className="text-muted text-sm" style={{ display:'inline-flex',gap:4,alignItems:'center',marginBottom:6 }}><ArrowLeft size={13} /> Managed Customers</Link><h1 className="page-title">{data?.customer?.name || 'Managed customer'}</h1><p className="text-muted text-sm mt-4">{data?.customer?.responsible_team || 'No responsible team'} · {data?.customer?.service_manager || 'No service manager'} · Last ticket sync: {data?.customer?.last_successful_sync_at || 'Never'}</p></div></div>
    <div className="tabs" role="tablist" aria-label="Managed customer sections"><button className={`tab${tab==='overview'?' active':''}`} role="tab" aria-selected={tab==='overview'} onClick={() => setTab('overview')}>Overview</button><button className={`tab${tab==='tickets'?' active':''}`} role="tab" aria-selected={tab==='tickets'} onClick={() => setTab('tickets')}>Tickets</button></div>
    <div className="filter-bar" style={{ marginBottom:18 }}>{[['today','Today'],['week','This week'],['month','This month'],['last_month','Last month'],['quarter','Current quarter'],['previous_quarter','Previous quarter'],['year','Current year'],['custom','Custom']].map(([key,label]) => <button key={key} className={`filter-pill${preset===key?' active':''}`} onClick={() => setPreset(key)}>{label}</button>)}{preset==='custom' && <><input type="date" value={from} onChange={event => setFrom(event.target.value)} /><input type="date" value={to} onChange={event => setTo(event.target.value)} /></>}<button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value+1)}><RefreshCw size={13} /> Refresh</button></div>
    {tab==='tickets' ? <Tickets id={id} range={range} refresh={retry} /> : <>
      {error ? <div className="error-msg" role="alert">{error}</div> : loading && !data ? <div className="skeleton-table"><span /><span /><span /></div> : data && <><h2 style={{ fontSize:15,marginBottom:10 }}>Current state</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:22 }}><Metric label="Open tickets now" value={data.tickets.open_now} /><Metric label="Pending tickets now" value={data.tickets.pending_now} /><Metric label="High / critical open" value={data.tickets.high_priority_open} /><Metric label="Open tasks now" value={data.tasks.open_now} /><Metric label="Active projects now" value={data.projects.active_now} /><Metric label="Open recommendations now" value={data.recommendations.open_now} /><Metric label="Overdue tasks now" value={data.tasks.overdue_now} /><Metric label="Open SLA breaches" value={data.tickets.sla_breached_open} /></div><h2 style={{ fontSize:15,marginBottom:10 }}>Selected period · {data.period.from} to {data.period.to}</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12 }}><Metric label="Tickets created" value={data.tickets.created_period} /><Metric label="Tickets resolved" value={data.tickets.resolved_period} /><Metric label="Service activities" value={data.activities.activities} /><Metric label="Service hours" value={data.activities.hours} /><Metric label="Maintenance visits" value={data.visits.visits_period} /></div></>}
    </>}
  </div>;
}

export default function ManagedCustomers() { const { id }=useParams();return id ? <Dashboard id={id} /> : <Landing />; }
