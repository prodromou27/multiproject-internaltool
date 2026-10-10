import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { PageHeader } from '../components/PageLayout';
import { MetricStrip, Surface, Tabs, ToneBadge } from '../components/EnterpriseUI';
import { fmtDate } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useLiveVersion } from '../live';
import './SkillMatrix.css';

/* Skill matrix: each engineer rated per technology (Junior to Expert), with the
   activities they logged on it in the last year as evidence, and per technology
   whether enough engineers are Senior or Expert. Server: routes/skills.js. */

const STATUS = {
  gap: { tone: 'danger', text: 'Gap' },
  at_risk: { tone: 'warning', text: 'At risk' },
  covered: { tone: 'success', text: 'Covered' },
};
const RISK_ORDER = { gap: 0, at_risk: 1, covered: 2 };
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function AddTechnology({ onAdded }) {
  const toast = useToast();
  const [name, setName] = useState(''), [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try { await api.createTechnology({ name: name.trim() }); toast.success(`${name.trim()} added`); setName(''); onAdded(); }
    catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  return <form className="sm-add" onSubmit={submit}>
    <label htmlFor="sm-new-tech" className="sr-only">New technology</label>
    <input id="sm-new-tech" value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="New technology, e.g. FortiGate" />
    <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !name.trim()}><Plus size={14} /> Add technology</button>
  </form>;
}

