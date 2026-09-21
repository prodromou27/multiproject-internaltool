import { useState } from 'react';
import { Lock, CheckCircle2, AlertTriangle, BarChart2 } from 'lucide-react';
import { api } from '../../api';
import { fmtDate, isOverdue, Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* ── Gantt Tab ────────────────────────────────────────────── */
export function GanttTab({ project, tasks, milestones = [] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const rows = tasks
    .filter(t => t.status !== 'cancelled' && t.deadline)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  const mRows = milestones.filter(m => m.due_date);

  if (rows.length === 0 && mRows.length === 0) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
      <BarChart2 size={36} style={{ marginBottom: 8, opacity: .3 }} />
      <p className="text-sm">Add deadlines to tasks or milestones to see the Gantt chart</p>
    </div>
  );

  // Build timeline range
  const allDates = rows.map(t => new Date(t.created_at));
  const allEnds  = [...rows.map(t => new Date(t.deadline)), ...mRows.map(m => new Date(m.due_date))];
  if (project.deadline) allEnds.push(new Date(project.deadline));

  const rangeStart = allDates.length
    ? new Date(Math.min(...allDates.map(d => d.getTime())))
    : new Date(Math.min(...allEnds.map(d => d.getTime())));
  const rangeEnd   = new Date(Math.max(...allEnds.map(d => d.getTime())));
  rangeStart.setDate(rangeStart.getDate() - 4);
  rangeEnd.setDate(rangeEnd.getDate() + 4);
  const totalMs = rangeEnd - rangeStart;

  const toPct = d => Math.max(0, Math.min(100, (new Date(d) - rangeStart) / totalMs * 100));
  const todayPct = toPct(today);

  // Month grid lines
  const months = [];
  const cur = new Date(rangeStart); cur.setDate(1);
  while (cur <= rangeEnd) {
    months.push({ label: cur.toLocaleString('default', { month: 'short', year: '2-digit' }), pct: toPct(cur) });
    cur.setMonth(cur.getMonth() + 1);
  }

  const STATUS_COLORS = { open: '#3b82f6', in_progress: '#f59e0b', completed: '#22c55e', closed: '#10b981', waiting_customer: '#f97316', waiting_vendor: '#a855f7' };

  // Diamond SVG for milestones
  function Diamond({ color, size = 12 }) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: 'block' }}>
        <polygon points="6,0 12,6 6,12 0,6" fill={color} />
      </svg>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap', fontSize: 12 }}>
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: 'inline-block' }} />
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ef4444', display: 'inline-block' }} /> Overdue
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Diamond color="#7c3aed" size={12} /> Milestone
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 2, height: 14, background: '#ef4444', display: 'inline-block' }} /> Today
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          {/* Month labels */}
          <div style={{ position: 'relative', height: 18, marginLeft: 190, marginBottom: 4 }}>
            {months.map((m, i) => (
              <div key={i} style={{ position: 'absolute', left: `${m.pct}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{m.label}</div>
            ))}
          </div>

          {/* Task rows */}
          {rows.map(task => {
            const startPct   = toPct(task.created_at);
            const endPct     = toPct(task.deadline);
            const barLeft    = Math.min(startPct, endPct);
            const barWidth   = Math.max(0.5, Math.abs(endPct - startPct));
            const overdue    = isOverdue(task.deadline) && !['completed','closed','cancelled'].includes(task.status);
            const barColor   = overdue ? '#ef4444' : (STATUS_COLORS[task.status] || '#3b82f6');

            return (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 500, color: 'var(--gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {(task.status === 'completed' || task.status === 'closed') && <CheckCircle2 size={11} color="var(--success)" style={{ flexShrink: 0 }} />}
                  {overdue && <AlertTriangle size={11} color="var(--danger)" style={{ flexShrink: 0 }} />}
                  {!!task.is_blocked && <Lock size={11} color="#6366f1" style={{ flexShrink: 0 }} />}
                  <span title={task.title}>{task.title}</span>
                </div>

                <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                  {months.map((m, i) => (
                    <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${m.pct}%`, width: 1, background: 'var(--gray-100)' }} />
                  ))}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                  <div style={{
                    position: 'absolute', left: `${barLeft}%`, width: `${barWidth}%`,
                    top: 4, bottom: 4,
                    background: barColor, borderRadius: 4,
                    opacity: ['completed','closed'].includes(task.status) ? 0.55 : 0.82,
                    overflow: 'hidden', display: 'flex', alignItems: 'center',
                    paddingLeft: 5, fontSize: 10, color: '#fff', fontWeight: 600,
                    minWidth: 4,
                  }}>
                    {barWidth > 10 && fmtDate(task.deadline)}
                  </div>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${endPct}%`, width: 3, background: overdue ? '#dc2626' : barColor, borderRadius: 2, zIndex: 6, transform: 'translateX(-1px)' }} />
                </div>

                <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                  {fmtDate(task.deadline)}
                </div>
              </div>
            );
          })}

          {/* Milestone rows */}
          {mRows.length > 0 && (
            <>
              <div style={{ marginTop: 8, marginBottom: 4, paddingTop: 8, borderTop: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.05em' }}>Milestones</span>
              </div>
              {mRows.map(m => {
                const mPct    = toPct(m.due_date);
                const overdue = isOverdue(m.due_date) && !m.completed_at;
                const color   = m.completed_at ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed';
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
                    <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 500,
                      color: m.completed_at ? 'var(--gray-400)' : overdue ? 'var(--danger)' : '#7c3aed',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Diamond color={color} size={10} />
                      <span title={m.title} style={{ textDecoration: m.completed_at ? 'line-through' : 'none' }}>{m.title}</span>
                    </div>
                    <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                      {months.map((mo, i) => (
                        <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${mo.pct}%`, width: 1, background: 'var(--gray-100)' }} />
                      ))}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                      {/* Diamond marker */}
                      <div style={{ position: 'absolute', top: '50%', left: `${mPct}%`, transform: 'translate(-50%, -50%)', zIndex: 8 }}>
                        <Diamond color={color} size={14} />
                      </div>
                      {/* Vertical spike */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${mPct}%`, width: 2, background: color + '80', zIndex: 6, transform: 'translateX(-1px)' }} />
                    </div>
                    <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                      {fmtDate(m.due_date)}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Project deadline row */}
          {project.deadline && (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--gray-100)' }}>
              <div style={{ width: 190, flexShrink: 0, paddingRight: 10, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Project Deadline</div>
              <div style={{ flex: 1, position: 'relative', height: 26, borderLeft: '1px solid var(--gray-100)' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'var(--gray-50)', borderRadius: 4 }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2, background: '#ef444460', zIndex: 5 }} />
                <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${toPct(project.deadline)}%`, width: 4, background: isOverdue(project.deadline) ? '#dc2626' : '#3b82f6', borderRadius: 2, zIndex: 6, transform: 'translateX(-2px)' }} />
              </div>
              <div style={{ width: 74, flexShrink: 0, paddingLeft: 7, fontSize: 11, fontWeight: 700, color: isOverdue(project.deadline) ? 'var(--danger)' : 'var(--primary)' }}>
                {fmtDate(project.deadline)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Milestones Tab ───────────────────────────────────────── */
export function MilestonesTab({ projectId, canManage, milestones, onReload }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ title: '', description: '', due_date: '' });
  const [saving,  setSaving]  = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function openAdd() { setEditing(null); setForm({ title: '', description: '', due_date: '' }); setShowAdd(true); }
  function openEdit(m) { setEditing(m); setForm({ title: m.title, description: m.description || '', due_date: m.due_date?.slice(0, 10) || '' }); setShowAdd(true); }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        await api.updateMilestone(editing.id, form);
      } else {
        await api.createMilestone({ project_id: projectId, ...form });
      }
      setShowAdd(false); setEditing(null); onReload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function del(m) {
    const ok = await confirm(`Delete milestone "${m.title}"?`, { title: 'Delete Milestone' });
    if (!ok) return;
    try { await api.deleteMilestone(m.id); onReload(); } catch (e) { toast.error(e.message); }
  }

  async function complete(m) {
    await api.completeMilestone(m.id); onReload();
  }

  async function reopen(m) {
    await api.reopenMilestone(m.id); onReload();
  }

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Milestone</button>
        </div>
      )}

      {milestones.length === 0 ? (
        <p className="text-muted text-sm">No milestones yet. Add key delivery checkpoints to track project progress.</p>
      ) : (
        <div>
          {milestones.map(m => {
            const done    = !!m.completed_at;
            const overdue = isOverdue(m.due_date) && !done;
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 0', borderBottom: '1px solid var(--gray-100)',
              }}>
                {/* Diamond icon */}
                <div style={{ flexShrink: 0, marginTop: 2 }}>
                  <svg width={16} height={16} viewBox="0 0 12 12">
                    <polygon points="6,0 12,6 6,12 0,6"
                      fill={done ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed'} />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontWeight: 600, fontSize: 14,
                      textDecoration: done ? 'line-through' : 'none',
                      color: done ? 'var(--gray-400)' : 'var(--gray-800)',
                    }}>{m.title}</span>
                    {done && <span className="badge badge-done">Completed</span>}
                    {overdue && <span className="badge badge-cancelled">Overdue</span>}
                  </div>
                  {m.description && (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--gray-500)' }}>{m.description}</p>
                  )}
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--gray-400)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {m.due_date && <span>Due: <span className={overdue ? 'overdue' : ''}>{fmtDate(m.due_date)}</span></span>}
                    {done && m.completed_by_name && <span>Completed by {m.completed_by_name}</span>}
                    {done && m.completed_at && <span>on {fmtDate(m.completed_at)}</span>}
                  </div>
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {done
                      ? <button className="btn btn-sm btn-ghost" onClick={() => reopen(m)}>↩ Reopen</button>
                      : <button className="btn btn-sm btn-success" onClick={() => complete(m)}>✓ Done</button>
                    }
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(m)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => del(m)}>Del</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal title={editing ? 'Edit Milestone' : 'Add Milestone'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group"><label>Title *</label><input value={form.title} onChange={set('title')} required autoFocus /></div>
            <div className="form-group"><label>Description</label><textarea value={form.description} onChange={set('description')} rows={2} /></div>
            <div className="form-group"><label>Due Date</label><input type="date" value={form.due_date} onChange={set('due_date')} /></div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Milestone')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
