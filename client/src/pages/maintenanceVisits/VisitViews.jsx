import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Star, X } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { useLiveVersion } from '../../live';
import { localDateISO } from '../../utils/dates';
import './VisitViews.css';

/* Maintenance Visits → Calendar and → Team availability (the scheduling
   assistant). Server: GET /maintenance-visits?month, /visit-planning/*. */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDateISO(d); };
const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); return addDays(iso, -((d.getDay() + 6) % 7)); };
const dayLabel = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthLabel = ym => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** A month of visits, Monday first. Clicking a visit opens it; managers and planners can plan on a day. */
export function VisitCalendar({ onOpen, onPlan }) {
  const today = localDateISO(new Date());
  const [month, setMonth] = useState(today.slice(0, 7)), [visits, setVisits] = useState(null), [error, setError] = useState('');
  const live = useLiveVersion();
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.maintenanceVisits({ month }, { signal: controller.signal }).then(rows => { if (!controller.signal.aborted) setVisits(Array.isArray(rows) ? rows : rows?.rows || []); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [month, live]);
  const cells = useMemo(() => {
    const first = `${month}-01`, start = mondayOf(first);
    const out = [];
    for (let day = start; out.length < 42; day = addDays(day, 1)) { out.push(day); if (out.length >= 35 && day.slice(0, 7) > month && new Date(`${day}T12:00:00`).getDay() === 0) break; }
    return out;
  }, [month]);
  const byDay = useMemo(() => { const map = new Map(); for (const visit of visits || []) { const day = String(visit.scheduled_date).slice(0, 10); if (!map.has(day)) map.set(day, []); map.get(day).push(visit); } return map; }, [visits]);
  return <section className="card vv-calendar" aria-label="Visit calendar">
    <header className="vv-head">
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronLeft size={16} /></button>
      <h2>{monthLabel(month)}</h2>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Next month" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronRight size={16} /></button>
      {month !== today.slice(0, 7) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(today.slice(0, 7))}>Today</button>}
    </header>
    {error ? <div className="error-msg" role="alert">{error}</div> : !visits ? <p className="text-muted">Loading…</p> : <div className="vv-grid" role="grid">
      {WEEKDAYS.map(day => <div key={day} className="vv-weekday" role="columnheader">{day}</div>)}
      {cells.map(day => {
        const list = byDay.get(day) || [], outside = day.slice(0, 7) !== month;
        return <div key={day} role="gridcell" className={`vv-day${outside ? ' is-outside' : ''}${day === today ? ' is-today' : ''}`}>
          <div className="vv-date"><span>{Number(day.slice(8))}</span>{onPlan && !outside && day >= today && <button type="button" className="vv-add" aria-label={`Plan a visit on ${dayLabel(day)}`} title="Plan a visit" onClick={() => onPlan({ scheduled_date: day })}><Plus size={12} /></button>}</div>
          {list.map(visit => <button type="button" key={visit.id} className={`vv-visit is-${visit.status}`} onClick={() => onOpen(visit)} title={`${visit.title} · ${visit.customer_name}${visit.engineer_names ? ` · ${visit.engineer_names}` : ''}`}>
            <strong>{visit.title}</strong><span>{visit.customer_name}{visit.engineer_names ? ` · ${visit.engineer_names}` : ''}</span></button>)}
        </div>;
      })}
    </div>}
  </section>;
}

function TimeOffForm({ engineers, onSaved, onClose }) {
  const toast = useToast();
  const today = localDateISO(new Date());
  const [form, setForm] = useState({ user_id: '', start_date: today, end_date: today, reason: '' });
  async function save(event) {
    event.preventDefault();
    try { await api.addTimeOff({ ...form, user_id: Number(form.user_id) }); toast.success('Time off added'); onSaved(); }
    catch (failure) { toast.error(failure.message); }
  }
  return <form className="vv-timeoff" onSubmit={save}>
    <label><span>Who</span><select required value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}><option value="">Choose…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label><span>First day</span><input type="date" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date }))} /></label>
    <label><span>Last day</span><input type="date" required min={form.start_date} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></label>
    <label><span>Reason (optional)</span><input value={form.reason} maxLength={200} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Leave, training…" /></label>
    <button type="submit" className="btn btn-primary btn-sm">Add time off</button><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
  </form>;
}

