import { fmtDate, isOverdue } from '../../components/Shared';
import { PRODUCT_NAME } from '../../product';

/* ── PDF Print View ───────────────────────────────────────── */
export function ProjectPrintView({ project, tasks, milestones, members }) {
  if (!project) return null;
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const taskCount  = tasks.filter(t => t.status !== 'cancelled').length;
  const doneCount  = tasks.filter(t => ['completed','closed'].includes(t.status)).length;
  const overCount  = tasks.filter(t => isOverdue(t.deadline) && !['completed','closed','cancelled'].includes(t.status)).length;
  const pct        = taskCount > 0 ? Math.round(doneCount / taskCount * 100) : 0;
  const pctDisplay = project.completion_pct != null ? project.completion_pct : pct;

  const STATUS_LABELS = {
    open:'Open', in_progress:'In Progress', completed:'Completed', closed:'Closed',
    cancelled:'Cancelled', waiting_customer:'Waiting Customer', waiting_vendor:'Waiting Vendor',
    pending_approval:'Pending Approval', on_hold:'On Hold', not_started:'Not Started',
    delayed:'Delayed', reopened:'Reopened',
  };

  const recentUpdates = (project.updates || []).slice(0, 5);
  const activeTasks   = tasks.filter(t => !['cancelled','closed'].includes(t.status)).slice(0, 20);

  return (
    <div className="print-view u-9c4b7d8">
      {/* Header */}
      <div className="print-report-header">
        <div>
          <div className="u-657c300">{project.title}</div>
          <div className="u-5ceffc4">
            <span className="u-4c38d01">{STATUS_LABELS[project.status] || project.status}</span>
            <span className="u-db12fa5">Priority: <b>{project.priority}</b></span>
            {project.customer_name && <span className="u-db12fa5">Customer: <b>{project.customer_name}</b></span>}
            {project.deadline && <span className="u-db12fa5">Deadline: <b>{fmtDate(project.deadline)}</b></span>}
          </div>
        </div>
        <div className="u-1c854cf">
          <div className="u-dd3505d">Project Report</div>
          <div>Generated {today}</div>
          <div className="u-96ad609">
            <span className="u-0380367" style={{ background: project.rag_status === 'green' ? 'var(--success-light)' : project.rag_status === 'amber' ? 'var(--warning-light)' : project.rag_status === 'red' ? 'var(--danger-light)' : 'var(--gray-100)', color: project.rag_status === 'green' ? 'var(--tone-success-text)' : project.rag_status === 'amber' ? 'var(--tone-warning-text)' : project.rag_status === 'red' ? 'var(--tone-danger-text)' : 'var(--gray-700)' }}>
              {project.rag_status === 'green' ? '🟢 On Track' : project.rag_status === 'amber' ? '🟡 At Risk' : project.rag_status === 'red' ? '🔴 Critical' : 'Health N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="print-report-grid">
        {[
          { label: 'Completion', value: `${pctDisplay}%`, color: pctDisplay >= 75 ? '#059669' : pctDisplay >= 40 ? '#2563eb' : '#374151' },
          { label: 'Total Tasks', value: taskCount },
          { label: 'Completed', value: doneCount, color: '#059669' },
          { label: 'Overdue', value: overCount, color: overCount > 0 ? '#dc2626' : '#059669' },
        ].map(s => (
          <div key={s.label} className="print-stat-box">
            <div className="u-238e820" style={{ color: s.color || '#111827' }}>{s.value}</div>
            <div className="u-df2d890">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="u-ed8e9be">
        <div className="u-94d8d7d" style={{ width: `${pctDisplay}%`, background: pctDisplay >= 75 ? '#10b981' : pctDisplay >= 40 ? '#3b82f6' : '#f59e0b' }} />
      </div>

      {/* Description */}
      {project.description && (
        <div className="u-fa13fa3">
          {project.description}
        </div>
      )}

      <div className="u-911b26a">
        {/* Tasks */}
        <div>
          <div className="print-section-title">Tasks ({taskCount})</div>
          {activeTasks.length === 0 ? (
            <p className="u-be8475d">No tasks yet</p>
          ) : activeTasks.map(t => (
            <div key={t.id} className="print-task-row">
              <span className="u-68bde25" style={{ background: ['completed','closed'].includes(t.status) ? '#10b981' : t.status === 'in_progress' ? '#f59e0b' : isOverdue(t.deadline) ? '#ef4444' : '#3b82f6' }} />
              <span className="u-97445a8" style={{ fontWeight: ['completed','closed'].includes(t.status) ? 400 : 500, color: ['completed','closed'].includes(t.status) ? '#9ca3af' : '#111', textDecoration: ['completed','closed'].includes(t.status) ? 'line-through' : 'none' }}>{t.title}</span>
              <span className="u-ece5370">{t.assigned_to_name || '—'}</span>
              {t.deadline && <span className="u-0c499ab" style={{ color: isOverdue(t.deadline) ? '#ef4444' : '#9ca3af', fontWeight: isOverdue(t.deadline) ? 700 : 400 }}>{fmtDate(t.deadline)}</span>}
            </div>
          ))}
          {tasks.length > 20 && <p className="u-b3f4951">+ {tasks.length - 20} more tasks not shown</p>}
        </div>

        {/* Right column: Members + Milestones + Updates */}
        <div>
          {/* Members */}
          {members?.length > 0 && (
            <>
              <div className="print-section-title">Team ({members.length})</div>
              <div className="u-93f3c25">
                {members.map(m => (
                  <span key={m.id} className="u-363e3d4">{m.name}</span>
                ))}
              </div>
            </>
          )}

          {/* Milestones */}
          {milestones?.length > 0 && (
            <>
              <div className="print-section-title">Milestones ({milestones.length})</div>
              {milestones.slice(0, 6).map(m => (
                <div key={m.id} className="print-task-row">
                  <svg width={10} height={10} viewBox="0 0 12 12" className="flex-shrink-0">
                    <polygon points="6,0 12,6 6,12 0,6" fill={m.completed_at ? '#10b981' : isOverdue(m.due_date) ? '#ef4444' : '#7c3aed'} />
                  </svg>
                  <span className="u-5a95af4" style={{ textDecoration: m.completed_at ? 'line-through' : 'none', color: m.completed_at ? '#9ca3af' : '#111' }}>{m.title}</span>
                  {m.due_date && <span className="u-ece5370">{fmtDate(m.due_date)}</span>}
                </div>
              ))}
            </>
          )}

          {/* Recent updates */}
          {recentUpdates.length > 0 && (
            <>
              <div className="print-section-title u-d2c171b">Recent Updates</div>
              {recentUpdates.map(u => (
                <div key={u.id} className="u-c0aaf66">
                  <div className="u-e0139de">{u.message}</div>
                  <div className="u-1d74646">{u.user_name} · {fmtDate(u.created_at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="u-d3077c5">
        <span>{PRODUCT_NAME} — Confidential</span>
        <span>Exported {today}</span>
      </div>
    </div>
  );
}