function Matrix({ data, technologies, engineers, rating, evidence, coverageOf, onRate }) {
  if (!engineers.length) return <p className="text-muted">No engineers in this team.</p>;
  return <div className="table-wrap sm-matrix-wrap">
    <table className="sm-matrix">
      <caption className="sr-only">Rating of each engineer per technology</caption>
      <thead><tr>
        <th scope="col" className="sm-tech-col">Technology</th>
        {engineers.map(e => <th scope="col" key={e.id}>{e.name}</th>)}
        <th scope="col">Coverage</th>
      </tr></thead>
      <tbody>{technologies.map(tech => {
        const cov = coverageOf(tech.id), status = STATUS[cov.status];
        return <tr key={tech.id}>
          <th scope="row" className="sm-tech-col">{tech.name}</th>
          {engineers.map(e => {
            const r = rating(e.id, tech.id), ev = evidence(e.id, tech.id);
            const title = [r && `Rated by ${r.rated_by_name || 'unknown'} on ${fmtDate(r.rated_at)}`, r?.note, ev && `${plural(ev.activities, 'activity', 'activities')} logged since ${fmtDate(data.activity_since)}, last on ${fmtDate(ev.last_date)}`].filter(Boolean).join('\n');
            return <td key={e.id} className={`sm-cell${r ? ` is-level-${r.level}` : ''}`} title={title || undefined}>
              {data.can_manage
                ? <select aria-label={`${e.name}, ${tech.name}`} value={r?.level || ''} onChange={event => onRate(e, tech, event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Not rated</option>
                    {data.levels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                : <span>{r ? data.levels.find(l => l.value === r.level)?.label : <span className="text-muted">—</span>}</span>}
              {ev && <small className="sm-evidence">{plural(ev.activities, 'activity', 'activities')}</small>}
            </td>;
          })}
          <td><ToneBadge tone={status.tone}>{status.text}</ToneBadge><small className="sm-evidence">{cov.skilled} of {cov.target} skilled</small></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function Coverage({ data, technologies, engineersById, rating, coverageOf, onTarget }) {
  const rows = [...technologies].sort((a, b) => RISK_ORDER[coverageOf(a.id).status] - RISK_ORDER[coverageOf(b.id).status] || b.devices - a.devices || a.name.localeCompare(b.name));
  const level = value => data.levels.find(l => l.value === value)?.label;
  return <div className="table-wrap">
    <table className="sm-coverage">
      <caption className="sr-only">Coverage per technology, riskiest first</caption>
      <thead><tr>
        <th scope="col">Technology</th><th scope="col">Status</th><th scope="col">Senior or Expert</th>
        <th scope="col">Needed</th><th scope="col">Learning it</th><th scope="col">At customers</th>
      </tr></thead>
      <tbody>{rows.map(tech => {
        const cov = coverageOf(tech.id), status = STATUS[cov.status];
        const people = min => data.ratings.filter(r => r.technology_id === tech.id && (min ? r.level >= 3 : r.level < 3) && engineersById.has(r.user_id))
          .sort((a, b) => b.level - a.level).map(r => `${engineersById.get(r.user_id).name} (${level(r.level)})`);
        const skilled = people(true), learning = people(false);
        return <tr key={tech.id}>
          <th scope="row">{tech.name}</th>
          <td><ToneBadge tone={status.tone}>{status.text}</ToneBadge>{cov.single_point && <small className="sm-evidence">Only one person</small>}</td>
          <td>{skilled.length ? skilled.join(', ') : <span className="text-muted">Nobody</span>}</td>
          <td>{data.can_manage
            ? <input type="number" min="1" max="20" className="sm-target" aria-label={`Skilled engineers needed for ${tech.name}`} defaultValue={cov.target}
                onBlur={event => { const value = Number(event.target.value); if (value !== cov.target) onTarget(tech, value, event.target); }} />
            : cov.target}</td>
          <td>{learning.length ? learning.join(', ') : <span className="text-muted">—</span>}</td>
          <td>{tech.devices ? `${plural(tech.devices, 'device')} at ${plural(tech.customers, 'customer')}` : <span className="text-muted">—</span>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export default function SkillMatrix() {
  const { user } = useAuth();
  const toast = useToast();
  const live = useLiveVersion();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [view, setView] = useState('matrix'), [team, setTeam] = useState(''), [search, setSearch] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.skillMatrix()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { load(); }, [load, live]);

  const lookups = useMemo(() => {
    if (!data) return null;
    const ratings = new Map(data.ratings.map(r => [`${r.user_id}:${r.technology_id}`, r]));
    const activity = new Map(data.activity.map(a => [`${a.user_id}:${a.technology_id}`, a]));
    const coverage = new Map(data.coverage.map(c => [c.technology_id, c]));
    return {
      rating: (u, t) => ratings.get(`${u}:${t}`),
      evidence: (u, t) => activity.get(`${u}:${t}`),
      coverageOf: t => coverage.get(t),
      engineersById: new Map(data.engineers.map(e => [e.id, e])),
    };
  }, [data]);

  async function rate(engineer, tech, level) {
    try { await api.rateSkill(engineer.id, tech.id, { level }); await load(); }
    catch (failure) { toast.error(failure.message); }
  }
  async function setTarget(tech, target, input) {
    try { await api.setSkillTarget(tech.id, { target }); toast.success(`${tech.name}: ${plural(target, 'skilled engineer')} needed`); await load(); }
    catch (failure) { toast.error(failure.message); if (input) input.value = lookups.coverageOf(tech.id).target; }
  }

  const engineers = !data ? [] : data.engineers.filter(e => !team || e.team_ids.includes(Number(team)));
  const technologies = !data ? [] : data.technologies.filter(t => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));
  const counts = !data ? {} : data.coverage.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1, single: (acc.single || 0) + (c.single_point ? 1 : 0) }), {});

  return <div className="page sm-page">
    <PageHeader title="Skill matrix" meta="What the team knows per technology, and where knowledge rests on too few people. Senior and Expert count as skilled." />
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : <>
      <MetricStrip items={[
        { key: 'tech', label: 'Technologies', value: data.technologies.length, note: `${plural(data.engineers.length, 'engineer')} rated against them` },
        { key: 'gap', label: 'Gaps', value: counts.gap || 0, tone: counts.gap ? 'danger' : undefined, note: 'Nobody Senior or Expert' },
        { key: 'risk', label: 'At risk', value: counts.at_risk || 0, tone: counts.at_risk ? 'warning' : undefined, note: 'Fewer skilled than needed' },
        { key: 'single', label: 'Single points of knowledge', value: counts.single || 0, note: 'Only one skilled engineer' },
      ]} />
      <Surface>
        <div className="sm-toolbar">
          <Tabs label="Skill matrix views" value={view} onChange={setView} items={[{ key: 'matrix', label: 'Matrix' }, { key: 'coverage', label: 'Coverage', count: (counts.gap || 0) + (counts.at_risk || 0) }]} />
          <div className="sm-filters">
            <label>Team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Technology<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" /></label>
          </div>
        </div>
        {user?.role === 'manager' && <AddTechnology onAdded={load} />}
        {!data.technologies.length ? <p className="text-muted">No technologies yet.{user?.role === 'manager' ? ' Add the first one above.' : ''}</p>
          : !technologies.length ? <p className="text-muted">No technology matches “{search}”.</p>
          : view === 'matrix'
            ? <Matrix data={data} technologies={technologies} engineers={engineers} {...lookups} onRate={rate} />
            : <Coverage data={data} technologies={technologies} {...lookups} onTarget={setTarget} />}
        {view === 'matrix' && data.activity.length > 0 && <p className="sm-footnote">Activity counts are service activities logged on the technology since {fmtDate(data.activity_since)}.</p>}
      </Surface>
    </>}
  </div>;
}