/** The scheduling assistant: who is free when, and the best slots for a customer's visit. */
export function TeamAvailability({ customers, onPlan }) {
  const toast = useToast();
  const [from, setFrom] = useState(() => mondayOf(localDateISO(new Date())));
  const [teamId, setTeamId] = useState(''), [customerId, setCustomerId] = useState(''), [teams, setTeams] = useState([]);
  const [data, setData] = useState(null), [error, setError] = useState(''), [addingOff, setAddingOff] = useState(false), [version, setVersion] = useState(0);
  const live = useLiveVersion();
  const to = addDays(from, 13);
  useEffect(() => { api.teams().then(rows => setTeams(Array.isArray(rows) ? rows : [])).catch(() => setTeams([])); }, []);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.visitAvailability({ from, to, ...(teamId ? { team_id: teamId } : {}), ...(customerId ? { customer_id: customerId } : {}) }, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [from, to, teamId, customerId, version, live]);
  const today = localDateISO(new Date());
  const plan = (date, engineerIds) => onPlan({ scheduled_date: date, engineer_ids: engineerIds, ...(customerId ? { customer_id: Number(customerId) } : {}) });
  async function removeOff(id) {
    try { await api.removeTimeOff(id); toast.success('Time off removed'); setVersion(v => v + 1); } catch (failure) { toast.error(failure.message); }
  }
  return <section className="card vv-availability" aria-label="Team availability">
    <header className="vv-head vv-head-wrap">
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous two weeks" onClick={() => setFrom(f => addDays(f, -14))}><ChevronLeft size={16} /></button>
      <h2>{dayLabel(from)} – {dayLabel(to)}</h2>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Next two weeks" onClick={() => setFrom(f => addDays(f, 14))}><ChevronRight size={16} /></button>
      <label className="vv-filter"><span>Customer</span><select value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">Any customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {teams.length > 0 && <label className="vv-filter"><span>Team</span><select value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">All engineers</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingOff(v => !v)}><Plus size={13} /> Time off</button>
    </header>
    {addingOff && data && <TimeOffForm engineers={data.engineers} onClose={() => setAddingOff(false)} onSaved={() => { setAddingOff(false); setVersion(v => v + 1); }} />}
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : <>
      <div className="vv-suggest" aria-label="Suggested slots">
        <h3>Suggested slots{customerId ? ` for ${customers.find(c => String(c.id) === customerId)?.name || 'this customer'}` : ''}</h3>
        {!data.suggestions.length ? <p className="text-muted text-sm">No free weekday in these two weeks. Try the next two weeks.</p> :
          <div className="vv-chips">{data.suggestions.map(slot => <button type="button" key={slot.date} className="vv-chip" onClick={() => plan(slot.date, [slot.engineers[0].id])}>
            <strong>{dayLabel(slot.date)}</strong><span>{slot.engineers.map(e => `${e.serves_customer ? '★ ' : ''}${e.name}`).join(', ')}</span></button>)}</div>}
        {customerId && <p className="text-muted text-sm">★ serves this customer (its team, or assigned directly). Choosing a slot opens a new visit with that day and engineer filled in.</p>}
      </div>
      {!data.engineers.length ? <p className="text-muted">No engineers in this team.</p> : <div className="table-wrap"><table className="vv-table">
        <thead><tr><th scope="col">Engineer</th>{data.days.map(day => <th scope="col" key={day.date} className={day.weekend ? 'is-weekend' : ''}>{dayLabel(day.date)}</th>)}</tr></thead>
        <tbody>{data.engineers.map(engineer => <tr key={engineer.id}>
          <th scope="row">{engineer.serves_customer && <Star size={12} aria-label="Serves this customer" />} {engineer.name}<small>{engineer.visit_count} visit{engineer.visit_count === 1 ? '' : 's'}</small></th>
          {engineer.cells.map(cell => {
            const weekend = data.days.find(d => d.date === cell.date)?.weekend;
            return <td key={cell.date} className={`${weekend ? 'is-weekend ' : ''}${cell.free ? 'is-free' : 'is-busy'}`}>
              {cell.visits.map(v => <div key={v.id} className="vv-busy" title={v.customer}>{v.title}</div>)}
              {cell.time_off && <div className="vv-off">{cell.time_off.reason}<button type="button" aria-label={`Remove time off for ${engineer.name}`} onClick={() => removeOff(cell.time_off.id)}><X size={11} /></button></div>}
              {cell.no_hours && !cell.time_off && <div className="vv-off">0 h this week</div>}
              {cell.tasks_due > 0 && <div className="vv-tasks">{cell.tasks_due} task{cell.tasks_due === 1 ? '' : 's'} due</div>}
              {cell.free && cell.date >= today && <button type="button" className="vv-plan" aria-label={`Plan a visit with ${engineer.name} on ${dayLabel(cell.date)}`} onClick={() => plan(cell.date, [engineer.id])}>Free</button>}
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
