import { useEffect, useState } from 'react';
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
            <label>Project * <span className="u-24b09c3">(closed / completed only)</span></label>
            <select value={form.project_id} onChange={handleProjectChange} required>
              <option value="">Select project…</option>
              {pendingProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.unscored_engineers.length} pending)
                </option>
              ))}
            </select>
            {pendingProjects.length === 0 && (
              <div className="u-7d92a3e">
                ✅ All engineers have been scored on every closed/completed project.
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Engineer * <span className="u-24b09c3">(unscored only)</span></label>
            <select value={form.engineer_id} onChange={set('engineer_id')} required disabled={!form.project_id}>
              <option value="">{form.project_id ? 'Select engineer…' : 'Select a project first'}</option>
              {availableEngineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Live score preview */}
      <div className="u-d112f2c" style={{ border: `2px solid ${r.color}20` }}>
        <ScoreGauge score={adjP} size={72} />
        <div>
          <div className="u-5eb8a4b">Live Preview</div>
          <div className="u-975b878" style={{ color: r.color }}>{adjP}%</div>
          <ScoreBadge score={adjP} size="lg" />
        </div>
        <div className="u-77af0ee">
          Base: <strong>{baseP}%</strong><br />
          Difficulty adj: <strong>{DIFFICULTY_LABELS[form.difficulty]?.mult}</strong><br />
          Target: <strong>80%</strong>
        </div>
      </div>

      {/* Dimension pickers */}
      <div className="u-e574c16">
        <div className="u-616011a">Scoring Dimensions</div>
        {Object.entries(WEIGHTS).map(([key, meta]) => (
          <div key={key} className="u-0aae325">
            <div className="u-3aed09a">
              <div className="u-15e5b7f">{meta.label}</div>
              <div className="u-8993047">Weight: {meta.pct}%</div>
            </div>
            <DimPicker value={form[key]} onChange={setDim(key)} />
            <div className="u-33f8222" style={{ background: meta.color }}>{form[key]}</div>
          </div>
        ))}
      </div>

      {/* Difficulty */}
      <div className="form-group">
        <label>Project Difficulty</label>
        <div className="u-8af0ed0">
          {[1,2,3,4,5].map(d => {
            const dl = DIFFICULTY_LABELS[d];
            const active = form.difficulty === d;
            return (
              <button key={d} type="button" onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                className="u-a07aded" style={{ border: `2px solid ${active ? dl.color : 'var(--gray-200)'}`, background: active ? dl.color + '15' : '#fff', color: active ? dl.color : '#6b7280', fontWeight: active ? 700 : 400 }}>
                D{d} — {dl.label}<br/>
                <span className="u-ea7eea0">{dl.mult}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="form-group">
        <label>Evaluator Notes (optional)</label>
        <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Additional observations…" />
      </div>

      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Update Scorecard' : 'Save Scorecard'}</button>
      </div>
    </form>
  );
}

/* ── Detail Modal ─────────────────────────────────────────── */
function ScorecardDetail({ sc, isManager, onClose, onEdit, onDelete }) {
  return (
    <Modal title="Project Quality Scorecard" onClose={onClose}>
      {/* Header */}
      <div className="u-8af67e8">
        <ScoreGauge score={sc.adjusted_score} size={88} />
        <div className="u-2f7ab6d">
          <div className="u-08bdae6">{sc.engineer_name}</div>
          <div className="text-sm text-muted u-4e420af">
            <Link to={`/projects/${sc.project_id}`} onClick={onClose}>{sc.project_title}</Link>
          </div>
          <ScoreBadge score={sc.adjusted_score} size="lg" />
          <div className="text-sm text-muted mt-4">
            Evaluated by {sc.evaluated_by_name} · {fmtDate(sc.updated_at || sc.created_at)}
          </div>
        </div>
        <div className="u-71c92c6">
          <div className="u-39de0bb">Target</div>
          <div className="u-028ee8c" style={{ color: sc.adjusted_score >= 80 ? 'var(--success)' : 'var(--danger)' }}>80%</div>
          <div className="u-5a45a25" style={{ color: sc.adjusted_score >= 80 ? 'var(--success)' : 'var(--danger)' }}>
            {sc.adjusted_score >= 80 ? <><CheckCircle2 size={11} /> Met</> : <><XCircle size={11} /> Not met</>}
          </div>
        </div>
      </div>

      <div className="divider" />
      <ScorecardBreakdown sc={sc} />

      {sc.notes && <>
        <div className="divider" />
        <div>
          <div className="u-2083c69">Evaluator Notes</div>
          <p className="u-a478e95">{sc.notes}</p>
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
  const TARGET = 80;
  const pct = eng.avg_adjusted ?? 0;
  return (
    <div className="card u-6015106">
      <ScoreGauge score={eng.avg_adjusted} size={76} />
      <div className="u-aae0403">
        <div className="u-4aaa243">{eng.name}</div>
        <div className="u-44d91a7">{eng.email || '—'}</div>
        <ScoreBadge score={eng.avg_adjusted} />
        <div className="u-9f047cd">{eng.scorecard_count} project{eng.scorecard_count !== 1 ? 's' : ''} evaluated</div>
      </div>
      {eng.scorecard_count > 0 && (
        <div className="u-f5fb2fe">
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
    <div className="text-sm text-muted u-d8c0226">No data yet</div>
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
          <h1 className="page-title flex-center gap-8"><BarChart2 size={22} /> Project Quality Scorecards</h1>
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
        <div className="u-ccda4f8">
          <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div className="flex-1">
            <div className="u-4c84c5f">
              Pending KPI scores — {pendingProjects.reduce((s, p) => s + p.unscored_engineers.length, 0)} engineer{pendingProjects.reduce((s, p) => s + p.unscored_engineers.length, 0) !== 1 ? 's' : ''} awaiting evaluation
            </div>
            <div className="u-59bbb8c">
              {pendingProjects.map(p => (
                <div key={p.id} className="flex-center gap-6">
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
            <div className="card u-dbb528b">
              <ScoreGauge score={myAvg} size={96} />
              <div>
                <div className="u-ae764bb">My Overall Average</div>
                <div className="u-6bc6c7a">{myAvg}%</div>
                <ScoreBadge score={myAvg} size="lg" />
                <div className="u-308c91b">
                  Target: 80% &nbsp;·&nbsp;
                  <span className="u-e30bd2e" style={{ color: myAvg >= 80 ? 'var(--success)' : 'var(--danger)' }}>
                    {myAvg >= 80 ? <><CheckCircle2 size={12} /> On target</> : `${Math.abs(Math.round((myAvg - 80) * 10) / 10)}% below target`}
                  </span>
                </div>
              </div>
            </div>
          )}
          {scorecards.length === 0
            ? <div className="empty"><div className="empty-icon"><BarChart2 size={40} strokeWidth={1.2} /></div><p>No scorecards yet for your projects</p></div>
            : scorecards.map(sc => (
              <div key={sc.id} className="card u-588c5a9" onClick={() => setSelected(sc)}>
                <div className="u-6015106">
                  <ScoreGauge score={sc.adjusted_score} size={64} />
                  <div className="u-4ad81db">
                    <div className="u-e3ec02a">
                      <Link to={`/projects/${sc.project_id}`} onClick={e => e.stopPropagation()}>{sc.project_title}</Link>
                    </div>
                    <div className="text-sm text-muted">{fmtDate(sc.updated_at || sc.created_at)}</div>
                    <div className="u-fe7b497"><ScoreBadge score={sc.adjusted_score} /></div>
                  </div>
                  <div className="u-54d9df5">
                    <div>Base: {sc.base_score}%</div>
                    <div>Difficulty: {DIFFICULTY_LABELS[sc.difficulty]?.label}</div>
                  </div>
                </div>
                <div className="mt-12"><ScorecardBreakdown sc={sc} /></div>
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
              <div className="u-49fb0f5">
                {summary.map(eng => <EngineerSummaryCard key={eng.id} eng={eng} />)}
              </div>
              {/* Target attainment bar */}
              <div className="card mb-20">
                <div className="section-title">Target Attainment (≥ 80%)</div>
                {summary.filter(e => e.scorecard_count > 0).map(eng => {
                  const r = getRating(eng.avg_adjusted);
                  return (
                    <div key={eng.id} className="u-4a1b20e">
                      <span className="u-501de05">{eng.name}</span>
                      <div className="u-7ffff5e">
                        <div className="u-ebb76f9" style={{ width: `${eng.avg_adjusted ?? 0}%`, background: r.color }}>
                          {/* 80% target line marker */}
                        </div>
                      </div>
                      {/* 80% marker */}
                      <div className="u-e68d8c0" />
                      <span className="u-e628251" style={{ color: r.color }}>
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
          <div className="u-60a1f93">
            <select value={filterEng} onChange={e => setFilterEng(e.target.value)} className="u-1833b73">
              <option value="">All Engineers</option>
              {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <span className="text-sm text-muted">{displayed.length} scorecard{displayed.length !== 1 ? 's' : ''}</span>
          </div>
          {displayed.length === 0
            ? <div className="empty"><div className="empty-icon"><BarChart2 size={40} strokeWidth={1.2} /></div><p>No scorecards yet</p></div>
            : <div className="card table-wrap p-0">
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
                        <tr key={sc.id} className="cursor-pointer" onClick={() => setSelected(sc)}>
                          <td className="font-semibold">{sc.engineer_name}</td>
                          <td><Link to={`/projects/${sc.project_id}`} onClick={e => e.stopPropagation()}>{sc.project_title}</Link></td>
                          <td>
                            <span className="u-eb5cb58" style={{ color: DIFFICULTY_LABELS[sc.difficulty]?.color }}>
                              D{sc.difficulty} — {DIFFICULTY_LABELS[sc.difficulty]?.label}
                            </span>
                          </td>
                          <td className="text-muted text-sm">{sc.base_score}%</td>
                          <td><strong style={{ color: r.color }}>{sc.adjusted_score}%</strong></td>
                          <td><span className="u-f7dac5e" style={{ background: r.bg, color: r.color }}>{r.label}</span></td>
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
              <div className="u-59b0c89">
                {trends.map(eng => {
                  const latest = eng.scorecards[eng.scorecards.length - 1];
                  const prev   = eng.scorecards[eng.scorecards.length - 2];
                  const delta  = latest && prev ? Math.round((latest.adjusted_score - prev.adjusted_score) * 10) / 10 : null;
                  return (
                    <div key={eng.id} className="card">
                      <div className="u-8d44620">
                        <div className="flex-1">
                          <div className="u-4aaa243">{eng.name}</div>
                          <div className="u-0bc6ca3">{eng.email || '—'} · {eng.scorecards.length} scorecard{eng.scorecards.length !== 1 ? 's' : ''}</div>
                        </div>
                        {latest && (
                          <div className="u-1d6bcfa">
                            <div className="u-80b90e3" style={{ color: getRating(latest.adjusted_score).color }}>{latest.adjusted_score}%</div>
                            {delta !== null && (
                              <div className="u-0907ca8" style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
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
