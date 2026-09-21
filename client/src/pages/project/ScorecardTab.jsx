import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../App';
import { Modal } from '../../components/Shared';
import { DIFFICULTY_LABELS, getRating, ScoreBadge, ScoreGauge, DimPicker, ScorecardBreakdown, WEIGHTS } from '../../components/ScorecardUtils';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* ── Inline Scorecard Tab ─────────────────────────────────── */
export function ScorecardTab({ projectId, members }) {
  const { user }  = useAuth();
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {cards.map(sc => (
            <div key={sc.id} onClick={() => setSel(sc)}
              style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--gray-50)',
                border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                flex: '1 1 220px', minWidth: 0 }}>
              <ScoreGauge score={sc.adjusted_score} size={56} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.engineer_name}</div>
                <ScoreBadge score={sc.adjusted_score} />
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>D{sc.difficulty} · {DIFFICULTY_LABELS[sc.difficulty]?.label}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-sm btn-ghost" onClick={e => { e.stopPropagation(); setEditing(sc); setShow(true); }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); del(sc.id); }}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      {engineers.length > 0 && (
        <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} onClick={() => { setEditing(null); setShow(true); }}>
          + Add Scorecard
        </button>
      )}
      {engineers.length === 0 && cards.length === 0 && <p className="text-muted text-sm">Assign engineers to this project first.</p>}

      {/* Inline scorecard detail */}
      {selected && (
        <Modal title="Scorecard Detail" onClose={() => setSel(null)}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap' }}>
            <ScoreGauge score={selected.adjusted_score} size={80} />
            <div>
              <div style={{ fontWeight: 700 }}>{selected.engineer_name}</div>
              <ScoreBadge score={selected.adjusted_score} size="lg" />
              <div className="text-sm text-muted mt-4">Evaluated by {selected.evaluated_by_name}</div>
            </div>
          </div>
          <ScorecardBreakdown sc={selected} />
          {selected.notes && <p style={{ marginTop: 12, fontSize: 13, color: '#374151' }}>{selected.notes}</p>}
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
            <div style={{ background:'var(--gray-50)', borderRadius:8, padding:'10px 14px', marginBottom:14,
              display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', border:`2px solid ${r.color}20` }}>
              <ScoreGauge score={adjP} size={64} />
              <div>
                <div style={{ fontWeight:800, fontSize:20, color:r.color }}>{adjP}%</div>
                <ScoreBadge score={adjP} size="lg" />
              </div>
              <div style={{ fontSize:11, color:'#9ca3af', lineHeight:1.8 }}>
                Base: {baseP}% &nbsp;·&nbsp; Adj: {DIFFICULTY_LABELS[form.difficulty]?.mult}
              </div>
            </div>
            {/* Dimensions */}
            <div style={{ background:'var(--gray-50)', borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
              {Object.entries(WEIGHTS).map(([key, meta]) => (
                <div key={key} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' }}>
                  <div style={{ width:180, flexShrink:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{meta.label}</div>
                    <div style={{ fontSize:10, color:'#9ca3af' }}>{meta.pct}% weight</div>
                  </div>
                  <DimPicker value={form[key]||3} onChange={setDim(key)} />
                </div>
              ))}
            </div>
            {/* Difficulty */}
            <div className="form-group">
              <label>Project Difficulty</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4 }}>
                {[1,2,3,4,5].map(d => {
                  const dl = DIFFICULTY_LABELS[d]; const active = form.difficulty === d;
                  return (
                    <button key={d} type="button" onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                      style={{ padding:'4px 10px', borderRadius:6, border:`2px solid ${active?dl.color:'var(--gray-200)'}`,
                        background:active?dl.color+'15':'#fff', color:active?dl.color:'#6b7280',
                        cursor:'pointer', fontSize:11, fontWeight:active?700:400 }}>
                      D{d} {dl.label}<br/><span style={{ fontSize:10, opacity:.7 }}>{dl.mult}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="modal-footer" style={{ padding:'12px 0 0', border:'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShow(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Save Scorecard'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
