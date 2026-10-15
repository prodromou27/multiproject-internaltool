import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { DraftBanner, useFormDraft } from '../hooks/useFormDraft';
import { useToast } from './Toast';

/* Guided visit completion (enhancement E03): on the visit, the engineer works
   through a checklist (OK / issue / not applicable, with notes), logs the time
   spent, adds recommendations from what was found, then submits the report with
   the buttons below. Unsaved checklist work is kept as a draft in this browser. */
const RESULTS = [['ok', 'OK'], ['issue', 'Issue'], ['na', 'N/A']];

export default function VisitRun({ visit, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const onVisit = ['manager', 'planner'].includes(user.role) || (visit.engineer_ids || []).map(Number).includes(Number(user.id));
  const [templates, setTemplates] = useState([]);
  const [checklist, setChecklist] = useState(visit.checklist || null);
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState({ hours: '', description: '' }), [logging, setLogging] = useState(false);
  const draft = useFormDraft({ name: `visit-checklist:${visit.id}`, value: checklist, base: visit.checklist?.updated_at ?? null, enabled: onVisit });
  useEffect(() => { if (onVisit) api.visitChecklists().then(data => setTemplates(Array.isArray(data?.rows) ? data.rows : [])).catch(() => setTemplates([])); }, [onVisit]);
  if (!onVisit || visit.status === 'cancelled') return null;

  const start = id => {
    const template = templates.find(t => t.id === id);
    if (template) setChecklist({ name: template.name, items: template.items.map(text => ({ text, result: 'open', note: '' })) });
  };
  const setItem = (index, changes) => setChecklist(c => ({ ...c, items: c.items.map((item, i) => (i === index ? { ...item, ...changes } : item)) }));
  const open = checklist ? checklist.items.filter(item => item.result === 'open').length : 0;
  const issues = checklist ? checklist.items.filter(item => item.result === 'issue') : [];

  async function saveChecklist() {
    setSaving(true);
    try { const result = await api.saveVisitChecklist(visit.id, checklist); setChecklist(result.checklist); draft.clear(); toast.success('Checklist saved'); onSaved?.(); }
    catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  async function logTime(event) {
    event.preventDefault(); setLogging(true);
    try { await api.logTime({ visit_id: visit.id, hours: Number(time.hours), description: time.description.trim() || null }); setTime({ hours: '', description: '' }); toast.success('Time logged'); }
    catch (failure) { toast.error(failure.message); } finally { setLogging(false); }
  }

  return <section className="visit-run" aria-label="Run this visit">
    <div className="divider" />
    <h3 className="section-title" style={{ fontSize: 14 }}>Run this visit</h3>
    <DraftBanner draft={draft} onRestore={data => data && setChecklist(data)} />

    <h4 className="text-sm" style={{ margin: '8px 0 4px' }}>1. Checklist</h4>
    {!checklist ? (templates.length
      ? <label className="text-sm">Start from <select aria-label="Checklist to use" defaultValue="" onChange={event => start(event.target.value)}><option value="" disabled>Choose a checklist…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      : <p className="text-sm text-muted">No checklists are set up yet (Settings → Visit checklists).</p>)
      : <div>
        <div className="text-sm text-muted">{checklist.name}{open ? ` · ${open} still to check` : ' · all checked'}{checklist.updated_by ? ` · saved by ${checklist.updated_by}` : ''}</div>
        <ol style={{ paddingLeft: 18, margin: '6px 0' }}>{checklist.items.map((item, index) => <li key={index} style={{ marginBottom: 6 }}>
          <div>{item.text}</div>
          <div className="flex gap-6" role="radiogroup" aria-label={`Result: ${item.text}`}>{RESULTS.map(([value, label]) => (
            <label key={value} className="text-sm" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="radio" name={`check-${visit.id}-${index}`} checked={item.result === value} onChange={() => setItem(index, { result: value })} />{label}
            </label>))}</div>
          {(item.result === 'issue' || item.note) && <input aria-label={`Note: ${item.text}`} placeholder="What did you find?" maxLength={1000} value={item.note || ''} onChange={event => setItem(index, { note: event.target.value })} style={{ marginTop: 4 }} />}
        </li>)}</ol>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={saveChecklist}>{saving ? 'Saving…' : 'Save checklist'}</button>
      </div>}

    <h4 className="text-sm" style={{ margin: '12px 0 4px' }}>2. Time on this visit</h4>
    <form className="flex gap-6" onSubmit={logTime} style={{ flexWrap: 'wrap' }}>
      <input aria-label="Hours" type="number" min="0.25" max="24" step="0.25" required placeholder="Hours" value={time.hours} onChange={event => setTime(t => ({ ...t, hours: event.target.value }))} style={{ width: 90 }} />
      <input aria-label="What you did" maxLength={500} placeholder="What you did (optional)" value={time.description} onChange={event => setTime(t => ({ ...t, description: event.target.value }))} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn btn-ghost btn-sm" disabled={logging || !time.hours}>{logging ? 'Logging…' : 'Log time'}</button>
    </form>

    <h4 className="text-sm" style={{ margin: '12px 0 4px' }}>3. Recommendations</h4>
    <p className="text-sm" style={{ margin: 0 }}>{issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found. ` : ''}
      <Link to={`/customers/${visit.customer_id}/service-profile?section=recommendations&source_visit=${visit.id}&create=1`}>Add a recommendation from this visit</Link></p>

    <h4 className="text-sm" style={{ margin: '12px 0 4px' }}>4. Report</h4>
    <p className="text-sm text-muted" style={{ margin: 0 }}>Submit the report with the buttons below once the visit is done.</p>
  </section>;
}
