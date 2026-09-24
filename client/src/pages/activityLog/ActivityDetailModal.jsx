import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Paperclip, Upload, Trash2, Flag } from 'lucide-react';
import { fmtDuration, mixOf } from '../../components/activityLedger';
import { api } from '../../api';
import { StatusBadge, fmtDate, fmtDateTime, Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { WORK_LOCATION_LABELS } from './helpers';

/* ── Activity Detail Modal (view + attachments) ──────────────────────── */
export function ActivityDetailModal({ id, allowAttachments, onClose, onChanged }) {
  const toast = useToast();
  const [activity, setActivity] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const detailRequest = useRef(null);

  const load = useCallback(() => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setLoadError('');
    return Promise.all([api.serviceActivity(id, { signal: controller.signal }), api.serviceActivityAttachments(id, { signal: controller.signal })])
      .then(([a, atts]) => { if (!controller.signal.aborted) { setActivity(a); setAttachments(atts); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message || 'Could not load the activity'); });
  }, [id]);
  useEffect(() => { setActivity(null); load(); return () => detailRequest.current?.abort(); }, [load]);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try { await api.uploadServiceActivityAttachment(id, file); toast.success('Attachment uploaded'); load(); }
    catch (ex) { toast.error(ex.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handleDownload(att) {
    try {
      const { token } = await api.downloadToken();
      window.location.href = api.downloadServiceActivityAttachmentUrl(id, att.id, token);
    } catch (ex) { toast.error(ex.message); }
  }

  async function handleDeleteAttachment(attId) {
    try { await api.deleteServiceActivityAttachment(id, attId); toast.success('Attachment removed'); load(); }
    catch (ex) { toast.error(ex.message); }
  }

  if (!activity) return <Modal title="Activity" onClose={onClose}>{loadError
    ? <div className="error-msg" role="alert">{loadError}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>
    : <p className="text-muted">Loading…</p>}</Modal>;

  const mix = mixOf(activity.billable_classification);
  const fact = (label, value) => (
    <div className="ad-fact"><dt>{label}</dt><dd>{value || <span className="ad-none">Not set</span>}</dd></div>
  );

  return (
    <Modal title={activity.activity_reference} onClose={onClose} wide>
      {loadError && <div className="error-msg" role="alert">{loadError}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
      <div className="ad">
        <div className="ad-head">
          <h3>{activity.title}</h3>
          <StatusBadge entityType="service_activity" s={activity.status} />
        </div>

        {activity.follow_up_required ? (
          <p className="ad-followup"><Flag size={14} aria-hidden="true" />
            {`Follow up by ${fmtDate(activity.follow_up_date)}${activity.follow_up_task_title ? `, task: ${activity.follow_up_task_title}` : ''}`}</p>
        ) : null}

        <dl className="ad-facts">
          {fact('Customer', activity.customer_name)}
          {fact('Engineer', activity.engineer_name)}
          {fact('Date', fmtDate(activity.activity_date))}
          {fact('Time spent', activity.duration_minutes ? fmtDuration(activity.duration_minutes) : '')}
          {fact('Category', activity.category_name ? `${activity.category_name}${activity.subcategory_name ? `, ${activity.subcategory_name}` : ''}` : '')}
          {fact('Billing', activity.billable_classification
            ? <span className="ad-mix"><span className="al-swatch" style={{ background: mix.color }} aria-hidden="true" />{mix.label}</span> : '')}
          {fact('Work location', WORK_LOCATION_LABELS[activity.work_location])}
          {fact('Ticket', activity.ticket_reference)}
        </dl>

        {activity.description && <section className="ad-block"><h4>Notes</h4><p>{activity.description}</p></section>}

        {(activity.technologies?.length > 0 || activity.assets?.length > 0) && (
          <section className="ad-block">
            {activity.technologies?.length > 0 && (
              <><h4>Technology</h4><ul className="ad-chips">{activity.technologies.map(t => <li key={t.id}>{t.name}</li>)}</ul></>
            )}
            {activity.assets?.length > 0 && (
              <><h4>Customer assets</h4><ul className="ad-chips">{activity.assets.map(asset => <li key={asset.id}>{asset.name}{asset.hostname ? `, ${asset.hostname}` : ''}{asset.version ? ` — version ${asset.version}` : ''}</li>)}</ul></>
            )}
          </section>
        )}

        {(activity.related_project_title || activity.related_task_title || activity.related_visit_title) && (
          <section className="ad-block">
            <h4>Related work</h4>
            <ul className="ad-list">
              {activity.related_project_title && <li>Project: {activity.related_project_title}</li>}
              {activity.related_task_title && <li>Task: {activity.related_task_title}</li>}
              {activity.related_visit_title && <li>Maintenance visit: {activity.related_visit_title}</li>}
            </ul>
          </section>
        )}

        {(activity.change_type || activity.change_reason || activity.previous_state || activity.new_state) && (
          <section className="ad-block">
            <h4>Change details</h4>
            <dl className="ad-facts">
              {fact('Type', activity.change_type)}
              {fact('Risk', activity.change_risk && activity.change_risk[0].toUpperCase() + activity.change_risk.slice(1))}
              {fact('Reason', activity.change_reason)}
              {fact('Previous state', activity.previous_state)}
              {fact('New state', activity.new_state)}
              {fact('Rollback available', activity.rollback_available ? 'Yes' : 'No')}
              {activity.customer_approval_reference && fact('Customer approval', activity.customer_approval_reference)}
            </dl>
          </section>
        )}

        <section className="ad-block">
          <div className="ad-attach-head">
            <h4><Paperclip size={13} aria-hidden="true" /> Attachments</h4>
            {allowAttachments !== false && (
              <label className="btn btn-ghost btn-sm ad-upload">
                <Upload size={13} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload a file'}
                <input type="file" hidden onChange={handleUpload} disabled={uploading} />
              </label>
            )}
          </div>
          {attachments.length === 0
            ? <p className="ad-none">No attachments yet.</p>
            : (
              <ul className="ad-files">
                {attachments.map(a => (
                  <li key={a.id}>
                    <button type="button" className="ad-file" onClick={() => handleDownload(a)}>{a.original_name}</button>
                    <button type="button" className="ad-remove" aria-label={`Remove ${a.original_name}`} title="Remove" onClick={() => handleDeleteAttachment(a.id)}><Trash2 size={14} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <p className="ad-stamp">
          Logged {fmtDateTime(activity.created_at)}{activity.completed_at ? `, completed ${fmtDateTime(activity.completed_at)}` : ''}
        </p>
      </div>
      <div className="af-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
