import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtDate } from './Shared';

/* What if (enhancement E05): try leave or new work against the live plan before
   changing anything. The result is a scenario only: nothing is saved, and the live
   plan below stays as it is. Unknown availability is shown as unknown, never as 0. */
const LEVELS = { 1: 'Junior', 2: 'Intermediate', 3: 'Senior', 4: 'Expert' };
const blank = { type: 'leave', user_id: '', from: '', to: '', hours: '', title: '', technology_id: '' };

function load(cell) {
  if (cell.state === 'availability_unknown') return 'Availability not set';
  if (cell.state === 'no_hours') return 'No hours available';
  if (cell.state === 'estimates_missing') return 'Estimates missing';
  return `${cell.capacity_percent}%`;
}

export default function WorkloadWhatIf({ asOf, engineers }) {
  const [open, setOpen] = useState(false), [changes, setChanges] = useState([]), [draft, setDraft] = useState(blank);
  const [technologies, setTechnologies] = useState([]), [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.technologies().then(rows => setTechnologies(Array.isArray(rows) ? rows.filter(t => t.active !== 0) : [])).catch(() => setTechnologies([])); }, [open]);
  useEffect(() => { setResult(null); }, [asOf]);
  const name = id => engineers.find(e => e.id === Number(id))?.name || 'Engineer';
  const set = key => event => setDraft(d => ({ ...d, [key]: event.target.value }));

  function add(event) {
    event.preventDefault();
    const change = { type: draft.type, user_id: Number(draft.user_id), from: draft.from, to: draft.to,
      ...(draft.type === 'work' ? { hours: Number(draft.hours), title: draft.title.trim() || 'New work', ...(draft.technology_id ? { technology_id: Number(draft.technology_id) } : {}) } : {}) };
    setChanges(list => [...list, change]); setDraft(d => ({ ...blank, type: d.type })); setResult(null);
  }
  async function preview() {
    setBusy(true); setError('');
    try { setResult(await api.workloadScenario({ as_of: asOf, changes })); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }

  if (!open) return <p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>What if…</button> <span className="text-muted text-sm">Try leave or new work before changing anything.</span></p>;
  const techName = id => technologies.find(t => t.id === id)?.name;
  return <section className="card mb-20" aria-label="What if" style={{ padding: 14, borderStyle: 'dashed' }}>
    <div className="flex" style={{ justifyContent: 'space-between' }}><h2 className="section-title">What if…</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setChanges([]); setResult(null); }}>Close scenario</button></div>
    <p className="text-sm text-muted">A scenario only. Nothing here is saved; the live plan below is unchanged until you record the leave or create the work.</p>
    <form className="flex gap-6" style={{ flexWrap: 'wrap', alignItems: 'end' }} onSubmit={add}>
      <label className="text-sm">Change<select aria-label="Change type" value={draft.type} onChange={set('type')}><option value="leave">Leave</option><option value="work">New work</option></select></label>
      <label className="text-sm">Engineer<select aria-label="Engineer" required value={draft.user_id} onChange={set('user_id')}><option value="">Choose…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="text-sm">From<input aria-label="From" type="date" required value={draft.from} onChange={set('from')} /></label>
      <label className="text-sm">To<input aria-label="To" type="date" required min={draft.from || undefined} value={draft.to} onChange={set('to')} /></label>
      {draft.type === 'work' && <>
        <label className="text-sm">Hours<input aria-label="Hours" type="number" required min="0.5" max="2000" step="0.5" value={draft.hours} onChange={set('hours')} style={{ width: 80 }} /></label>
        <label className="text-sm">What<input aria-label="What" maxLength={100} value={draft.title} onChange={set('title')} placeholder="e.g. New firewall project" /></label>
        <label className="text-sm">Technology<select aria-label="Technology" value={draft.technology_id} onChange={set('technology_id')}><option value="">Any</option>{technologies.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </>}
      <button className="btn btn-ghost btn-sm">Add change</button>
    </form>
    {changes.length > 0 && <ul className="text-sm" style={{ margin: '10px 0' }}>{changes.map((c, i) => <li key={i}>
      {c.type === 'leave' ? `${name(c.user_id)} on leave ${fmtDate(c.from)} – ${fmtDate(c.to)}` : `${c.title}: ${c.hours}h for ${name(c.user_id)}, ${fmtDate(c.from)} – ${fmtDate(c.to)}${c.technology_id ? ` (${techName(c.technology_id) || 'technology'})` : ''}`}
      {' '}<button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove change ${i + 1}`} onClick={() => { setChanges(list => list.filter((_, j) => j !== i)); setResult(null); }}>Remove</button>
    </li>)}</ul>}
    {changes.length > 0 && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={preview}>{busy ? 'Working it out…' : 'Show the effect'}</button>}
    {error && <p className="error-msg" role="alert">{error}</p>}
    {result && <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <caption className="sr-only">Weekly load now and in this scenario</caption>
        <thead><tr><th scope="col">Engineer</th>{result.weeks.map(w => <th scope="col" key={w.start}>{fmtDate(w.start)}</th>)}</tr></thead>
        <tbody>{result.engineers.filter(e => e.changed || changes.some(c => c.technology_id)).map(e => <tr key={e.id}>
          <th scope="row">{e.name}{Object.entries(e.skill_levels).map(([t, level]) => <div key={t} className="text-sm text-muted">{techName(Number(t)) || 'Technology'}: {level ? LEVELS[level] : 'not rated'}</div>)}</th>
          {e.weeks.map(w => <td key={w.start} className="text-sm">
            <div>Now: {load(w.live)}</div>
            <div className={w.scenario.capacity_percent > 100 ? 'text-danger' : undefined}><strong>Then: {load(w.scenario)}</strong></div>
            {w.scenario.available_hours !== w.live.available_hours && <div className="text-muted">{w.live.available_hours ?? '?'}h → {w.scenario.available_hours ?? '?'}h available</div>}
            {w.scenario.estimated_hours !== w.live.estimated_hours && <div className="text-muted">+{Math.round((w.scenario.estimated_hours - w.live.estimated_hours) * 10) / 10}h work</div>}
          </td>)}
        </tr>)}</tbody>
      </table>
      {result.beyond_window.length > 0 && <p className="text-sm text-muted">Part of {result.beyond_window.join(', ')} falls after these four weeks and is not shown.</p>}
    </div>}
  </section>;
}
