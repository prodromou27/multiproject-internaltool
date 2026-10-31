import { useEffect, useState } from 'react';
import { CalendarDays, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../components/Shared';

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

/* Settings → Time & region → Business calendar: the working days and public
   holidays that SLAs in working days and visit planning follow, and the travel
   time kept between timed visits (server: businessCalendar.js). */
export function BusinessCalendarSettings() {
  const toast = useToast();
  const [saved, setSaved] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [holiday, setHoliday] = useState({ date: '', name: '', yearly: true });
  // Whatever comes back, the form has every field (Monday to Friday, no holidays, 30 minutes).
  const normal = result => ({ working_days: Array.isArray(result?.working_days) ? result.working_days : [1, 2, 3, 4, 5], holidays: Array.isArray(result?.holidays) ? result.holidays : [],
    travel_buffer_minutes: Number.isInteger(result?.travel_buffer_minutes) ? result.travel_buffer_minutes : 30 });
  useEffect(() => { api.businessCalendar().then(result => { setSaved(normal(result)); setForm(normal(result)); }).catch(failure => setError(failure.message)); }, []);
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!form) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const toggleDay = day => setForm(f => ({ ...f, working_days: f.working_days.includes(day) ? f.working_days.filter(d => d !== day) : [...f.working_days, day].sort() }));
  function addHoliday(event) {
    event.preventDefault();
    if (!holiday.date || !holiday.name.trim()) return;
    setForm(f => ({ ...f, holidays: [...f.holidays, { ...holiday, name: holiday.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setHoliday({ date: '', name: '', yearly: holiday.yearly });
  }
  async function save() {
    setBusy(true);
    try { const result = normal(await api.saveBusinessCalendar(form)); setSaved(result); setForm(result); toast.success('Business calendar saved'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <div className="card mb-16 business-calendar">
    <div className="card-header"><h3 className="u-334fee5"><CalendarDays size={15} /> Business calendar</h3></div>
    <p className="text-muted text-sm">SLAs counted in working days skip non-working days and holidays (unless a customer's contract type counts every day, in Contract types). Visit planning never offers them as slots.</p>
    <fieldset className="bc-days"><legend>Working days</legend>
      {WEEKDAYS.map(([day, label]) => <label key={day} className="bc-day"><input type="checkbox" checked={form.working_days.includes(day)} onChange={() => toggleDay(day)} /> {label}</label>)}
    </fieldset>
    <div className="form-group bc-buffer"><label htmlFor="bc-buffer">Travel time between timed visits (minutes)</label>
      <input id="bc-buffer" type="number" min={0} max={480} step={5} value={form.travel_buffer_minutes} onChange={event => setForm(f => ({ ...f, travel_buffer_minutes: Number(event.target.value) }))} />
      <small className="text-muted">Visits at different customers closer than this get a warning before saving.</small></div>
    <h4 className="bc-title">Public holidays</h4>
    {form.holidays.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Holiday</th><th>Repeats</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{form.holidays.map((h, index) => <tr key={`${h.date}-${index}`}>
        <td>{h.yearly ? fmtDate(h.date).replace(/[/.-]?\d{4}$/, '') : fmtDate(h.date)}</td><td>{h.name}</td><td>{h.yearly ? 'Every year' : 'Once'}</td>
        <td><button type="button" className="btn btn-sm btn-ghost btn-icon-danger" aria-label={`Remove ${h.name}`} onClick={() => setForm(f => ({ ...f, holidays: f.holidays.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></td>
      </tr>)}</tbody></table></div> : <p className="text-muted text-sm">No holidays yet.</p>}
    <form className="bc-add" onSubmit={addHoliday}>
      <input type="date" aria-label="Holiday date" value={holiday.date} onChange={event => setHoliday(h => ({ ...h, date: event.target.value }))} />
      <input aria-label="Holiday name" placeholder="e.g. Christmas Day" maxLength={80} value={holiday.name} onChange={event => setHoliday(h => ({ ...h, name: event.target.value }))} />
      <label className="bc-day"><input type="checkbox" checked={holiday.yearly} onChange={event => setHoliday(h => ({ ...h, yearly: event.target.checked }))} /> Every year</label>
      <button type="submit" className="btn btn-ghost btn-sm" disabled={!holiday.date || !holiday.name.trim()}><Plus size={13} /> Add holiday</button>
    </form>
    <p className="text-muted text-sm">Holidays on a different date each year (Easter, Kataklysmos) are added once per year.</p>
    <div className="flex gap-8 mt-12">
      <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy || !form.working_days.length} onClick={save}><Save size={13} /> {busy ? 'Saving…' : 'Save calendar'}</button>
      {dirty && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(saved)}>Undo changes</button>}
    </div>
  </div>;
}
