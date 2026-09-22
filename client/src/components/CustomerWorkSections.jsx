import React,{ useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate,StatusBadge } from './Shared';

function useCustomerList(load,params,customerId) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const scope=JSON.stringify(params);
  useEffect(() => {
    const controller=new AbortController();setError('');setData(null);
    load(params,{ signal:controller.signal }).then(result => { if(!controller.signal.aborted) setData(result); }).catch(failure => { if(!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  },[scope,customerId,retry]);
  return { data,error,retry:() => setRetry(value => value+1) };
}

function SearchFilter({ value,onChange,onSubmit,children }) {
  return <form className="cs-work-filters" onSubmit={event => { event.preventDefault();onSubmit(); }}>
    <label><span>Search</span><input value={value} onChange={event => onChange(event.target.value)} maxLength={200} placeholder="Search this customer" /></label>
    {children}<button className="btn btn-ghost" type="submit">Apply</button>
  </form>;
}

function ResultState({ data,error,retry,empty,children }) {
  if (error) return <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={retry}>Retry</button></div>;
  if (!data) return <div className="skeleton-table" role="status" aria-label="Loading"><span /><span /><span /></div>;
  if (!data.rows.length) return <div className="card cs-empty"><h2>{empty}</h2><p>Try changing the current filters.</p></div>;
  return children;
}

function Pager({ data,onPage }) {
  const pages=Math.max(1,Math.ceil(data.total/data.page_size));
  return <div className="cs-work-pager"><span>{data.total} records</span><div><button className="btn btn-ghost btn-sm" disabled={data.page<=1} onClick={() => onPage(data.page-1)}>Previous</button><span>Page {data.page} of {pages}</span><button className="btn btn-ghost btn-sm" disabled={data.page>=pages} onClick={() => onPage(data.page+1)}>Next</button></div></div>;
}

export function CustomerProjects({ customerId,initialFilter='' }) {
  const [page,setPage]=useState(1),[filter,setFilter]=useState(initialFilter || 'all'),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const state=useCustomerList((params,options) => api.customerOperationProjects(customerId,params,options),{ page,page_size:25,filter,search },customerId);
  return <section><SearchFilter value={draft} onChange={setDraft} onSubmit={() => { setSearch(draft.trim());setPage(1); }}><label><span>Status</span><select value={filter} onChange={event => { setFilter(event.target.value);setPage(1); }}><option value="all">All</option><option value="active">Active</option><option value="delayed">Delayed</option><option value="completed">Completed</option></select></label></SearchFilter>
    <ResultState {...state} empty="No projects found">{state.data && <div className="card cs-work-table-wrap"><table className="cs-work-table"><thead><tr><th>Project</th><th>Owner</th><th>Assigned engineers</th><th>Status</th><th>Progress</th><th>Start</th><th>Deadline</th></tr></thead><tbody>{state.data.rows.map(row => <tr key={row.id}><td data-label="Project"><Link to={`/projects/${row.id}`}>{row.title}</Link></td><td data-label="Owner">{row.owner_name}</td><td data-label="Assigned engineers">{row.members.map(member => member.name).join(', ') || 'Unassigned'}</td><td data-label="Status"><StatusBadge entityType="project" s={row.status} /></td><td data-label="Progress"><span className="cs-progress"><span style={{ width:`${Math.max(0,Math.min(100,row.completion_pct))}%` }} /></span>{row.completion_pct}%</td><td data-label="Start">{fmtDate(row.start_date)}</td><td data-label="Deadline">{fmtDate(row.deadline)}</td></tr>)}</tbody></table><Pager data={state.data} onPage={setPage} /></div>}</ResultState>
  </section>;
}

export function CustomerTasks({ customerId,initialFilter='',engineers=[] }) {
  const [page,setPage]=useState(1),[filter,setFilter]=useState(initialFilter || 'all'),[priority,setPriority]=useState(''),[engineer,setEngineer]=useState(''),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const state=useCustomerList((params,options) => api.customerOperationTasks(customerId,params,options),{ page,page_size:25,filter,search,...(priority?{priority}:{}),...(engineer?{engineer_id:engineer}:{}) },customerId);
  const update=(setter,value) => { setter(value);setPage(1); };
  return <section><SearchFilter value={draft} onChange={setDraft} onSubmit={() => { setSearch(draft.trim());setPage(1); }}><label><span>Status</span><select value={filter} onChange={event => update(setFilter,event.target.value)}><option value="all">All</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option><option value="recently_completed">Recently completed</option></select></label><label><span>Priority</span><select value={priority} onChange={event => update(setPriority,event.target.value)}><option value="">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>{engineers.length>0 && <label><span>Engineer</span><select value={engineer} onChange={event => update(setEngineer,event.target.value)}><option value="">All engineers</option>{engineers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</SearchFilter>
    <ResultState {...state} empty="No tasks found">{state.data && <div className="card cs-work-table-wrap"><table className="cs-work-table"><thead><tr><th>Task</th><th>Engineer</th><th>Project</th><th>Status</th><th>Priority</th><th>Due date</th></tr></thead><tbody>{state.data.rows.map(row => <tr key={row.id}><td data-label="Task"><Link to={`/projects/${row.project_id}`}>{row.title}</Link></td><td data-label="Engineer">{row.assigned_to_name || 'Unassigned'}</td><td data-label="Project"><Link to={`/projects/${row.project_id}`}>{row.project_title}</Link></td><td data-label="Status"><StatusBadge entityType="task" s={row.status} /></td><td data-label="Priority"><span className={`badge badge-${row.priority}`}>{row.priority}</span></td><td data-label="Due date">{fmtDate(row.deadline)}</td></tr>)}</tbody></table><Pager data={state.data} onPage={setPage} /></div>}</ResultState>
  </section>;
}

export function CustomerVisits({ customerId,initialFilter='' }) {
  const [page,setPage]=useState(1),[filter,setFilter]=useState(initialFilter || 'all'),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const state=useCustomerList((params,options) => api.customerOperationVisits(customerId,params,options),{ page,page_size:25,filter,search },customerId);
  return <section><SearchFilter value={draft} onChange={setDraft} onSubmit={() => { setSearch(draft.trim());setPage(1); }}><label><span>Status</span><select value={filter} onChange={event => { setFilter(event.target.value);setPage(1); }}><option value="all">All</option><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="report_pending">Report pending</option><option value="awaiting_review">Awaiting review</option><option value="cancelled">Cancelled</option></select></label></SearchFilter>
    <ResultState {...state} empty="No maintenance visits found">{state.data && <div className="card cs-work-table-wrap"><table className="cs-work-table"><thead><tr><th>Visit</th><th>Date</th><th>Engineers</th><th>Status</th><th>Report status</th><th>Report sent</th></tr></thead><tbody>{state.data.rows.map(row => <tr key={row.id}><td data-label="Visit"><Link to={`/maintenance-visits?customer_id=${customerId}`}>{row.title}</Link><span className="text-muted text-sm"> #{row.id}</span></td><td data-label="Date">{fmtDate(row.scheduled_date)}</td><td data-label="Engineers">{row.engineers.map(item => item.name).join(', ') || 'Unassigned'}</td><td data-label="Status"><StatusBadge entityType="maintenance_visit" s={row.status} /></td><td data-label="Report status">{row.report_sent_to_customer?'Sent to PM':row.report_sent?'Awaiting review':row.status==='scheduled'?'Not due':'Pending'}</td><td data-label="Report sent">{fmtDate(row.report_sent_to_customer_at || row.report_sent_at)}</td></tr>)}</tbody></table><Pager data={state.data} onPage={setPage} /></div>}</ResultState>
  </section>;
}
