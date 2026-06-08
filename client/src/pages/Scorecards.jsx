import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart2, CheckCircle2, XCircle, AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, LabelList,
} from 'recharts';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, Modal } from '../components/Shared';
import {
  WEIGHTS, DIFFICULTY_LABELS, getRating,
  ScoreBadge, ScoreGauge, DimPicker, ScorecardBreakdown,
} from '../components/ScorecardUtils';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

/* ── Scorecard Form ───────────────────────────────────────── */
function ScorecardForm({ initial, pendingProjects, engineers, onSave, onClose }) {
  const blank = {
    project_id: '', engineer_id: '',
    timeline_rating: 3, delivery_quality: 3,
    communication_ownership: 3, documentation_quality: 3,
    customer_feedback: 3, difficulty: 3, notes: '',
  };
  const [form, setForm] = useState(initial ? {
    ...initial,
    project_id: String(initial.project_id),
    engineer_id: String(initial.engineer_id),
  } : blank);
  const [saving, setSaving]  = useState(false);
  const [err,    setErr]     = useState('');

  const setDim = key => val => setForm(f => ({ ...f, [key]: val }));
  const set    = key => e  => setForm(f => ({ ...f, [key]: e.target.value }));

  // When project changes, reset engineer selection if it's no longer available
  function handleProjectChange(e) {
    const pid = e.target.value;
    const proj = pendingProjects.find(p => String(p.id) === pid);
    const unscoredIds = proj ? proj.unscored_engineers.map(u => String(u.id)) : [];
    setForm(f => ({
      ...f,
      project_id: pid,
      engineer_id: unscoredIds.includes(f.engineer_id) ? f.engineer_id : '',
    }));
  }

  // Available engineers for the selected project (only those not yet scored)
  const selectedProject = !initial && pendingProjects.find(p => String(p.id) === String(form.project_id));
  const availableEngineers = !initial && selectedProject
    ? engineers.filter(e => selectedProject.unscored_engineers.some(u => u.id === e.id))
    : engineers;

  /* live preview */
  const dims  = { timeline_rating: form.timeline_rating, delivery_quality: form.delivery_quality,
                   communication_ownership: form.communication_ownership,
                   documentation_quality: form.documentation_quality, customer_feedback: form.customer_feedback };
  const wsum  = Object.entries(WEIGHTS).reduce((s,[k,m]) => s + dims[k] * m.pct / 100, 0);
  const baseP = Math.round(wsum / 5 * 1000) / 10;
  const mults = { 1:0.90, 2:0.95, 3:1.00, 4:1.05, 5:1.10 };
  const adjP  = Math.min(Math.round(baseP * mults[form.difficulty] * 10) / 10, 100);
  const r     = getRating(adjP);

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try { await onSave({ ...form, project_id: Number(form.project_id), engineer_id: Number(form.engineer_id) }); onClose(); }
    catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}

      {!initial && (
        <div className="form-row">
          <div className="form-group">
            <label>Project * <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 400 }}>(closed / completed only)</span></label>
            <select value={form.project_id} onChange={handleProjectChange} required>
              <option value="">Select project…</option>
              {pendingProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.unscored_engineers.length} pending)
                </option>
              ))}
            </select>
            {pendingProjects.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>
                ✅ All engineers have been scored on every closed/completed project.
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Engineer * <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 400 }}>(unscored only)</span></label>
            <select value={form.engineer_id} onChange={set('engineer_id')} required disabled={!form.project_id}>
              <option value="">{form.project_id ? 'Select engineer…' : 'Select a project first'}</option>
              {availableEngineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Live score preview */}
      <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        border: `2px solid ${r.color}20` }}>
        <ScoreGauge score={adjP} size={72} />
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Live Preview</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: r.color }}>{adjP}%</div>
          <ScoreBadge score={adjP} size="lg" />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', lineHeight: 1.8 }}>
          Base: <strong>{baseP}%</strong><br />
          Difficulty adj: <strong>{DIFFICULTY_LABELS[form.difficulty]?.mult}</strong><br />
          Target: <strong>80%</strong>
        </div>
      </div>

      {/* Dimension pickers */}
      <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase',
          letterSpacing: '.05em', marginBottom: 10 }}>Scoring Dimensions</div>
        {Object.entries(WEIGHTS).map(([key, meta]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ width: 195, flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{meta.label}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>Weight: {meta.pct}%</div>
            </div>
            <DimPicker value={form[key]} onChange={setDim(key)} />
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: meta.color,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{form[key]}</div>
          </div>
        ))}
      </div>

      {/* Difficulty */}
      <div className="form-group">
        <label>Project Difficulty</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {[1,2,3,4,5].map(d => {
            const dl = DIFFICULTY_LABELS[d];
            const active = form.difficulty === d;
            return (
              <button key={d} type="button" onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                style={{ padding: '5px 12px', borderRadius: 6, border: `2px solid ${active ? dl.color : '#e5e7eb'}`,
                  background: active ? dl.color + '15' : '#fff', color: active ? dl.color : '#6b7280',
                  cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400, transition: 'all .1s' }}>
                D{d} — {dl.label}<br/>
                <span style={{ fontSize: 10, opacity: .7 }}>{dl.mult}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-group">
        <label>Evaluator Notes (optional)</label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Additional observations…" />
      </div>

      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update Scorecard' : 'Save Scorecard'}</button>
      </div>
    </form>
  );
}

/* ── Detail Modal ─────────────────────────────────────────── */
function ScorecardDetail({ sc, isManager, onClose, onEdit, onDelete }) {
  const r = getRating(sc.adjusted_score);
  return (
    <Modal title="Project Quality Scorecard" onClose={onClose}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <ScoreGauge score={sc.adjusted_score} size={88} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{sc.engineer_name}</div>
          <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
            <Link to={`/projects/${sc.project_id}`} onClick={onClose}>{sc.project_title}</Link>
          </div>
          <ScoreBadge score={sc.adjusted_score} size="lg" />
          <div className="text-sm text-muted mt-4">
            Evaluated by {sc.evaluated_by_name} · {fmtDate(sc.updated_at || sc.created_at)}
          </div>
        </div>
        <div style={{ textAlign: 'center', background: '#f9fafb', borderRadius: 8, padding: '8px 16px' }}>
          <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>Target</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: sc.adjusted_score >= 80 ? 'var(--success)' : 'var(--danger)' }}>80%</div>
          <div style={{ fontSize: 11, color: sc.adjusted_score >= 80 ? 'var(--success)' : 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {sc.adjusted_score >= 80 ? <><CheckCircle2 size={11} /> Met</> : <><XCircle size={11} /> Not met</>}
          </div>
        </div>
      </div>

      <div className="divider" />
      <ScorecardBreakdown sc={sc} />

      {sc.notes && <>
        <div className="divider" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Evaluator Notes</div>
          <p style={{ fontSize: 13, color: '#374151' }}>{sc.notes}</p>
        </div>
      </>}

      <div className="modal-footer">
        {isManager && <button className="btn btn-danger btn-sm" onClick={() => { onDelete(sc.id); onClose(); }}>Delete</button>}
        {isManager && <button className="btn btn-ghost" onClick={() => { onEdit(sc); onClose(); }}>Edit</button>}
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/* ── Engineer Summary Card ────────────────────────────────── */
function EngineerSummaryCard({ eng }) {
  const r = getRating(eng.avg_adjusted);
  const TARGET = 80;
  const pct = eng.avg_adjusted ?? 0;
  return (
    <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <ScoreGauge score={eng.avg_adjusted} size={76} />
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{eng.name}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{eng.email || '—'}</div>
        <ScoreBadge score={eng.avg_adjusted} />
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{eng.scorecard_count} project{eng.scorecard_count !== 1 ? 's' : ''} evaluated</div>
      </div>
      {eng.scorecard_count > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 2, minWidth: 100 }}>
          <div>High: <strong>{eng.max_score}%</strong></div>
          <div>Low:  <strong>{eng.min_score}%</strong></div>
          <div>vs target: <strong style={{ color: pct >= TARGET ? 'var(--success)' : 'var(--danger)' }}>
            {pct >= TARGET ? '+' : ''}{Math.round((pct - TARGET) * 10) / 10}%
          </strong></div>
        </div>
      )}
    </div>
  );
}

/* ── Performance Trend Chart (one engineer) ───────────────── */
function EngineerTrendChart({ eng }) {
  if (!eng.scorecards.length) return (
    <div className="text-sm text-muted" style={{ padding: '8px 0' }}>No data yet</div>
  );
  const data = eng.scorecards.map(sc => ({
    name: sc.project_title.length > 18 ? sc.project_title.slice(0, 16) + '…' : sc.project_title,
    score: sc.adjusted_score,
    fill: getRating(sc.adjusted_score).color,
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Tooltip formatter={v => [`${v}%`, 'Score']} />
        <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '80%', position: 'insideTopRight', fontSize: 9, fill: '#f59e0b' }} />
        <Bar dataKey="score" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.85} />)}
          <LabelList dataKey="score" position="top" formatter={v => `${v}%`} style={{ fontSize: 9, fill: '#374151' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Main page ────────────────────────────────────────────── */
export default function Scorecards() {
  const { user }  = useAuth();
  const toast     = useToast();
  const confirm   = useConfirm();
  const isManager = user.role === 'manager';
  const [tab, setTab]                   = useState(isManager ? 'overview' : 'mine');
  const [scorecards, setCards]          = useState([]);
  const [summary, setSummary]           = useState([]);
  const [pendingProjects, setPending]   = useState([]);
  const [engineers, setEng]             = useState([]);
  const [trends, setTrends]             = useState([]);
  const [selected, setSelected]         = useState(null);
  const [editing,  setEditing]          = useState(null);
  const [showForm, setShowForm]         = useState(false);
  const [filterEng, setFilterEng]       = useState('');
  const [loading, setLoading]           = useState(true);

  const load = () => {
    setLoading(true);
    const calls = [
      api.scorecards(),
      isManager ? api.scorecardEngineerSummary()   : Promise.resolve([]),
      isManager ? api.scorecardPendingProjects()   : Promise.resolve([]),
      isManager ? api.users()                      : Promise.resolve([]),
      isManager ? api.scorecardTrends()            : Promise.resolve([]),
    ];
    Promise.all(calls)
      .then(([sc, sm, pp, us, tr]) => {
        setCards(sc ?? []); setSummary(sm ?? []); setPending(pp ?? []);
        setEng((us ?? []).filter(u => u.role === 'engineer'));
        setTrends(tr ?? []);
      })
      .catch(err => console.error('[Scorecards] load error:', err))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function deleteScorecard(id) {
    const ok = await confirm('Delete this scorecard?', { title: 'Delete Scorecard' });
    if (!ok) return;
    try { await api.deleteScorecard(id); load(); } catch (e) { toast.error(e.message); }
  }

  const displayed = filterEng
    ? scorecards.filter(sc => String(sc.engineer_id) === filterEng)
    : scorecards;

  /* aggregate for engineer's own view */
  const myAvg = !isManager && scorecards.length
    ? Math.round(scorecards.reduce((s, sc) => s + sc.adjusted_score, 0) / scorecards.length * 10) / 10
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart2 size={22} /> Project Quality Scorecards</h1>
          <p className="text-sm text-muted mt-4">Target: <strong>80%</strong> · Weighted across 5 dimensions · Difficulty-adjusted</p>
        </div>
        {isManager && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + New Scorecard
          </button>
        )}
      </div>

      {/* Pending-scores banner (manager only) */}
      {isManager && !loading && pendingProjects.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          background: '#fffbeb', border: '1px solid #fcd34d',
          borderRadius: 10, padding: '12px 16px', marginBottom: 16,
        }}>
          <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 4 }}>
              Pending KPI scores — {pendingProjects.reduce((s, p) => s + p.unscored_engineers.length, 0)} engineer{pendingProjects.reduce((s, p) => s + p.unscored_engineers.length, 0) !== 1 ? 's' : ''} awaiting evaluation
            </div>
            <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
              {pendingProjects.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={11} />
                  <strong>{p.title}</strong>
                  &nbsp;—&nbsp;{p.unscored_engineers.map(e => e.name).join(', ')}
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            Score Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {isManager && <button className={'tab' + (tab==='overview'  ? ' active' : '')} onClick={() => setTab('overview')}>Team Overview</button>}
        {isManager && <button className={'tab' + (tab==='all'       ? ' active' : '')} onClick={() => setTab('all')}>All Scorecards</button>}
        {isManager && <button className={'tab' + (tab==='trends'    ? ' active' : '')} onClick={() => setTab('trends')}><TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Performance Trends</button>}
        {!isManager && <button className={'tab' + (tab==='mine'     ? ' active' : '')} onClick={() => setTab('mine')}>My Scorecards</button>}
      </div>

      {loading && <p className="text-muted">Loading…</p>}

      {/* ── Engineer's own view ── */}
      {!isManager && !loading && tab === 'mine' && (
        <>
          {myAvg != null && (
            <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <ScoreGauge score={myAvg} size={96} />
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>My Overall Average</div>
                <div style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{myAvg}%</div>
                <ScoreBadge score={myAvg} size="lg" />
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                  Target: 80% &nbsp;·&nbsp;
                  <span style={{ color: myAvg >= 80 ? 'var(--success)' : 'var(--danger)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {myAvg >= 80 ? <><CheckCircle2 size={12} /> On target</> : `${Math.abs(Math.round((myAvg - 80) * 10) / 10)}% below target`}
                  </span>
                </div>
              </div>
            </div>
          )}
          {scorecards.length === 0
            ? <div className="empty"><div className="empty-icon"><BarChart2 size={40} strokeWidth={1.2} /></div><p>No scorecards yet for your projects</p></div>
            : scorecards.map(sc => (
              <div key={sc.id} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => setSelected(sc)}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <ScoreGauge score={sc.adjusted_score} size={64} />
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontWeight: 700 }}>
                      <Link to={`/projects/${sc.project_id}`} onClick={e => e.stopPropagation()}>{sc.project_title}</Link>
                    </div>
                    <div className="text-sm text-muted">{fmtDate(sc.updated_at || sc.created_at)}</div>
                    <div style={{ marginTop: 6 }}><ScoreBadge score={sc.adjusted_score} /></div>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 2 }}>
                    <div>Base: {sc.base_score}%</div>
                    <div>Difficulty: {DIFFICULTY_LABELS[sc.difficulty]?.label}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}><ScorecardBreakdown sc={sc} /></div>
              </div>
            ))
          }
        </>
      )}

      {/* ── Manager: Team Overview ── */}
      {isManager && !loading && tab === 'overview' && (
        <>
          {/* Performance distribution */}
          {summary.length > 0 && (
            <>
              <div style={{ marginBottom: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
                {summary.map(eng => <EngineerSummaryCard key={eng.id} eng={eng} />)}
              </div>
              {/* Target attainment bar */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-title">Target Attainment (≥ 80%)</div>
                {summary.filter(e => e.scorecard_count > 0).map(eng => {
                  const r = getRating(eng.avg_adjusted);
                  return (
                    <div key={eng.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <span style={{ width: 130, fontSize: 12, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eng.name}</span>
                      <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 99, height: 10, overflow: 'hidden' }}>
                        <div style={{ width: `${eng.avg_adjusted ?? 0}%`, height: '100%',
                          background: r.color, borderRadius: 99, transition: 'width .4s',
                          position: 'relative' }}>
                          {/* 80% target line marker */}
                        </div>
                      </div>
                      {/* 80% marker */}
                      <div style={{ position: 'relative', marginLeft: -60, width: 0, height: 10, borderLeft: '2px dashed #f59e0b', flexShrink: 0, alignSelf: 'stretch' }} />
                      <span style={{ width: 48, fontSize: 12, fontWeight: 700, color: r.color, textAlign: 'right', flexShrink: 0 }}>
                        {eng.avg_adjusted ?? '—'}%
                      </span>
                    </div>
                  );
                })}
                <div className="text-sm text-muted mt-4">Dashed line = 80% target</div>
              </div>
            </>
          )}
          {summary.length === 0 && <div className="empty"><div className="empty-icon"><BarChart2 size={40} strokeWidth={1.2} /></div><p>No scorecards submitted yet</p></div>}
        </>
      )}

      {/* ── Manager: All Scorecards ── */}
      {isManager && !loading && tab === 'all' && (
        <>
          <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={filterEng} onChange={e => setFilterEng(e.target.value)} style={{ width: 'auto', minWidth: 180 }}>
              <option value="">All Engineers</option>
              {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span className="text-sm text-muted">{displayed.length} scorecard{displayed.length !== 1 ? 's' : ''}</span>
          </div>
          {displayed.length === 0
            ? <div className="empty"><div className="empty-icon"><BarChart2 size={40} strokeWidth={1.2} /></div><p>No scorecards yet</p></div>
            : <div className="card table-wrap" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Engineer</th><th>Project</th><th>Difficulty</th>
                      <th>Base</th><th>Final Score</th><th>Rating</th>
                      <th>Evaluated</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map(sc => {
                      const r = getRating(sc.adjusted_score);
                      return (
                        <tr key={sc.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(sc)}>
                          <td style={{ fontWeight: 600 }}>{sc.engineer_name}</td>
                          <td><Link to={`/projects/${sc.project_id}`} onClick={e => e.stopPropagation()}>{sc.project_title}</Link></td>
                          <td>
                            <span style={{ fontSize: 12, color: DIFFICULTY_LABELS[sc.difficulty]?.color, fontWeight: 600 }}>
                              D{sc.difficulty} — {DIFFICULTY_LABELS[sc.difficulty]?.label}
                            </span>
                          </td>
                          <td className="text-muted text-sm">{sc.base_score}%</td>
                          <td><strong style={{ color: r.color }}>{sc.adjusted_score}%</strong></td>
                          <td><span style={{ background: r.bg, color: r.color, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{r.label}</span></td>
                          <td className="text-sm text-muted">{fmtDate(sc.updated_at || sc.created_at)}</td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="flex gap-8">
                              <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(sc); setShowForm(true); }}>Edit</button>
                              <button className="btn btn-sm btn-danger" onClick={() => deleteScorecard(sc.id)}>Del</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          }
        </>
      )}

      {/* ── Manager: Performance Trends ── */}
      {isManager && !loading && tab === 'trends' && (
        <>
          {trends.length === 0
            ? <div className="empty"><div className="empty-icon"><TrendingUp size={40} strokeWidth={1.2} /></div><p>No scorecard data to trend yet</p></div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                {trends.map(eng => {
                  const latest = eng.scorecards[eng.scorecards.length - 1];
                  const prev   = eng.scorecards[eng.scorecards.length - 2];
                  const delta  = latest && prev ? Math.round((latest.adjusted_score - prev.adjusted_score) * 10) / 10 : null;
                  return (
                    <div key={eng.id} className="card">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{eng.name}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{eng.email || '—'} · {eng.scorecards.length} scorecard{eng.scorecards.length !== 1 ? 's' : ''}</div>
                        </div>
                        {latest && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: getRating(latest.adjusted_score).color }}>{latest.adjusted_score}%</div>
                            {delta !== null && (
                              <div style={{ fontSize: 11, fontWeight: 600, color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs prev
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <EngineerTrendChart eng={eng} />
                    </div>
                  );
                })}
              </div>
            )
          }
        </>
      )}

      {/* Detail modal */}
      {selected && (
        <ScorecardDetail
          sc={selected} isManager={isManager}
          onClose={() => setSelected(null)}
          onEdit={sc => { setEditing(sc); setShowForm(true); }}
          onDelete={id => { deleteScorecard(id); load(); }}
        />
      )}

      {/* Create / edit form */}
      {showForm && isManager && (
        <Modal
          title={editing ? 'Edit Scorecard' : 'New Project Quality Scorecard'}
          onClose={() => setShowForm(false)}
        >
          <ScorecardForm
            initial={editing}
            pendingProjects={pendingProjects}
            engineers={engineers}
            onSave={data => editing
              ? api.updateScorecard(editing.id, data).then(load)
              : api.createScorecard(data).then(load)
            }
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        </Modal>
      )}
    </div>
  );
}
