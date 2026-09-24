import { FolderOpen, CheckSquare, Wrench, Building2, User, Calendar, Clock } from 'lucide-react';
import { fmtDate } from '../../components/Shared';
import { SBadge, PBadge } from './badges';

export function ProjectCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.deadline && item.deadline < today && !['closed','cancelled'].includes(item.status);
  const pct = item.task_count > 0 ? Math.round((item.done_count / item.task_count) * 100) : null;

  return (
    <div className="result-card" onClick={() => navigate(`/projects/${item.id}`)}>
      <div className="result-card-icon" style={{ background: 'var(--tone-purple-bg)', color: '#7c3aed' }}>
        <FolderOpen size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          {item.customer_name && <span><Building2 size={11} /> {item.customer_name}</span>}
          {item.deadline && (
            <span style={{ color: od ? '#dc2626' : 'inherit' }}>
              <Calendar size={11} /> {fmtDate(item.deadline)}{od ? ' · Overdue' : ''}
            </span>
          )}
          {pct !== null && <span>{pct}% tasks done ({item.done_count}/{item.task_count})</span>}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <PBadge p={item.priority} />
      </div>
    </div>
  );
}

export function TaskCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.deadline && item.deadline < today && !['done', 'cancelled'].includes(item.status);

  return (
    <div className="result-card" onClick={() => item.project_id && navigate(`/projects/${item.project_id}`)}>
      <div className="result-card-icon" style={{ background: 'var(--primary-light)', color: '#2563eb' }}>
        <CheckSquare size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          {item.project_title && <span><FolderOpen size={11} /> {item.project_title}</span>}
          {item.customer_name && <span><Building2 size={11} /> {item.customer_name}</span>}
          {item.assigned_to_name
            ? <span><User size={11} /> {item.assigned_to_name}</span>
            : <span style={{ color: '#9ca3af' }}>Unassigned</span>}
          {item.deadline && (
            <span style={{ color: od ? '#dc2626' : 'inherit' }}>
              <Clock size={11} /> {fmtDate(item.deadline)}{od ? ' · Overdue' : ''}
            </span>
          )}
          {item.is_adhoc ? <span style={{ color: '#7c3aed', fontSize: 10, fontWeight: 700 }}>AD-HOC</span> : null}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <PBadge p={item.priority} />
      </div>
    </div>
  );
}

export function MVCard({ item, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const od = item.scheduled_date < today && !['completed', 'cancelled'].includes(item.status);
  const reportLabel = item.report_sent_to_customer ? 'Sent to PM'
    : item.report_sent ? 'Report Complete' : 'Report Pending';
  const reportColor = item.report_sent_to_customer ? '#059669'
    : item.report_sent ? '#2563eb' : '#d97706';

  return (
    <div className="result-card" onClick={() => navigate('/maintenance-visits')}>
      <div className="result-card-icon" style={{ background: 'var(--warning-light)', color: '#d97706' }}>
        <Wrench size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.title}</div>
        <div className="result-card-meta">
          <span><Building2 size={11} /> {item.customer_name}</span>
          <span style={{ color: od ? '#dc2626' : 'inherit' }}>
            <Calendar size={11} /> {fmtDate(item.scheduled_date)}{od ? ' · Overdue' : ''}
          </span>
          {item.engineer_names && <span><User size={11} /> {item.engineer_names}</span>}
        </div>
      </div>
      <div className="result-card-badges">
        <SBadge s={item.status} />
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: item.report_sent_to_customer ? '#ecfdf5' : item.report_sent ? '#eff6ff' : '#fef3c7', color: reportColor }}>{reportLabel}</span>
      </div>
    </div>
  );
}

export function CustomerCard({ item, navigate }) {
  return (
    <div className="result-card" onClick={() => navigate('/customers')}>
      <div className="result-card-icon" style={{ background: 'var(--success-light)', color: '#059669' }}>
        <Building2 size={16} />
      </div>
      <div className="result-card-body">
        <div className="result-card-title">{item.name}</div>
        <div className="result-card-meta">
          {item.contact_name && <span><User size={11} /> {item.contact_name}</span>}
          {item.contact_email && <span>{item.contact_email}</span>}
          {item.contact_phone && <span>{item.contact_phone}</span>}
          <span><FolderOpen size={11} /> {item.project_count} project{item.project_count !== 1 ? 's' : ''}</span>
          <span><Wrench size={11} /> {item.visit_count} visit{item.visit_count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
