import { useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';

/* ── Reject closure dialog ───────────────────────────────── */
export function RejectDialog({ onConfirm, onCancel }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (saving || !note.trim()) return;
    setSaving(true); setError('');
    try { await onConfirm(note); }
    catch (failure) { setError(failure.message || 'Unable to return this project for revision'); }
    finally { setSaving(false); }
  }
  return <Modal title="Send Back for Revision" onClose={saving ? () => {} : onCancel}>
    <form onSubmit={submit}>
      <p className="text-muted text-sm">The project will be reopened, and the assigned team will receive your revision instructions.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-group"><label htmlFor="rejection-note">Revision instructions *</label>
        <textarea id="rejection-note" value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={4} required autoFocus disabled={saving} />
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-warning" disabled={saving || !note.trim()}>{saving ? 'Saving...' : 'Send Back for Revision'}</button>
      </div>
    </form>
  </Modal>;
}

export function WaitingDialog({ initial, onConfirm, onCancel }) {
  const [reason, setReason] = useState(initial || '');
  return (
    <Modal title="Waiting for Customer" onClose={onCancel}>
      <p className="u-2f19faf">
        Describe what is needed from the customer before work can continue.
      </p>
      <div className="form-group">
        <label>Pending From Customer <span className="u-497726e">*</span></label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Awaiting signed approval, credentials for system access…"
          rows={3}
          autoFocus
        />
      </div>
      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}>Set Status</button>
      </div>
    </Modal>
  );
}

// ─── Excel Effort-Sheet Import Modal ───────────────────────────────────────
export function ImportExcelModal({ projectId, onClose, onImported }) {
  const [file,      setFile]      = useState(null);
  const [preview,   setPreview]   = useState(null);   // { tasks, meta }
  const [selected,  setSelected]  = useState(new Set());
  const [loading,   setLoading]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState('');

  async function handleParse() {
    if (!file) return;
    setLoading(true); setError(''); setPreview(null); setSelected(new Set()); setDone('');
    try {
      const res = await api.importExcelPreview(projectId, file);
      if (res.error) { setError(res.error); return; }
      setPreview(res);
      setSelected(new Set(res.tasks.map((_, i) => i)));
    } catch (e) {
      setError('Failed to parse file: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleAll(checked) {
    setSelected(checked ? new Set(preview.tasks.map((_, i) => i)) : new Set());
  }

  function toggleOne(i) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function handleImport() {
    if (!preview || selected.size === 0) return;
    setImporting(true); setError('');
    try {
      const tasks = [...selected].map(i => preview.tasks[i]);
      const res = await api.importExcelConfirm(projectId, tasks);
      if (res.error) { setError(res.error); return; }
      setDone(res.message || `${res.created} tasks imported`);
      setPreview(null);
      onImported();
    } catch (e) {
      setError('Import failed: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  // Group tasks: product (amber row) → subProduct (plain row) → taskGroup (grey row)
  function groupedTasks() {
    const groups = [];
    let lastProduct = null, lastSub = null, lastGroup = null;
    (preview?.tasks || []).forEach((t, i) => {
      if (t.product !== lastProduct) {
        if (t.product) groups.push({ type: 'product', label: t.product });
        lastProduct = t.product; lastSub = null; lastGroup = null;
      }
      const subKey = t.subProduct || '';
      if (subKey !== lastSub) {
        if (t.subProduct) groups.push({ type: 'sub', label: t.subProduct });
        lastSub = subKey; lastGroup = null;
      }
      if (t.taskGroup !== lastGroup) {
        groups.push({ type: 'group', label: t.taskGroup || 'General' });
        lastGroup = t.taskGroup;
      }
      groups.push({ type: 'task', task: t, index: i });
    });
    return groups;
  }

  const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--gray-100)' };

  return (
    <Modal title="Import Tasks from Excel" onClose={onClose} width={780}>
      {/* File picker row */}
      <div className="u-8822c62">
        <label className="u-b260393">
          <Upload size={16} color="var(--primary)" />
          {file ? file.name : 'Click to select an Excel (.xlsx) effort sheet…'}
          <input type="file" accept=".xlsx,.xls" className="u-6b99de8"
            onChange={e => { setFile(e.target.files[0] || null); setPreview(null); setDone(''); setError(''); }} />
        </label>
        <button className="btn btn-primary btn-sm" onClick={handleParse} disabled={!file || loading}>
          {loading ? 'Parsing…' : 'Parse'}
        </button>
      </div>

      {error && <p className="u-6fb09ce">{error}</p>}
      {done  && <p className="u-1377b98">{done}</p>}

      {/* Metadata bar */}
      {preview?.meta && Object.keys(preview.meta).length > 0 && (
        <div className="u-c62f806">
          {preview.meta.customer    && <span><b>Customer:</b> {preview.meta.customer}</span>}
          {preview.meta.projectName && <span><b>Project:</b> {preview.meta.projectName}</span>}
          {preview.meta.reference   && <span><b>Ref:</b> {preview.meta.reference}</span>}
          {preview.meta.owner       && <span><b>Owner:</b> {preview.meta.owner}</span>}
          {preview.meta.completionDate && <span><b>Completion:</b> {preview.meta.completionDate}</span>}
        </div>
      )}

      {/* Task preview */}
      {preview && preview.tasks.length > 0 && (
        <>
          <div className="u-5c9f90e">
            <span className="u-b8aa5ab">
              Found <b>{preview.tasks.length}</b> task{preview.tasks.length !== 1 ? 's' : ''} — {selected.size} selected
            </span>
            <div className="flex gap-8">
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(true)}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(false)}>None</button>
            </div>
          </div>

          <div className="u-6a9641f">
            {groupedTasks().map((item, idx) => {
              if (item.type === 'product') return (
                <div key={idx} className="u-83795e6">
                  📦 {item.label || 'General Product'}
                </div>
              );
              if (item.type === 'sub') return (
                <div key={idx} className="u-3d61880">
                  ▸ {item.label}
                </div>
              );
              if (item.type === 'group') return (
                <div key={idx} className="u-578e880">
                  {item.label}
                </div>
              );
              const { task: t, index: i } = item;
              return (
                <div key={idx} className="u-41236a3" style={{ ...ROW, background: selected.has(i) ? '#f0fdf4' : 'white' }}
                  onClick={() => toggleOne(i)}>
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggleOne(i)}
                    onClick={e => e.stopPropagation()} className="flex-shrink-0" />
                  <div className="u-b94ccc1">
                    {t.title}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {preview && preview.tasks.length === 0 && (
        <p className="u-4d136d2">
          No tasks found. Make sure you're using an effort sheet with yellow task rows.
        </p>
      )}

      <div className="modal-footer u-cc45258">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        {preview && preview.tasks.length > 0 && (
          <button className="btn btn-primary" onClick={handleImport}
            disabled={selected.size === 0 || importing}>
            {importing ? 'Importing…' : `Import ${selected.size} Task${selected.size !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
