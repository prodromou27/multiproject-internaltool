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
    <div className="print-view" style={{ fontFamily: 'Arial, sans-serif', color: '#111', fontSize: 13, lineHeight: 1.5 }}>
      {/* Header */}
      <div className="print-report-header">
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--tone-info-text)', marginBottom: 4 }}>{project.title}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{
              padding: '2px 10px', borderRadius: 99, fontWeight: 700, fontSize: 11,
              background: 'var(--primary-light)', color: 'var(--tone-info-text)', border: '1px solid #93c5fd',
            }}>{STATUS_LABELS[project.status] || project.status}</span>
            <span style={{ color: '#6b7280' }}>Priority: <b>{project.priority}</b></span>
            {project.customer_name && <span style={{ color: '#6b7280' }}>Customer: <b>{project.customer_name}</b></span>}
            {project.deadline && <span style={{ color: '#6b7280' }}>Deadline: <b>{fmtDate(project.deadline)}</b></span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#9ca3af' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 2 }}>Project Report</div>
          <div>Generated {today}</div>
          <div style={{ marginTop: 4 }}>
            <span style={{
              padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: project.rag_status === 'green' ? 'var(--success-light)' : project.rag_status === 'amber' ? 'var(--warning-light)' : project.rag_status === 'red' ? 'var(--danger-light)' : 'var(--gray-100)',
              color: project.rag_status === 'green' ? 'var(--tone-success-text)' : project.rag_status === 'amber' ? 'var(--tone-warning-text)' : project.rag_status === 'red' ? 'var(--tone-danger-text)' : 'var(--gray-700)',
            }}>
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
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#111827' }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ background: 'var(--gray-100)', borderRadius: 8, height: 10, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 8,
          width: `${pctDisplay}%`,
          background: pctDisplay >= 75 ? '#10b981' : pctDisplay >= 40 ? '#3b82f6' : '#f59e0b',
        }} />
      </div>

      {/* Description */}
      {project.description && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--gray-50)', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, color: '#374151' }}>
          {project.description}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Tasks */}
        <div>
          <div className="print-section-title">Tasks ({taskCount})</div>
          {activeTasks.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 12 }}>No tasks yet</p>
          ) : activeTasks.map(t => (
            <div key={t.id} className="print-task-row">
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: ['completed','closed'].includes(t.status) ? '#10b981' : t.status === 'in_progress' ? '#f59e0b' : isOverdue(t.deadline) ? '#ef4444' : '#3b82f6',
              }} />
              <span style={{ flex: 1, fontWeight: ['completed','closed'].includes(t.status) ? 400 : 500, color: ['completed','closed'].includes(t.status) ? '#9ca3af' : '#111', textDecoration: ['completed','closed'].includes(t.status) ? 'line-through' : 'none' }}>{t.title}</span>
              <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{t.assigned_to_name || '—'}</span>
              {t.deadline && <span style={{ fontSize: 10, color: isOverdue(t.deadline) ? '#ef4444' : '#9ca3af', flexShrink: 0, fontWeight: isOverdue(t.deadline) ? 700 : 400 }}>{fmtDate(t.deadline)}</span>}
            </div>
          ))}
          {tasks.length > 20 && <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>+ {tasks.length - 20} more tasks not shown</p>}
        </div>

        {/* Right column: Members + Milestones + Updates */}
        <div>
          {/* Members */}
          {members?.length > 0 && (
            <>
              <div className="print-section-title">Team ({members.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {members.map(m => (
                  <span key={m.id} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--primary-light)', color: 'var(--tone-info-text)', borderRadius: 99, fontWeight: 600 }}>{m.name}</span>
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
                  <span style={{ flex: 1, fontSize: 12, textDecoration: m.completed_at ? 'line-through' : 'none', color: m.completed_at ? '#9ca3af' : '#111' }}>{m.title}</span>
                  {m.due_date && <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{fmtDate(m.due_date)}</span>}
                </div>
              ))}
            </>
          )}

          {/* Recent updates */}
          {recentUpdates.length > 0 && (
            <>
              <div className="print-section-title" style={{ marginTop: 10 }}>Recent Updates</div>
              {recentUpdates.map(u => (
                <div key={u.id} style={{ padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                  <div style={{ color: '#374151' }}>{u.message}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{u.user_name} · {fmtDate(u.created_at)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 20, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af' }}>
        <span>{PRODUCT_NAME} — Confidential</span>
        <span>Exported {today}</span>
      </div>
    </div>
  );
}
