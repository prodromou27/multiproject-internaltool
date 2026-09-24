import React, { useState } from 'react';
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="flex-center gap-8">
            <span style={{ width: 36, height: 36, borderRadius: 8, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <s.Icon size={18} color={s.color} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{event.title || event.customer_name}</div>
              <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', padding: 2 }}><X size={16} /></button>
        </div>

        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div><span style={{ color: '#6b7280' }}>{event.type === 'report' ? 'Visit date:' : 'Date:'}</span> <strong>{fmtDate(event.date)}</strong></div>

          {event.type === 'follow_up' && <>
            <div>Activity: <strong>{event.reference}</strong></div>
            <p>This follow-up is still pending. Completing the activity does not complete its follow-up.</p>
            <Link to={`/activity-log?activity=${event.id}`}>Open service activity</Link>
          </>}
          {event.type === 'report' && <p>The report is pending for this visit. This entry uses the visit date; no report deadline has been set.</p>}
          {event.type === 'task' && <>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status}</div>
            <div><span style={{ color: '#6b7280' }}>Assigned to:</span> {event.assigned_to_name || '—'}</div>
            {event.project_title && <div><span style={{ color: '#6b7280' }}>Project:</span> {event.project_title}</div>}
            {event.is_adhoc ? <span className="badge badge-adhoc">Ad-hoc</span> : null}
          </>}

          {event.type === 'project' && <>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status}</div>
            <div><span style={{ color: '#6b7280' }}>Priority:</span> {event.priority}</div>
            <div style={{ marginTop: 8 }}>
              <Link to={`/projects/${event.id}`} style={{ color: '#2563eb', fontSize: 12, fontWeight: 600 }}>View Project →</Link>
            </div>
          </>}

          {['maintenance', 'report'].includes(event.type) && <>
            <div><span style={{ color: '#6b7280' }}>Customer:</span> <strong>{event.customer_name}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Engineer{event.engineer_names?.includes(',') ? 's' : ''}:</span> {event.engineer_names || '—'}</div>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status.replace('_', ' ')}</div>
            <div><span style={{ color: '#6b7280' }}>Report:</span> {event.report_sent
              ? <span style={{ color: 'var(--success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={12} /> Sent</span>
              : <span style={{ color: 'var(--warning)', fontWeight: 700 }}>Pending</span>}</div>
            {!event.report_sent && event.status !== 'cancelled' && ['manager', 'planner', 'engineer'].includes(user.role) && (
              <button className="btn btn-success btn-sm"
                style={{ marginTop: 8, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                disabled={saving} onClick={markSent}>
                <Check size={13} /> Mark Report Sent
              </button>
            )}
          </>}
        </div>
    </Modal>
  );
}
