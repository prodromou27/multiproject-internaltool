import { useEffect, useState } from 'react';
import { FileText, Paperclip, File, Image, Archive, Upload } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../App';
import { fmtDate, Modal, ProgressBar } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { fileSize } from './shared';

export function AttachmentsSection({ projectId }) {
  const { user }  = useAuth();
  const toast     = useToast();
  const confirm   = useConfirm();
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const load = () => api.attachments(projectId).then(setAttachments);
  useEffect(() => { load(); }, [projectId]);

  async function handleFiles(files) {
    setUploading(true);
    try {
      for (const file of files) {
        await api.uploadAttachment(projectId, file);
      }
      await load();
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e) {
    if (e.target.files.length) handleFiles(Array.from(e.target.files));
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  }

  async function deleteAttachment(id) {
    const ok = await confirm('Remove this attachment?', { title: 'Remove Attachment', label: 'Remove' });
    if (!ok) return;
    try { await api.deleteAttachment(projectId, id); load(); } catch (e) { toast.error(e.message); }
  }

  async function downloadAttachment(attachment) {
    setDownloadingId(attachment.id);
    try {
      const { token } = await api.downloadToken();
      const url = api.downloadAttachmentUrl(projectId, attachment.id, token);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e.message || 'Could not prepare download');
    } finally {
      setDownloadingId(null);
    }
  }

  function getIcon(mime) {
    if (!mime) return <File size={14} color="var(--gray-400)" />;
    if (mime.startsWith('image/')) return <Image size={14} color="var(--primary)" />;
    if (mime === 'application/pdf') return <FileText size={14} color="#ef4444" />;
    if (mime.includes('word') || mime.includes('document')) return <FileText size={14} color="#2563eb" />;
    if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return <FileText size={14} color="#16a34a" />;
    if (mime.includes('zip') || mime.includes('compressed')) return <Archive size={14} color="var(--gray-500)" />;
    return <File size={14} color="var(--gray-400)" />;
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--gray-200)'}`,
          borderRadius: 8, padding: '24px 16px', textAlign: 'center',
          background: dragOver ? '#eff6ff' : 'var(--gray-50)',
          marginBottom: 16, transition: 'all .15s'
        }}
      >
        <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}><Paperclip size={28} color="var(--gray-400)" /></div>
        <p className="text-sm text-muted" style={{ marginBottom: 8 }}>
          {uploading ? 'Uploading…' : 'Drag & drop files here, or'}
        </p>
        <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
          Browse Files
          <input type="file" multiple style={{ display: 'none' }} onChange={onInputChange} disabled={uploading} />
        </label>
        <p className="text-sm text-muted mt-4">Max 20 MB per file</p>
      </div>

      {attachments.length === 0
        ? <p className="text-muted text-sm">No attachments yet</p>
        : <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Size</th><th>Uploaded By</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                {attachments.map(a => (
                  <tr key={a.id}>
                    <td>
                      <span style={{ marginRight: 6 }}>{getIcon(a.mime_type)}</span>
                      <button
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        disabled={downloadingId === a.id}
                        style={{
                          border: 0,
                          padding: 0,
                          background: 'transparent',
                          color: 'var(--primary)',
                          cursor: downloadingId === a.id ? 'wait' : 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                        }}
                      >
                        {downloadingId === a.id ? 'Preparing...' : a.original_name}
                      </button>
                    </td>
                    <td className="text-muted text-sm">{fileSize(a.size)}</td>
                    <td className="text-sm">{a.uploaded_by_name}</td>
                    <td className="text-sm text-muted">{fmtDate(a.created_at)}</td>
                    <td>
                      {(user.role === 'manager' || a.uploaded_by === user.id) &&
                        <button className="btn btn-sm btn-danger" onClick={() => deleteAttachment(a.id)}>Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}

export function KpiSection({ projectId }) {
  const [kpis, setKpis] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', target_value: '', current_value: '', unit: '' });
  const load = () => api.kpis(projectId).then(setKpis);
  useEffect(() => { load(); }, [projectId]);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    if (editing) await api.updateKpi(projectId, editing.id, form);
    else await api.createKpi(projectId, form);
    setShowAdd(false); setEditing(null); setForm({ name: '', target_value: '', current_value: '', unit: '' }); load();
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>KPIs</div>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(true)}>+ Add KPI</button>
      </div>
      {kpis.length === 0 ? <p className="text-muted text-sm">No KPIs defined</p> : kpis.map(k => {
        const pct = k.target_value > 0 ? Math.round((k.current_value / k.target_value) * 100) : 0;
        return (
          <div key={k.id} className="kpi-row">
            <div className="kpi-label">{k.name}</div>
            <div className="kpi-bar"><ProgressBar value={k.current_value} max={k.target_value} /></div>
            <div className="kpi-value">{k.current_value}{k.unit || ''} / {k.target_value}{k.unit || ''} ({pct}%)</div>
            <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(k); setForm({ name: k.name, target_value: k.target_value, current_value: k.current_value, unit: k.unit || '' }); setShowAdd(true); }}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={() => { api.deleteKpi(projectId, k.id).then(load); }}>Del</button>
          </div>
        );
      })}
      {showAdd && (
        <Modal title={editing ? 'Edit KPI' : 'Add KPI'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group"><label>KPI Name *</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="form-row">
              <div className="form-group"><label>Target</label><input type="number" step="any" value={form.target_value} onChange={set('target_value')} required /></div>
              <div className="form-group"><label>Current</label><input type="number" step="any" value={form.current_value} onChange={set('current_value')} /></div>
            </div>
            <div className="form-group"><label>Unit (optional, e.g. %, hrs)</label><input value={form.unit} onChange={set('unit')} /></div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
