import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { fmtDate, Modal } from './Shared';
import { useToast } from './Toast';

const STATUSES = ['open','accepted','rejected','in_progress','implemented','deferred','converted_to_project','closed'];
const label = value => value.replaceAll('_', ' ');

function TaskConversionForm({ customerId,recommendation,projects,owners,onSaved,onClose }) {
  const [form,setForm]=useState({ version:recommendation.version,title:recommendation.finding.slice(0,500),project_id:'',assigned_to:recommendation.owner_id || '',priority:recommendation.risk_level==='critical' ? 'high' : recommendation.risk_level,deadline:recommendation.due_date || '' });
  const [saving,setSaving]=useState(false),[error,setError]=useState('');const inFlight=useRef(false);
  const set=key => event => setForm(value => ({ ...value,[key]:event.target.value }));
  async function submit(event) { event.preventDefault();if(inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try { await api.convertRecommendationToTask(customerId,recommendation.id,form);onSaved();onClose(); } catch(failure){setError(failure.message);} finally {inFlight.current=false;setSaving(false);} }
  return <Modal title="Convert recommendation to task" onClose={saving ? () => {} : onClose}><form onSubmit={submit}>{error && <div className="error-msg" role="alert">{error}</div>}<fieldset disabled={saving} className="border-0 p-0 m-0"><p className="text-muted">Creates a task in an existing project for this customer and records the relationship. It does not notify the customer.</p><div className="form-group"><label htmlFor="recommendation-task-title">Task title</label><input id="recommendation-task-title" required maxLength={500} autoFocus value={form.title} onChange={set('title')} /></div><div className="form-group"><label htmlFor="recommendation-task-project">Project</label><select id="recommendation-task-project" required value={form.project_id} onChange={set('project_id')}><option value="">Select project</option>{projects.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></div><div className="form-row"><div className="form-group"><label htmlFor="recommendation-task-owner">Engineer</label><select id="recommendation-task-owner" required value={form.assigned_to} onChange={set('assigned_to')}><option value="">Select engineer</option>{owners.filter(row => row.role==='engineer').map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div><div className="form-group"><label htmlFor="recommendation-task-priority">Priority</label><select id="recommendation-task-priority" value={form.priority} onChange={set('priority')}>{['low','medium','high'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div></div><div className="form-group"><label htmlFor="recommendation-task-deadline">Deadline</label><input id="recommendation-task-deadline" type="date" min="1900-01-01" max="9998-12-31" value={form.deadline} onChange={set('deadline')} /></div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">{saving ? 'Creating...' : 'Create task'}</button></div></fieldset></form></Modal>;
}

function RecommendationForm({ customerId, initial, sourceVisitId, visits, owners, converting, onSaved, onClose }) {
  const [form, setForm] = useState(initial || { finding: '', recommendation: '', risk_level: 'medium', owner_id: '', source_visit_id: sourceVisitId || '', due_date: '', status: 'open', follow_up_notes: '' });
  const [title, setTitle] = useState(initial?.finding.slice(0,300) || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const set = key => event => setForm(value => ({ ...value, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      if (converting) await api.convertRecommendation(customerId,initial.id,{ version: initial.version, title });
      else if (initial) await api.updateRecommendation(customerId,initial.id,form);
      else await api.createRecommendation(customerId,form);
      onSaved(); onClose();
    } catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <Modal title={converting ? 'Convert recommendation to project' : initial ? 'Edit recommendation' : 'Record recommendation'} onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <fieldset disabled={saving} className="border-0 p-0 m-0">
        {converting ? <>
          <p className="text-muted">Creates a project for this customer with the finding and recommendation, due date and an active engineer owner assignment. It does not send a message to the customer.</p>
          <div className="form-group"><label htmlFor="recommendation-project-title">Project title</label><input id="recommendation-project-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={300} autoFocus /></div>
        </> : <>
          <div className="form-group"><label htmlFor="recommendation-finding">Finding</label><textarea id="recommendation-finding" value={form.finding} onChange={set('finding')} required maxLength={10000} rows={3} autoFocus /></div>
          <div className="form-group"><label htmlFor="recommendation-action">Recommendation</label><textarea id="recommendation-action" value={form.recommendation} onChange={set('recommendation')} required maxLength={10000} rows={3} /></div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="recommendation-risk">Risk</label><select id="recommendation-risk" value={form.risk_level} onChange={set('risk_level')}>{['low','medium','high','critical'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div>
            <div className="form-group"><label htmlFor="recommendation-status">Status</label><select id="recommendation-status" value={form.status} onChange={set('status')}>{STATUSES.filter(value => value !== 'converted_to_project' || initial?.related_project_id).map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label htmlFor="recommendation-owner">Owner</label><select id="recommendation-owner" value={form.owner_id || ''} onChange={set('owner_id')}><option value="">Unassigned</option>{initial?.owner_id && !owners.some(row => row.id === initial.owner_id) && <option value={initial.owner_id}>{initial.owner_name || 'Previous owner'} (inactive)</option>}{owners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>
            <div className="form-group"><label htmlFor="recommendation-due">Due date</label><input id="recommendation-due" type="date" min="1900-01-01" max="9998-12-31" value={form.due_date || ''} onChange={set('due_date')} /></div>
          </div>
          <div className="form-group"><label htmlFor="recommendation-source">Source visit (latest 50)</label><select id="recommendation-source" value={form.source_visit_id || ''} onChange={set('source_visit_id')}><option value="">No source visit</option>{form.source_visit_id && !visits.some(row => row.id === Number(form.source_visit_id)) && <option value={form.source_visit_id}>{initial?.source_visit_title || `Source visit #${form.source_visit_id}`}</option>}{visits.map(row => <option key={row.id} value={row.id}>{row.title} · {fmtDate(row.scheduled_date)}</option>)}</select></div>
          <div className="form-group"><label htmlFor="recommendation-notes">Follow-up notes</label><textarea id="recommendation-notes" value={form.follow_up_notes || ''} onChange={set('follow_up_notes')} maxLength={10000} rows={3} /></div>
        </>}
        <div className="modal-footer"><button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">{saving ? 'Saving...' : converting ? 'Create project' : 'Save recommendation'}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

export default function CustomerRecommendations({ customerId, sourceVisitId, create=false, onSourceConsumed }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loadedScope, setLoadedScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const sourceOpened = useRef(null);
  const createOpened = useRef(false);
  const scope = `${customerId}:${page}:${status}`;
  const { begin, isCurrent } = useLatestRequest(scope);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.customerRecommendations(customerId,{ page, ...(status ? { status } : {}) },{ signal: request.signal }).then(result => {
      if (!isCurrent(request)) return;
      setData(result); setLoadedScope(scope);
      const last = Math.max(1,Math.ceil(result.total/result.page_size));
      if (page > last) setPage(last);
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); })
      .finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [customerId,page,status,scope,begin,isCurrent]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!sourceVisitId) sourceOpened.current = null;
    if (data && sourceVisitId && sourceOpened.current !== sourceVisitId) {
      sourceOpened.current = sourceVisitId;
      setEditing({ initial: null, sourceVisitId });
      onSourceConsumed?.();
    }
  }, [data, sourceVisitId, onSourceConsumed]);
  useEffect(() => {
    if (!create) createOpened.current=false;
    if (create && data && data.capabilities?.can_create !== false && !createOpened.current) {
      createOpened.current=true;
      setEditing({ initial:null });
      onSourceConsumed?.();
    }
  },[create,data,onSourceConsumed]);
  const busy = loading || loadedScope !== scope;
  return <section>
    {data?.summary && <div className="cs-recommendation-summary"><div><span>Open</span><strong>{data.summary.open}</strong></div><div><span>High risk</span><strong>{data.summary.high_risk}</strong></div><div><span>In progress</span><strong>{data.summary.in_progress}</strong></div><div><span>Implemented</span><strong>{data.summary.implemented}</strong></div></div>}
    <div className="flex gap-8 mb-16 flex-wrap">
      <label htmlFor="recommendation-list-status">Status</label><select id="recommendation-list-status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="u-30e741d"><option value="">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select>
      {data?.capabilities?.can_create !== false && <button className="btn btn-primary" disabled={busy || !!error} onClick={() => setEditing({ initial: null })}>Record recommendation</button>}
      <button className="btn btn-ghost" disabled={busy} onClick={load}>Refresh</button>
    </div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div> : busy ? <p role="status">Loading recommendations...</p> : <>
      {data.rows.length === 0 && <p className="text-muted">No recommendations in this view.</p>}
      {data.rows.map(row => <article className="card mb-16" key={row.id}>
        <h2 className="u-de13e91">{row.finding}</h2>
        <p className="u-a548ea7">{row.recommendation}</p>
        <p className="text-muted">{label(row.status)} · {row.risk_level} risk · {row.owner_name || 'Unassigned'} · Due {fmtDate(row.due_date)}</p>
        {row.source_visit_title && <p className="text-muted text-sm">Source: {row.source_visit_title}</p>}
        {row.follow_up_notes && <p className="u-a548ea7">{row.follow_up_notes}</p>}
        <div className="flex gap-8">
          {row.can_edit && <button className="btn btn-ghost" onClick={() => setEditing({ initial: row })}>Edit</button>}
          {row.related_project_id ? <Link className="btn btn-ghost" to={`/projects/${row.related_project_id}`}>Open converted project</Link> : row.related_task_id ? <Link className="btn btn-ghost" to={`/projects/${row.related_task_project_id}`}>Open converted task project</Link> : row.can_edit && <>{data.capabilities.can_convert_task && data.projects.length>0 && <button className="btn btn-primary" onClick={() => setEditing({ initial: row, convertingTask: true })}>Convert to task</button>}{data.capabilities.can_convert_project && <button className="btn btn-primary" onClick={() => setEditing({ initial: row, converting: true })}>Convert to project</button>}</>}
        </div>
      </article>)}
      <div className="flex gap-8"><button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} · {data.total} recommendations</span><button className="btn btn-ghost" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
    </>}
    {editing?.convertingTask ? <TaskConversionForm customerId={customerId} recommendation={editing.initial} projects={data.projects} owners={data.owners} onClose={() => setEditing(null)} onSaved={() => { toast.success('Task created');load(); }} /> : editing && <RecommendationForm customerId={customerId} initial={editing.initial} sourceVisitId={editing.sourceVisitId} visits={data.visits} owners={data.owners} converting={editing.converting} onClose={() => setEditing(null)} onSaved={() => { toast.success(editing.converting ? 'Project created' : 'Recommendation saved'); load(); }} />}
  </section>;
}
