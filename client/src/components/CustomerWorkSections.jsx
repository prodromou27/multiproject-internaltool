import { useEffect, useState, useRef } from 'react';
import { businessToday } from '../utils/dates';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate,StatusBadge, sentenceCase } from './Shared';
import { useLiveVersion } from '../live';
import CustomerRecurringTasks from './CustomerRecurringTasks';
import CustomerTaskForm from './CustomerTaskForm';
import { LastUpdate, SubtaskProgress, SubtasksDialog, TaskTicket } from './TaskSubtasks';
import { useToast } from './Toast';
import { Check, Hand, MessageSquare, Pencil, Play, Plus, Repeat } from 'lucide-react';
import EditTaskModal from './EditTaskModal';
import { useConfirm } from './Confirm';
import AddToCalendarButton from './AddToCalendarButton';

function useCustomerList(load,params,customerId) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const scope=JSON.stringify(params);
  const live=useLiveVersion();
  const shown=useRef(null);
  useEffect(() => {
    // Clear only for a different list; a background refresh keeps the rows on screen.
    const key=`${customerId}:${scope}`;
    const controller=new AbortController();setError('');if (shown.current!==key) setData(null);shown.current=key;
    load(params,{ signal:controller.signal }).then(result => { if(!controller.signal.aborted) setData(result); }).catch(failure => { if(!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  },[scope,customerId,retry,live]);
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

const DONE_STATUSES=new Set(['completed','closed','cancelled','pending_approval']);

/* Customer 360 → Tasks: recurring tasks, then this customer's tasks (open first by
   default) with Start and Done on the ones you work on. Engineers see all the
   customer's tasks: they take an unassigned one, or take one over from a
   colleague (who is told); a team task becomes theirs when they start or finish it. */
export function CustomerTasks({ customerId,initialFilter='',engineers=[],canManage=false,canAdd=false,isEngineer=false,create=false,onCreateConsumed,openTaskId=null }) {
  const toast=useToast(),confirm=useConfirm(),[mine,setMine]=useState(false),[adding,setAdding]=useState(false),[editing,setEditing]=useState(null),[busy,setBusy]=useState(null),[subtasksFor,setSubtasksFor]=useState(null);
  const [page,setPage]=useState(1),[filter,setFilter]=useState(initialFilter || 'open'),[priority,setPriority]=useState(''),[engineer,setEngineer]=useState(''),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const state=useCustomerList((params,options) => api.customerOperationTasks(customerId,params,options),{ page,page_size:25,filter,search,...(priority?{priority}:{}),...(engineer?{engineer_id:engineer}:{}),...(mine?{ mine:'1' }:{}) },customerId);
  const update=(setter,value) => { setter(value);setPage(1); };
  // "Create task" (Add menu, or a link with create=1) opens the form, also when this tab is already open;
  // the request is then taken off the address, so asking again opens it again.
  useEffect(() => {
    if (!create) return;
    if (canAdd) setAdding(true);
    onCreateConsumed?.();
  },[create]); // eslint-disable-line react-hooks/exhaustive-deps
  // A link to one task (e.g. from a mention) opens it once its row is loaded; if it is not in the open list, all tasks are listed.
  const opened=useRef(false);
  useEffect(() => {
    if (!openTaskId || opened.current || !state.data) return;
    const row=state.data.rows.find(item => Number(item.id)===Number(openTaskId));
    if (row) { opened.current=true;setSubtasksFor(row); }
    else if (filter!=='all') setFilter('all');
    else opened.current=true;
  },[openTaskId,state.data,filter]);
  async function take(row) {
    const over=!!row.assigned_to;
    if (over && !await confirm(`${row.title} is assigned to ${row.assigned_to_name}. Take it over? ${row.assigned_to_name} will be told.`,{ title:'Take over this task',label:'Take over' })) return;
    setBusy(row.id);
    try { await api.takeTask(row.id,over ? { take_over:true } : {});toast.success(over ? `You took over: ${row.title}` : `Yours now: ${row.title}`);state.retry(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(null); }
  }
  async function setStatus(row,status) {
    setBusy(row.id);
    try { await api.updateTask(row.id,{ status });toast.success(status==='in_progress' ? `Started: ${row.title}` : `Done: ${row.title}`);state.retry(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(null); }
  }
  return <section><CustomerRecurringTasks customerId={customerId} canManage={canManage} engineers={engineers} />
    {canAdd && <div className="cs-tasks-head"><h2>Tasks</h2><button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add task</button></div>}
    {subtasksFor && <SubtasksDialog task={subtasksFor} customerId={customerId} canEdit={subtasksFor.can_update!==false} onClose={() => { setSubtasksFor(null);state.retry(); }} />}
    {editing && <EditTaskModal task={editing} allUsers={engineers} isManager={canManage} onClose={() => setEditing(null)} onSave={() => { setEditing(null);toast.success('Task saved');state.retry(); }} />}
    {adding && <CustomerTaskForm customerId={customerId} isManager={canManage} engineers={engineers} onClose={() => setAdding(false)} onSaved={() => { setAdding(false);toast.success('Task added');state.retry(); }} />}
    <SearchFilter value={draft} onChange={setDraft} onSubmit={() => { setSearch(draft.trim());setPage(1); }}><label><span>Status</span><select value={filter} onChange={event => update(setFilter,event.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option><option value="recently_completed">Recently completed</option><option value="all">All</option></select></label><label><span>Priority</span><select value={priority} onChange={event => update(setPriority,event.target.value)}><option value="">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>{isEngineer && <label className="cs-mine"><input type="checkbox" checked={mine} onChange={event => update(setMine,event.target.checked)} /> Mine only</label>}{engineers.length>0 && <label><span>Engineer</span><select value={engineer} onChange={event => update(setEngineer,event.target.value)}><option value="">All engineers</option>{engineers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</SearchFilter>
    <ResultState {...state} empty={filter==='open' ? 'No open tasks' : 'No tasks found'}>{state.data && <div className="card cs-work-table-wrap"><table className="cs-work-table"><thead><tr><th>Task</th><th>For</th><th>Status</th><th>Priority</th><th>Due date</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{state.data.rows.map(row => {
      const done=DONE_STATUSES.has(row.status),canUpdate=row.can_update!==false,openSubtasks=(row.subtasks_total || 0)-(row.subtasks_done || 0),overdue=!done && row.deadline && row.deadline.slice(0,10)<businessToday();
      return <tr key={row.id}>
        <td data-label="Task"><button type="button" className="cs-task-title" onClick={() => setSubtasksFor(row)} title="Open the task: subtasks and updates">{row.title}</button>
          <div className="cs-task-meta"><SubtaskProgress total={row.subtasks_total} done={row.subtasks_done} compact={!row.subtasks_total} onClick={canUpdate || row.subtasks_total ? () => setSubtasksFor(row) : undefined} /><TaskTicket task={row} />{row.recurring_task_id && <span title="Created by a recurring task"><Repeat size={12} aria-hidden="true" /> Repeats</span>}{row.asset_name && <span>Asset: {row.asset_name}</span>}{row.project_title && <span>Project: <Link to={`/projects/${row.project_id}`}>{row.project_title}</Link></span>}</div>
          {row.last_update && <div className="cs-task-update"><LastUpdate update={row.last_update} /></div>}</td>
        <td data-label="For">{row.assigned_to_name || (row.team_name ? `${row.team_name} (team)` : 'Unassigned')}</td>
        <td data-label="Status"><StatusBadge entityType="task" s={row.status} /></td>
        <td data-label="Priority"><span className={`badge badge-${row.priority}`}>{sentenceCase(row.priority)}</span></td>
        <td data-label="Due date" className={overdue ? 'cs-overdue' : ''}>{fmtDate(row.deadline)}{overdue && <div className="text-sm">Overdue</div>}</td>
        <td><div className="table-actions">{!done && !canUpdate && isEngineer && <button type="button" className="btn btn-ghost btn-sm" disabled={busy===row.id} onClick={() => take(row)}
          aria-label={`${row.assigned_to ? 'Take over' : 'Take'} ${row.title}`}><Hand size={13} /> {row.assigned_to ? 'Take over' : 'Take'}</button>}
          {canUpdate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.title}`}><Pencil size={13} /> Edit</button>}
          {canUpdate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSubtasksFor(row)} aria-label={`Post an update on ${row.title}`}><MessageSquare size={13} /> Update</button>}
          {!done && canUpdate && <>
          {row.status!=='in_progress' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy===row.id} onClick={() => setStatus(row,'in_progress')} aria-label={`Start ${row.title}`}><Play size={13} /> Start</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy===row.id || openSubtasks>0} onClick={() => setStatus(row,'completed')} aria-label={`Mark ${row.title} done`}
            title={openSubtasks>0 ? `${openSubtasks} subtask${openSubtasks===1?'':'s'} still open` : undefined}><Check size={13} /> Done</button>
        </>}</div></td>
      </tr>; })}</tbody></table><Pager data={state.data} onPage={setPage} /></div>}</ResultState>
  </section>;
}

export function CustomerVisits({ customerId,initialFilter='' }) {
  const [page,setPage]=useState(1),[filter,setFilter]=useState(initialFilter || 'all'),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
  const state=useCustomerList((params,options) => api.customerOperationVisits(customerId,params,options),{ page,page_size:25,filter,search },customerId);
  return <section><SearchFilter value={draft} onChange={setDraft} onSubmit={() => { setSearch(draft.trim());setPage(1); }}><label><span>Status</span><select value={filter} onChange={event => { setFilter(event.target.value);setPage(1); }}><option value="all">All</option><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="report_pending">Report pending</option><option value="awaiting_review">Awaiting review</option><option value="cancelled">Cancelled</option></select></label></SearchFilter>
    <ResultState {...state} empty="No maintenance visits found">{state.data && <div className="card cs-work-table-wrap"><table className="cs-work-table"><thead><tr><th>Visit</th><th>Date</th><th>Engineers</th><th>Status</th><th>Report status</th><th>Report sent</th><th><span className="sr-only">Calendar</span></th></tr></thead><tbody>{state.data.rows.map(row => <tr key={row.id}><td data-label="Visit"><Link to={`/maintenance-visits?visit=${row.id}&filter=all`}>{row.title}</Link><span className="text-muted text-sm"> #{row.id}</span></td><td data-label="Date">{fmtDate(row.scheduled_date)}</td><td data-label="Engineers">{row.engineers.map(item => item.name).join(', ') || 'Unassigned'}</td><td data-label="Status"><StatusBadge entityType="maintenance_visit" s={row.status} /></td><td data-label="Report status">{row.report_sent_to_customer?'Sent to PM':row.report_sent?'Awaiting review':row.status==='scheduled'?'Not due':'Pending'}</td><td data-label="Report sent">{fmtDate(row.report_sent_to_customer_at || row.report_sent_at)}</td><td>{row.status !== 'cancelled' && <AddToCalendarButton visitId={row.id} title={row.title} compact />}</td></tr>)}</tbody></table><Pager data={state.data} onPage={setPage} /></div>}</ResultState>
  </section>;
}
