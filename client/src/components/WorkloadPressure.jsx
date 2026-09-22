import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { localDateISO } from '../utils/dates';
import { fmtDate, Modal } from './Shared';

const labels = { task: 'Tasks',visit: 'Visits',report: 'Pending reports',follow_up: 'Service follow-ups' };
const routes = { task: '/tasks',visit: '/maintenance-visits',report: '/maintenance-visits',follow_up: '/activity-log' };

function PolicyForm({ onClose,onSaved }) {
  const [policy,setPolicy] = useState(null);
  const [statuses,setStatuses] = useState({});
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    api.workloadPolicy({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setPolicy(result.policy); setStatuses(result.statuses); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);
  function change(group,key,value) {
    setPolicy(current => group==='priority'
      ? { ...current,pressure: { ...current.pressure,priority: { ...current.pressure.priority,[key]: value } } }
      : ['task','visit'].includes(group)
        ? { ...current,status_weights: { ...current.status_weights,[group]: { ...current.status_weights[group],[key]: value } } }
        : { ...current,pressure: { ...current.pressure,[key]: value } });
  }
  async function save(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current=true; setSaving(true); setError('');
    try { await api.saveWorkloadPolicy(policy); onSaved(); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { inFlight.current=false; setSaving(false); }
  }
  return <Modal title="Workload weights" onClose={saving ? () => {} : onClose}>
    {error && <div className="error-msg" role="alert">{error}</div>}
    {!policy ? <p role="status">{error ? 'Close and reopen to retry loading settings.' : 'Loading settings...'}</p> : <form onSubmit={save}>
      <p className="text-muted">Status factors multiply recorded remaining hours and base pressure points. Terminal work is excluded regardless of its factor. Unknown statuses default to 100%. Deadline bonuses remain visible even at 0%.</p>
      {['task','visit'].map(kind => <fieldset key={kind} disabled={saving} style={{ margin: '12px 0',padding: 12 }}><legend>{labels[kind]}: status factor (%)</legend>
        {[...new Set([...Object.keys(policy.status_weights[kind]),...(statuses[kind] || []).map(row => row.value)])].map(status => <div className="form-group" key={status}>
          <label htmlFor={`weight-${kind}-${status}`}>{(statuses[kind] || []).find(row => row.value===status)?.label || status.replaceAll('_',' ')}</label>
          <input id={`weight-${kind}-${status}`} type="number" min="0" max="100" step="any" required value={(policy.status_weights[kind][status] ?? 1)*100} onChange={event => change(kind,status,Number(event.target.value)/100)} />
        </div>)}
      </fieldset>)}
      <fieldset disabled={saving} style={{ padding: 12 }}><legend>Pressure points</legend>
        {Object.entries(policy.pressure.priority).map(([key,value]) => <div className="form-group" key={key}><label htmlFor={`priority-${key}`}>{key} task priority</label><input id={`priority-${key}`} type="number" min="0" max="100" step="any" required value={value} onChange={event => change('priority',key,Number(event.target.value))} /></div>)}
        {['overdue','due_soon','pending_report','follow_up'].map(key => <div className="form-group" key={key}><label htmlFor={`pressure-${key}`}>{key.replaceAll('_',' ')}</label><input id={`pressure-${key}`} type="number" min="0" max="100" step="any" required value={policy.pressure[key]} onChange={event => change('pressure',key,Number(event.target.value))} /></div>)}
      </fieldset>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save weights'}</button></div>
    </form>}
  </Modal>;
}

export default function WorkloadPressure() {
  const [date,setDate] = useState(localDateISO());
  const [data,setData] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [editing,setEditing] = useState(false);
  const { begin,isCurrent } = useLatestRequest(date);
  const load = useCallback(() => {
    const request=begin();
    if (request.signal.aborted) return;
    setLoading(true); setError(''); setData(null);
    api.workloadPressure({ as_of: date },{ signal: request.signal }).then(result => {
      if (isCurrent(request)) setData(result);
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); })
      .finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [date,begin,isCurrent]);
  useEffect(() => { load(); }, [load]);
  return <section>
    <div style={{ display: 'flex',gap: 8,flexWrap: 'wrap',alignItems: 'center',marginBottom: 16 }}><label htmlFor="pressure-date">As of</label><input id="pressure-date" type="date" min="1900-01-01" max="9998-12-01" value={date} onChange={event => setDate(event.target.value)} style={{ width: 'auto' }} /><button className="btn btn-ghost" disabled={loading} onClick={load}>Refresh</button><button className="btn btn-ghost" onClick={() => setEditing(true)}>Configure weights</button></div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div> : loading ? <p role="status">Loading operational pressure...</p> : data && <>
      <p className="text-muted mb-16">{data.coverage}</p>
      {!data.engineers.length && <p>No active engineers.</p>}
      {data.engineers.map(engineer => <article key={engineer.id} className="card mb-16">
        <h2 style={{ fontSize: 18 }}>{engineer.name}: {engineer.pressure_points} pressure points</h2>
        <p className="text-muted">{engineer.overdue_count} overdue components; {engineer.undated_count} undated components.</p>
        <div style={{ display: 'flex',gap: 16,flexWrap: 'wrap' }}>{Object.entries(engineer.breakdown).map(([kind,total]) => <p key={kind}>{labels[kind]}: {total.count} / {total.points} points</p>)}</div>
        <details><summary>View components ({engineer.items_total})</summary>
          {engineer.items.map(item => <div key={`${item.kind}:${item.id}`} style={{ padding: '8px 0',borderTop: '1px solid var(--gray-100)',overflowWrap: 'anywhere' }}><strong>{item.title}</strong><p>{labels[item.kind]} / {item.points} points ({item.base_points} base){item.overdue ? ' / overdue' : item.due_soon ? ' / due soon' : ''} / {item.date ? fmtDate(item.date) : 'No date'}</p><Link to={routes[item.kind]}>Open {labels[item.kind].toLowerCase()}</Link></div>)}
          {engineer.items_total>engineer.items.length && <p>Showing the first {engineer.items.length} components by pressure. Totals include all {engineer.items_total}.</p>}
        </details>
      </article>)}
    </>}
    {editing && <PolicyForm onClose={() => setEditing(false)} onSaved={load} />}
  </section>;
}
