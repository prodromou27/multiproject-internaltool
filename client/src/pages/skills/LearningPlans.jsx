import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Modal, fmtDate } from '../../components/Shared';
import { ToneBadge } from '../../components/EnterpriseUI';
import { useToast } from '../../components/Toast';

/* Learning plans (enhancement E08): a skill gap turned into a mentor, a target level
   and date, and evidence steps the engineer ticks off. Managers review progress.
   Training only: closing a plan never changes a rating; that stays a separate,
   deliberate rating in the matrix. Server: routes/skills.js. */

const levelName = (levels, value) => levels.find(l => l.value === value)?.label || '—';

export function PlanDialog({ data, technology, mentors, onClose, onSaved }) {
  const toast = useToast();
  const suggested = mentors.filter(m => m.technology_id === technology.id);
  const [form, setForm] = useState({ user_id: '', target_level: 3, target_date: '', mentor_id: suggested[0]?.id ? String(suggested[0].id) : '', steps: '' });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.createLearningPlan({ user_id: Number(form.user_id), technology_id: technology.id, target_level: Number(form.target_level), target_date: form.target_date,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null, steps: form.steps.split('\n').map(s => s.trim()).filter(Boolean) });
      toast.success('Learning plan started'); onSaved();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  const others = data.engineers.filter(e => !suggested.some(m => m.id === e.id) && String(e.id) !== form.user_id);
  return <Modal title={`Learning plan: ${technology.name}`} onClose={onClose} busy={saving}>
    <form onSubmit={submit}>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-group"><label htmlFor="plan-engineer">Engineer *</label>
        <select id="plan-engineer" required value={form.user_id} onChange={set('user_id')}><option value="">Choose…</option>
          {data.engineers.map(e => <option key={e.id} value={e.id}>{e.name}{data.ratings.find(r => r.user_id === e.id && r.technology_id === technology.id) ? ` (now ${levelName(data.levels, data.ratings.find(r => r.user_id === e.id && r.technology_id === technology.id).level)})` : ''}</option>)}
        </select></div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="plan-level">Target level *</label><select id="plan-level" value={form.target_level} onChange={set('target_level')}>{data.levels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
        <div className="form-group"><label htmlFor="plan-date">Target date *</label><input id="plan-date" type="date" required value={form.target_date} onChange={set('target_date')} /></div>
      </div>
      <div className="form-group"><label htmlFor="plan-mentor">Mentor</label>
        <select id="plan-mentor" value={form.mentor_id} onChange={set('mentor_id')}><option value="">No mentor</option>
          {suggested.filter(m => String(m.id) !== form.user_id).map(m => <option key={m.id} value={m.id}>{m.name} ({levelName(data.levels, m.level)}, suggested)</option>)}
          {others.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></div>
      <div className="form-group"><label htmlFor="plan-steps">Evidence steps, one per line</label><textarea id="plan-steps" rows={4} value={form.steps} onChange={set('steps')} placeholder={'Shadow two upgrades\nLead one upgrade with the mentor'} /></div>
      <p className="text-muted text-sm">A plan is for learning only. Finishing it does not change the rating; rate the engineer in the matrix when you judge they have reached the level.</p>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Start plan'}</button></div>
    </form>
  </Modal>;
}

export function PlanSteps({ plan, onChanged }) {
  const toast = useToast();
  async function toggle(step) {
    try { onChanged(await api.setLearningPlanStep(plan.id, step.id, !step.done_at)); }
    catch (failure) { toast.error(failure.message); }
  }
  if (!plan.steps.length) return <span className="text-muted">No steps</span>;
  return <ul className="plan-steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
    {plan.steps.map(step => <li key={step.id}><label style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <input type="checkbox" checked={!!step.done_at} onChange={() => toggle(step)} disabled={!onChanged} />{step.title}
    </label></li>)}
  </ul>;
}

export function LearningPlans({ data, plans, canManage, onChanged }) {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(null), [note, setNote] = useState('');
  if (!plans.length) return <p className="text-muted">No learning plans yet. Start one from a gap in the Coverage view.</p>;
  async function close(plan, status) {
    try { await api.updateLearningPlan(plan.id, { status }); toast.success(status === 'completed' ? 'Plan completed. Update the rating in the matrix if they reached the level.' : 'Plan cancelled'); onChanged(); }
    catch (failure) { toast.error(failure.message); }
  }
  async function review(plan) {
    try { await api.reviewLearningPlan(plan.id, { note }); setReviewing(null); setNote(''); toast.success('Review recorded'); onChanged(); }
    catch (failure) { toast.error(failure.message); }
  }
  return <div className="table-wrap">
    <table>
      <caption className="sr-only">Learning plans</caption>
      <thead><tr><th scope="col">Engineer</th><th scope="col">Technology</th><th scope="col">Level</th><th scope="col">By</th><th scope="col">Mentor</th><th scope="col">Steps</th><th scope="col">Last review</th>{canManage && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
      <tbody>{plans.map(plan => {
        const done = plan.steps.filter(s => s.done_at).length;
        return <tr key={plan.id}>
          <td>{plan.engineer_name}{plan.status !== 'active' && <div><ToneBadge tone={plan.status === 'completed' ? 'success' : 'neutral'}>{plan.status === 'completed' ? 'Completed' : 'Cancelled'}</ToneBadge></div>}</td>
          <td>{plan.technology_name}</td>
          <td>{levelName(data.levels, plan.current_level)} → {levelName(data.levels, plan.target_level)}</td>
          <td className={plan.overdue ? 'text-danger' : undefined}>{fmtDate(plan.target_date)}{plan.overdue && <div className="text-sm">Past the date</div>}</td>
          <td>{plan.mentor_name || <span className="text-muted">None</span>}</td>
          <td><div className="text-sm text-muted">{done} of {plan.steps.length} done</div><PlanSteps plan={plan} onChanged={canManage && plan.status === 'active' ? () => onChanged() : null} /></td>
          <td>{plan.reviews[0] ? <><div className="text-sm">{plan.reviews[0].note}</div><div className="text-sm text-muted">{plan.reviews[0].reviewed_by_name}, {fmtDate(plan.reviews[0].reviewed_at)}</div></> : <span className="text-muted">None yet</span>}
            {reviewing === plan.id && <form onSubmit={event => { event.preventDefault(); review(plan); }} style={{ marginTop: 6 }}>
              <textarea aria-label={`Review of ${plan.engineer_name}'s ${plan.technology_name} plan`} rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} autoFocus />
              <div className="flex gap-6"><button className="btn btn-primary btn-sm" disabled={!note.trim()}>Save review</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewing(null)}>Cancel</button></div>
            </form>}</td>
          {canManage && <td style={{ whiteSpace: 'nowrap' }}>{plan.status === 'active' && <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setReviewing(plan.id); setNote(''); }}>Review</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => close(plan, 'completed')}>Complete</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => close(plan, 'cancelled')}>Cancel plan</button>
          </>}</td>}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/** My Work: the plans this engineer is on (and those they mentor); nothing when there are none. */
export function MyLearningPlans({ userId }) {
  const [plans, setPlans] = useState([]);
  useEffect(() => { api.myLearningPlans().then(data => setPlans(Array.isArray(data?.plans) ? data.plans : [])).catch(() => setPlans([])); }, []);
  if (!plans.length) return null;
  const replace = updated => setPlans(current => current.map(plan => (plan.id === updated.id ? updated : plan)));
  return <section className="card mt-16" aria-label="Learning plans">
    <div className="section-header"><h2 className="section-title">Learning plans</h2></div>
    {plans.map(plan => <div key={plan.id} style={{ marginBottom: 10 }}>
      <strong>{plan.technology_name}</strong>{Number(plan.user_id) === Number(userId) ? '' : ` · mentoring ${plan.engineer_name}`}
      <div className={`text-sm ${plan.overdue ? 'text-danger' : 'text-muted'}`}>By {fmtDate(plan.target_date)}{plan.mentor_name && Number(plan.user_id) === Number(userId) ? ` · mentor ${plan.mentor_name}` : ''}</div>
      <PlanSteps plan={plan} onChanged={Number(plan.user_id) === Number(userId) ? replace : null} />
    </div>)}
  </section>;
}
