import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { api } from '../api';

/* A visit's time (all day, or a start time and duration) and the check before
   saving (server: visitScheduling.js). Hard problems (a public holiday, time off,
   overlapping visits) need "Save anyway"; notes (a weekend, too little travel
   time, another visit that day, no Senior/Expert for the technology) are shown and
   never block. */

export const timesOf = form => (form.all_day ? { start_time: null, duration_minutes: null } : { start_time: form.start_time || '09:00', duration_minutes: Number(form.duration_minutes) || 120 });
export const allDayOf = visit => !visit?.start_time;
/** "10:00–12:00" for a timed visit, '' for an all-day one. */
export function visitTime(visit) {
  if (!visit?.start_time || !visit.duration_minutes) return '';
  const [h, m] = visit.start_time.split(':').map(Number), end = h * 60 + m + Number(visit.duration_minutes);
  return `${visit.start_time}–${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export function VisitTimeFields({ form, setForm, idPrefix = 'visit' }) {
  return <div className="visit-time">
    <label className="visit-all-day"><input type="checkbox" checked={!!form.all_day} onChange={event => setForm(f => ({ ...f, all_day: event.target.checked, start_time: f.start_time || '09:00', duration_minutes: f.duration_minutes || 120 }))} /> All day</label>
    {!form.all_day && <div className="form-row">
      <div className="form-group"><label htmlFor={`${idPrefix}-start`}>Start time</label><input id={`${idPrefix}-start`} type="time" step={900} required value={form.start_time || '09:00'} onChange={event => setForm(f => ({ ...f, start_time: event.target.value }))} /></div>
      <div className="form-group"><label htmlFor={`${idPrefix}-duration`}>Duration</label>
        <select id={`${idPrefix}-duration`} value={String(form.duration_minutes || 120)} onChange={event => setForm(f => ({ ...f, duration_minutes: Number(event.target.value) }))}>
          {[30, 60, 90, 120, 180, 240, 300, 360, 480].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</option>)}
        </select></div>
    </div>}
  </div>;
}

export function VisitWarnings({ warnings }) {
  if (!warnings?.length) return null;
  const hard = warnings.filter(w => w.severity === 'hard'), notes = warnings.filter(w => w.severity !== 'hard');
  return <div className="visit-warnings" role="alert">
    {hard.length > 0 && <div className="visit-warnings-group is-hard"><strong><AlertTriangle size={14} aria-hidden="true" /> Needs a second look</strong><ul>{hard.map(w => <li key={w.message}>{w.message}</li>)}</ul></div>}
    {notes.length > 0 && <div className="visit-warnings-group"><strong><Info size={14} aria-hidden="true" /> Worth knowing</strong><ul>{notes.map(w => <li key={w.message}>{w.message}</li>)}</ul></div>}
  </div>;
}

const keyOf = visit => JSON.stringify([visit.scheduled_date?.slice?.(0, 10) || '', visit.start_time || null, visit.start_time ? Number(visit.duration_minutes) : null,
  [...(visit.engineer_ids || [])].map(Number).sort(), String(visit.customer_id || '')]);

/* Runs the check before saving. Returns { warnings, run }: run(payload, save)
   checks first and stops to show any warnings; the next run (the person chose to
   save anyway) saves with confirm_warnings. Changing the visit clears it. An
   existing visit whose day, time and engineers did not change is not checked. */
export function useVisitCheck(initial = null) {
  const [warnings, setWarnings] = useState(null), [checkedFor, setCheckedFor] = useState(initial ? keyOf(initial) : '');
  async function run(payload, save) {
    const key = keyOf(payload);
    if (checkedFor !== key) {
      const result = await api.checkVisit(payload);
      setCheckedFor(key);
      if (result.warnings?.length) { setWarnings(result.warnings); return false; }
    }
    try { await save({ ...payload, confirm_warnings: true }); return true; }
    catch (error) {
      if (error.code === 'VISIT_CHECK' && error.warnings) { setWarnings(error.warnings); return false; }
      throw error;
    }
  }
  return { warnings, run, pending: !!warnings?.length, reset: () => { setWarnings(null); setCheckedFor(''); } };
}
