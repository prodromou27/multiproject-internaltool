import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { localDateISO } from '../utils/dates';
import { fmtDate, Modal } from './Shared';
import { useToast } from './Toast';

function HoursForm({ edit, onSaved, onClose }) {
  const [hours,setHours] = useState(edit.hours ?? '');
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const inFlight = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      if (edit.type === 'availability') await api.workloadAvailability({ user_id: edit.userId, week_start: edit.week, version: edit.version, available_hours: Number(hours) });
      else await api.workloadEstimate({ kind: edit.kind, id: edit.id, version: edit.version, remaining_hours: Number(hours) });
      onSaved(); onClose();
    } catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <Modal title={edit.type === 'availability' ? 'Net weekly availability' : 'Remaining effort estimate'} onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      <p>{edit.title}</p>
      <p className="text-muted">{edit.type === 'availability' ? 'Enter hours available after leave, holidays, meetings and other commitments. No default capacity is assumed.' : edit.kind === 'visit' ? 'Remaining visit hours per assigned engineer. Each engineer receives the full per-person estimate.' : 'Enter remaining effort, rather than the original estimate or hours already logged.'}</p>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="planning-hours">Hours</label><input id="planning-hours" type="number" min="0" max={edit.type === 'availability' ? 168 : 10000} step="any" required autoFocus value={hours} disabled={saving} onChange={event => setHours(event.target.value)} /></div>
      <div className="modal-footer"><button className="btn btn-ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving} type="submit">{saving ? 'Saving...' : 'Save hours'}</button></div>
    </form>
  </Modal>;
}

export default function WorkloadPlanning() {
  const toast = useToast();
  const [asOf,setAsOf] = useState(localDateISO());
  const [data,setData] = useState(null);
  const [loadedDate,setLoadedDate] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [edit,setEdit] = useState(null);
  const { begin,isCurrent } = useLatestRequest(asOf);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.workloadPlanning({ as_of: asOf },{ signal: request.signal }).then(result => {
      if (isCurrent(request)) { setData(result); setLoadedDate(asOf); }
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); })
      .finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [asOf,begin,isCurrent]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setEdit(null); }, [asOf]);
  const busy = loading || loadedDate !== asOf;
  return <section>
    <div className="flex gap-8 mb-16"><label htmlFor="planning-date">Planning date</label><input id="planning-date" type="date" min="1900-01-01" max="9998-12-01" value={asOf} onChange={event => setAsOf(event.target.value)} style={{ width: 'auto' }} /><button className="btn btn-ghost" disabled={busy} onClick={load}>Refresh</button></div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div> : busy ? <p role="status">Loading effort and availability...</p> : <>
      <p className="text-muted mb-16">{data.coverage}</p>
      {data.engineers.length === 0 && <p>No active engineers.</p>}
      {data.engineers.map(engineer => <article className="card mb-20" key={engineer.id}>
        <h2 style={{ fontSize: 18 }}>{engineer.name}</h2>
        <p className="text-muted text-sm">{engineer.outside_window_count} outstanding items without a date or beyond this window; excluded from weekly percentages.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
          {engineer.weeks.map(week => <section key={week.start} style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: 12 }}>
            <h3 style={{ fontSize: 14 }}>{fmtDate(week.start)} – {fmtDate(week.end)}</h3>
            <p><strong>{week.capacity_percent === null ? 'Percentage unavailable' : `${week.capacity_percent}% estimated task/visit load`}</strong></p>
            <p>{week.estimated_hours}h weighted effort / {week.available_hours === null ? 'availability not recorded' : `${week.available_hours}h net available`}</p>
            <p className="text-muted text-sm">{week.unweighted_hours}h before weighting / {week.item_count} items · {week.unknown_estimates} missing estimates with positive weight</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ type: 'availability', title: `${engineer.name} · ${fmtDate(week.start)}`, userId: engineer.id, week: week.start, version: week.availability_version, hours: week.available_hours })}>Set availability</button>
            {week.items.map(item => <div key={`${item.kind}:${item.id}`} style={{ padding: '8px 0', borderTop: '1px solid var(--gray-100)' }}>
              <div className="text-sm">{item.title}</div><div className="text-muted text-sm">{Math.round(item.status_weight*100)}% status factor / {item.kind} · {item.status.replaceAll('_',' ')} · {fmtDate(item.date)}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ type: 'estimate', title: item.title, kind: item.kind, id: item.id, version: item.estimate_version, hours: item.remaining_hours })}>{item.remaining_hours === null ? 'Add estimate' : `${item.remaining_hours}h · Edit estimate`}</button>
            </div>)}
            {week.items_total>week.items.length && <p className="text-muted text-sm">Showing {week.items.length} of {week.items_total}, missing estimates first; totals include every item.</p>}
          </section>)}
        </div>
      </article>)}
    </>}
    {edit && <HoursForm edit={edit} onClose={() => setEdit(null)} onSaved={() => { toast.success('Planning hours saved'); load(); }} />}
  </section>;
}
