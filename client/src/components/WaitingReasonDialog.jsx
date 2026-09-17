import React, { useId, useRef, useState } from 'react';
import { Modal } from './Shared';

export default function WaitingReasonDialog({ onConfirm, onCancel, initial = '', title = 'Waiting for Customer' }) {
  const [reason, setReason] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const reasonId = useId();
  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !reason.trim()) return;
    submitting.current = true;
    setSaving(true); setError('');
    try {
      await onConfirm(reason.trim());
      onCancel();
    } catch (failure) {
      setError(failure.message || 'Could not save this status change');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  return <Modal title={title} onClose={saving ? () => {} : onCancel}>
    <form onSubmit={submit}>
      <p className="text-muted text-sm" style={{ marginBottom: 14 }}>Describe what is needed before work can continue.</p>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group">
        <label htmlFor={reasonId}>Reason *</label>
        <textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={10000} required autoFocus disabled={saving} />
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || !reason.trim()}>{saving ? 'Saving...' : 'Set Status'}</button>
      </div>
    </form>
  </Modal>;
}
