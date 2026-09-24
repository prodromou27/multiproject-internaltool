import { useEffect,useRef,useState } from 'react';
import { api } from '../api';
import { Modal } from './Shared';

export default function ReportScheduleDialog({ report,onClose }) {
  const [data,setData] = useState(null),[form,setForm] = useState(null);
  const [error,setError] = useState(''),[saving,setSaving] = useState(false),[retry,setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null); setForm(null);
    api.savedReportSchedule(report.id,{ signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setData(value);
      setForm(value.schedule || { frequency: 'weekly',day: 1,hour: 9,minute: 0,enabled: false,recipient_ids: [],version: 0 });
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [report.id,retry]);
  const set = (key,value) => setForm(old => ({ ...old,[key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current=true; setSaving(true); setError('');
    try { await api.updateSavedReportSchedule(report.id,form); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { lock.current=false; setSaving(false); }
  }
  return <Modal title={`Delivery schedule: ${report.name}`} onClose={saving ? () => {} : onClose}>
    {error && <div className="error-msg" role="alert">{error}{!data && <button className="btn btn-ghost" onClick={() => setRetry(value => value+1)}>Retry</button>}</div>}
    {!form ? !error && <p role="status">Loading schedule...</p> : <form onSubmit={submit}>
      <p className="text-muted text-sm">CSV delivery uses current data with the saved definition, including fixed date filters. Times are UTC. Private reports can only be sent to their owner. Each delivery checks current access.</p>
      {data.schedule && <p className="text-sm">Next: {data.schedule.next_run || 'Disabled'}<br />Last: {data.schedule.last_run || 'Never'} · {data.schedule.last_status || 'Not run'}{data.schedule.last_error && <><br />{data.schedule.last_error}</>}</p>}
      <fieldset disabled={saving} style={{ border: 0,padding: 0 }}>
        <label className="flex gap-8"><input type="checkbox" checked={form.enabled} onChange={event => set('enabled',event.target.checked)} />Enable delivery</label>
        <div className="form-group"><label htmlFor="schedule-frequency">Frequency</label><select id="schedule-frequency" value={form.frequency} onChange={event => setForm(old => ({ ...old,frequency: event.target.value,day: event.target.value==='daily' ? 0 : 1 }))}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
        {form.frequency!=='daily' && <div className="form-group"><label htmlFor="schedule-day">{form.frequency==='weekly' ? 'Weekday' : 'Day of month (1–28)'}</label>{form.frequency==='weekly' ? <select id="schedule-day" value={form.day} onChange={event => set('day',Number(event.target.value))}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index) => <option key={day} value={index}>{day}</option>)}</select> : <input id="schedule-day" type="number" min={1} max={28} required value={form.day} onChange={event => set('day',Number(event.target.value))} />}</div>}
        <div className="form-row"><div className="form-group"><label htmlFor="schedule-hour">UTC hour</label><input id="schedule-hour" type="number" min={0} max={23} required value={form.hour} onChange={event => set('hour',Number(event.target.value))} /></div><div className="form-group"><label htmlFor="schedule-minute">Minute</label><input id="schedule-minute" type="number" min={0} max={59} required value={form.minute} onChange={event => set('minute',Number(event.target.value))} /></div></div>
        <fieldset><legend>Manager recipients (up to 20)</legend>{data.recipients.filter(user => data.visibility==='management' || user.id===report.owner_id).map(user => <label key={user.id} style={{ display: 'flex',gap: 8,margin: '8px 0' }}><input type="checkbox" checked={form.recipient_ids.includes(user.id)} disabled={!form.recipient_ids.includes(user.id) && form.recipient_ids.length>=20} onChange={event => set('recipient_ids',event.target.checked ? [...form.recipient_ids,user.id] : form.recipient_ids.filter(id => id!==user.id))} />{user.name}</label>)}</fieldset>
        {form.recipient_ids.some(id => !data.recipients.some(user => user.id===id) || (data.visibility==='private' && id!==report.owner_id)) && <p role="status">Some saved recipients are no longer eligible. Clear recipients and select valid managers before enabling delivery. <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('recipient_ids',[])}>Clear recipients</button></p>}
      </fieldset>
      <p className="text-muted text-sm">Exports over 5000 rows fail. Failed or interrupted delivery slots are not automatically retried, which avoids duplicate emails; a failed send may have reached some recipients.</p>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save schedule'}</button></div>
    </form>}
  </Modal>;
}
