import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import { DIFFICULTY_LABELS, getRating, ScoreBadge, ScoreGauge, DimPicker, ScorecardBreakdown, WEIGHTS } from '../../components/ScorecardUtils';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* ── Inline Scorecard Tab ─────────────────────────────────── */
export function ScorecardTab({ projectId, members }) {
  const toast     = useToast();
  const confirm   = useConfirm();
  const [cards, setCards]     = useState([]);
  const [showForm, setShow]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSel]    = useState(null);

  const engineers = (members || []).filter(m => m.role === 'engineer');
  const load = () => api.scorecards({ project_id: projectId }).then(setCards);
  useEffect(() => { load(); }, [projectId]);

  const blank = { timeline_rating:3, delivery_quality:3, communication_ownership:3, documentation_quality:3, customer_feedback:3, difficulty:3, notes:'' };

  async function save(form) {
    if (editing) {
      await api.updateScorecard(editing.id, form);
    } else {
      await api.createScorecard({ ...form, project_id: Number(projectId) });
    }
    setShow(false); setEditing(null); load();
  }

  async function del(id) {
    const ok = await confirm('Delete this scorecard?', { title: 'Delete Scorecard' });
    if (!ok) return;
    try { await api.deleteScorecard(id); load(); } catch (e) { toast.error(e.message); }
  }

  /* inline form */
  const [form, setForm] = useState(blank);
  const setDim = k => v => setForm(f => ({ ...f, [k]: v }));
  const mults = { 1:0.90, 2:0.95, 3:1.00, 4:1.05, 5:1.10 };
  const wsum  = Object.entries(WEIGHTS).reduce((s,[k,m]) => s + (form[k]||3) * m.pct / 100, 0);
  const baseP = Math.round(wsum / 5 * 1000) / 10;
  const adjP  = Math.min(Math.round(baseP * (mults[form.difficulty]||1) * 10) / 10, 100);
  const r     = getRating(adjP);

  useEffect(() => {
    if (editing) setForm({ ...editing });
    else setForm(blank);
  }, [editing, showForm]);

  return (
    <div>
      {/* Summary strip */}
      {cards.length > 0 && (
        <div className="u-b3c85ca">
          {cards.map(sc => (
            <div key={sc.id} onClick={() => setSel(sc)}
              className="u-484c985">
              <ScoreGauge score={sc.adjusted_score} size={56} />
              <div className="u-3922d32">
                <div className="u-b31844f">{sc.engineer_name}</div>
                <ScoreBadge score={sc.adjusted_score} />
                <div className="u-219927d">D{sc.difficulty} · {DIFFICULTY_LABELS[sc.difficulty]?.label}</div>
              </div>
              <div className="u-16074f3">
                <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); setEditing(sc); setShow(true); }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); del(sc.id); }}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      {engineers.length > 0 && (
        <button className="btn btn-primary btn-sm mb-16" onClick={() => { setEditing(null); setShow(true); }}>
          + Add Scorecard
        </button>
      )}
      {engineers.length === 0 && cards.length === 0 && <p className="text-muted text-sm">Assign engineers to this project first.</p>}

      {/* Inline scorecard detail */}
      {selected && (
        <Modal title="Scorecard Detail" onClose={() => setSel(null)}>
          <div className="u-f134c4d">
            <ScoreGauge score={selected.adjusted_score} size={80} />
            <div>
              <div className="u-e3ec02a">{selected.engineer_name}</div>
              <ScoreBadge score={selected.adjusted_score} size="lg" />
              <div className="text-sm text-muted mt-4">Evaluated by {selected.evaluated_by_name}</div>
            </div>
          </div>
          <ScorecardBreakdown sc={selected} />
          {selected.notes && <p className="u-0f48d1c">{selected.notes}</p>}
          <div className="modal-footer"><button className="btn btn-primary" onClick={() => setSel(null)}>Close</button></div>
        </Modal>
      )}

      {/* Create/edit form modal */}
      {showForm && (
        <Modal title={editing ? 'Edit Scorecard' : 'New Scorecard'} onClose={() => { setShow(false); setEditing(null); }}>
          <form onSubmit={async e => { e.preventDefault(); await save(form); }}>
            {!editing && (
              <div className="form-group">
                <label>Engineer *</label>
                <select value={form.engineer_id || ''} onChange={e => setForm(f => ({ ...f, engineer_id: Number(e.target.value) }))} required>
                  <option value="">Select engineer…</option>
                  {engineers.filter(e => !cards.some(c => c.engineer_id === e.id)).map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Live preview */}
            <div className="u-a6e90d1" style={{ border:`2px solid ${r.color}20` }}>
              <ScoreGauge score={adjP} size={64} />
              <div>
                <div className="u-ffbe152" style={{ color:r.color }}>{adjP}%</div>
                <ScoreBadge score={adjP} size="lg" />
              </div>
              <div className="u-e8e898a">
                Base: {baseP}% &nbsp;·&nbsp; Adj: {DIFFICULTY_LABELS[form.difficulty]?.mult}
              </div>
            </div>
            {/* Dimensions */}
            <div className="u-c63aa5f">
              {Object.entries(WEIGHTS).map(([key, meta]) => (
                <div key={key} className="u-c7daf4f">
                  <div className="u-7951ed8">
                    <div className="u-15e5b7f">{meta.label}</div>
                    <div className="u-8993047">{meta.pct}% weight</div>
                  </div>
                  <DimPicker value={form[key]||3} onChange={setDim(key)} />
                </div>
              ))}
            </div>
            {/* Difficulty */}
            <div className="form-group">
              <label>Project Difficulty</label>
              <div className="u-8af0ed0">
                {[1,2,3,4,5].map(d => {
                  const dl = DIFFICULTY_LABELS[d]; const active = form.difficulty === d;
                  return (
                    <button key={d} type="button" onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                      className="u-c55ee52" style={{ border:`2px solid ${active?dl.color:'var(--gray-200)'}`, background:active?dl.color+'15':'#fff', color:active?dl.color:'#6b7280', fontWeight:active?700:400 }}>
                      D{d} {dl.label}<br/><span className="u-ea7eea0">{dl.mult}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="modal-footer u-cc45258">
              <button type="button" className="btn btn-ghost" onClick={() => { setShow(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Save Scorecard'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
