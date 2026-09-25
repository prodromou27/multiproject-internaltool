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
    <div className="u-ca70fdc">
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
      <svg width={size} height={size} viewBox="0 0 12 12" className="u-2a1b75c">
        <polygon points="6,0 12,6 6,12 0,6" fill={color} />
      </svg>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div className="u-411df24">
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <span key={s} className="flex-center gap-5">
            <span className="u-e88c2cd" style={{ background: c }} />
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
        <span className="flex-center gap-5">
          <span className="u-11549eb" /> Overdue
        </span>
        <span className="flex-center gap-5">
          <Diamond color="#7c3aed" size={12} /> Milestone
        </span>
        <span className="flex-center gap-5">
          <span className="u-e34c35f" /> Today
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="u-512bf91">
          {/* Month labels */}
          <div className="u-a502e74">
            {months.map((m, i) => (
              <div key={i} className="u-2d41a7a" style={{ left: `${m.pct}%` }}>{m.label}</div>
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
              <div key={task.id} className="u-c2ccbef">
                <div className="u-4d1bb15">
                  {(task.status === 'completed' || task.status === 'closed') && <CheckCircle2 size={11} color="var(--success)" className="flex-shrink-0" />}
                  {overdue && <AlertTriangle size={11} color="var(--danger)" className="flex-shrink-0" />}
                  {!!task.is_blocked && <Lock size={11} color="#6366f1" className="flex-shrink-0" />}
                  <span title={task.title}>{task.title}</span>
                </div>

                <div className="u-26e95a8">
                  <div className="u-f142acf" />
                  {months.map((m, i) => (
                    <div key={i} className="u-59b471a" style={{ left: `${m.pct}%` }} />
                  ))}
                  <div className="u-af401fd" style={{ left: `${todayPct}%` }} />
                  <div className="u-7844c15" style={{ left: `${barLeft}%`, width: `${barWidth}%`, background: barColor, opacity: ['completed','closed'].includes(task.status) ? 0.55 : 0.82 }}>
                    {barWidth > 10 && fmtDate(task.deadline)}
                  </div>
                  <div className="u-6f040c0" style={{ left: `${endPct}%`, background: overdue ? '#dc2626' : barColor }} />
                </div>

                <div className="u-84d4ffc" style={{ color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                  {fmtDate(task.deadline)}
                </div>
              </div>
            );
          })}

          {/* Milestone rows */}
          {mRows.length > 0 && (
            <>
              <div className="u-d2572b7">
                <span className="u-913ce94">Milestones</span>
              </div>
              {mRows.map(m => {
                const mPct    = toPct(m.due_date);
                const overdue = isOverdue(m.due_date) && !m.completed_at;
                const color   = m.completed_at ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed';
                return (
                  <div key={m.id} className="u-c2ccbef">
                    <div className="u-81efc4d" style={{ color: m.completed_at ? 'var(--gray-400)' : overdue ? 'var(--danger)' : '#7c3aed' }}>
                      <Diamond color={color} size={10} />
                      <span title={m.title} style={{ textDecoration: m.completed_at ? 'line-through' : 'none' }}>{m.title}</span>
                    </div>
                    <div className="u-26e95a8">
                      <div className="u-f142acf" />
                      {months.map((mo, i) => (
                        <div key={i} className="u-59b471a" style={{ left: `${mo.pct}%` }} />
                      ))}
                      <div className="u-af401fd" style={{ left: `${todayPct}%` }} />
                      {/* Diamond marker */}
                      <div className="u-bf0d2c1" style={{ left: `${mPct}%` }}>
                        <Diamond color={color} size={14} />
                      </div>
                      {/* Vertical spike */}
                      <div className="u-5b15eb5" style={{ left: `${mPct}%`, background: color + '80' }} />
                    </div>
                    <div className="u-84d4ffc" style={{ color: overdue ? 'var(--danger)' : 'var(--gray-400)', fontWeight: overdue ? 600 : 400 }}>
                      {fmtDate(m.due_date)}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Project deadline row */}
          {project.deadline && (
            <div className="u-4321027">
              <div className="u-fb75393">Project Deadline</div>
              <div className="u-26e95a8">
                <div className="u-f142acf" />
                <div className="u-af401fd" style={{ left: `${todayPct}%` }} />
                <div className="u-6097c0c" style={{ left: `${toPct(project.deadline)}%`, background: isOverdue(project.deadline) ? '#dc2626' : '#3b82f6' }} />
              </div>
              <div className="u-417be7b" style={{ color: isOverdue(project.deadline) ? 'var(--danger)' : 'var(--primary)' }}>
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
        <div className="flex justify-end mb-12">
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
              <div key={m.id} className="u-183af4a">
                {/* Diamond icon */}
                <div className="u-0d8dc53">
                  <svg width={16} height={16} viewBox="0 0 12 12">
                    <polygon points="6,0 12,6 6,12 0,6"
                      fill={done ? '#22c55e' : overdue ? '#ef4444' : '#7c3aed'} />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="u-36764d1">
                    <span className="u-6ae05fc" style={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--gray-400)' : 'var(--gray-800)' }}>{m.title}</span>
                    {done && <span className="badge badge-done">Completed</span>}
                    {overdue && <span className="badge badge-cancelled">Overdue</span>}
                  </div>
                  {m.description && (
                    <p className="u-d436a3f">{m.description}</p>
                  )}
                  <div className="u-67fca1d">
                    {m.due_date && <span>Due: <span className={overdue ? 'overdue' : ''}>{fmtDate(m.due_date)}</span></span>}
                    {done && m.completed_by_name && <span>Completed by {m.completed_by_name}</span>}
                    {done && m.completed_at && <span>on {fmtDate(m.completed_at)}</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="u-b71a033">
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
            <div className="modal-footer u-cc45258">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Milestone')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
