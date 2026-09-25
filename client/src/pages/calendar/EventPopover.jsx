import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../App';
import { fmtDate, Modal } from '../../components/Shared';
import { TYPE_STYLE } from './constants';

/* ── Event detail popover ────────────────────────────────── */
export default function EventPopover({ event, onClose, onReportSent }) {
  const s = TYPE_STYLE[event.type];
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function markSent() {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.markReportSent(event.id);
      onReportSent();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not mark the report sent');
      setSaving(false);
    }
  }

  return (
    <Modal title="Calendar event" onClose={onClose}>
      {error && <div className="error-msg" role="alert">{error}</div>}
        <div className="u-8c013b2">
          <div className="flex-center gap-8">
            <span className="u-433b31a" style={{ background: s.bg }}>
              <s.Icon size={18} color={s.color} />
            </span>
            <div>
              <div className="u-4aaa243">{event.title || event.customer_name}</div>
              <div className="u-0907ca8" style={{ color: s.color }}>{s.label}</div>
            </div>
          </div>
          <button onClick={onClose} className="u-6792cf4"><X size={16} /></button>
        </div>

        <div className="u-368a317">
          <div><span className="u-db12fa5">{event.type === 'report' ? 'Visit date:' : 'Date:'}</span> <strong>{fmtDate(event.date)}</strong></div>

          {event.type === 'follow_up' && <>
            <div>Activity: <strong>{event.reference}</strong></div>
            <p>This follow-up is still pending. Completing the activity does not complete its follow-up.</p>
            <Link to={`/activity-log?activity=${event.id}`}>Open service activity</Link>
          </>}
          {event.type === 'report' && <p>The report is pending for this visit. This entry uses the visit date; no report deadline has been set.</p>}
          {event.type === 'task' && <>
            <div><span className="u-db12fa5">Status:</span> {event.status}</div>
            <div><span className="u-db12fa5">Assigned to:</span> {event.assigned_to_name || '—'}</div>
            {event.project_title && <div><span className="u-db12fa5">Project:</span> {event.project_title}</div>}
            {event.is_adhoc ? <span className="badge badge-adhoc">Ad-hoc</span> : null}
          </>}

          {event.type === 'project' && <>
            <div><span className="u-db12fa5">Status:</span> {event.status}</div>
            <div><span className="u-db12fa5">Priority:</span> {event.priority}</div>
            <div className="u-8a77e5a">
              <Link to={`/projects/${event.id}`} style={{ color: '#2563eb', fontSize: 12, fontWeight: 600 }}>View Project →</Link>
            </div>
          </>}

          {['maintenance', 'report'].includes(event.type) && <>
            <div><span className="u-db12fa5">Customer:</span> <strong>{event.customer_name}</strong></div>
            <div><span className="u-db12fa5">Engineer{event.engineer_names?.includes(',') ? 's' : ''}:</span> {event.engineer_names || '—'}</div>
            <div><span className="u-db12fa5">Status:</span> {event.status.replace('_', ' ')}</div>
            <div><span className="u-db12fa5">Report:</span> {event.report_sent
              ? <span className="u-9775886"><Check size={12} /> Sent</span>
              : <span className="u-212c94a">Pending</span>}</div>
            {!event.report_sent && event.status !== 'cancelled' && ['manager', 'planner', 'engineer'].includes(user.role) && (
              <button className="btn btn-success btn-sm u-169d66d"
                disabled={saving} onClick={markSent}>
                <Check size={13} /> Mark Report Sent
              </button>
            )}
          </>}
        </div>
    </Modal>
  );
}
