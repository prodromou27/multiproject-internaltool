import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { api } from '../api';
import { fmtDate } from './Shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { useAuth } from '../auth';

const fileSize = bytes => {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Files attached to a task, in its dialog. Anyone who may see the task downloads them;
 * those working on it (and managers) add files; whoever added a file, or a manager, removes it.
 */
export default function TaskFiles({ task, canAdd = true, beforeAdd, onAdded }) {
  const { user } = useAuth() || {};
  const isManager = user?.role === 'manager', currentUserId = user?.id;
  const toast = useToast(), confirm = useConfirm(), inputRef = useRef(null);
  const [files, setFiles] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(() => api.taskAttachments(task.id).then(setFiles).catch(failure => { setFiles([]); setError(failure.message); }), [task.id]);
  useEffect(() => { load(); }, [load]);

  async function add(selected) {
    if (!selected.length) return;
    setBusy(true); setError('');
    try {
      await beforeAdd?.();   // e.g. the edit form saves its changes first
      for (const file of selected) await api.uploadTaskAttachment(task.id, file);
      onAdded?.();
      toast.success(selected.length === 1 ? 'File attached' : `${selected.length} files attached`);
      await load();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  async function download(file) {
    setError('');
    try {
      const url = URL.createObjectURL(await api.downloadTaskAttachment(task.id, file.id)), link = document.createElement('a');
      link.href = url; link.download = file.original_name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message); }
  }
  async function remove(file) {
    if (!await confirm(`Remove ${file.original_name}?`, { title: 'Remove file?', label: 'Remove' })) return;
    try { await api.deleteTaskAttachment(task.id, file.id); toast.success('File removed'); await load(); }
    catch (failure) { setError(failure.message); }
  }

  return <section className="st-updates" aria-label="Files">
    <header className="st-head"><h3><Paperclip size={15} aria-hidden="true" /> Files</h3>{files?.length > 0 && <span className="text-sm text-muted">{files.length}</span>}</header>
    {error && <div className="error-msg" role="alert">{error}</div>}
    {!files ? <p className="text-muted text-sm" role="status">Loading files…</p> : !files.length ? <p className="text-muted text-sm">No files attached.</p>
      : <ul className="task-files">{files.map(file => <li key={file.id}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => download(file)}>{file.original_name}</button>
        <span className="text-muted text-sm">{fileSize(file.size)} · {file.uploaded_by_name} · {fmtDate(file.created_at)}</span>
        {(isManager || Number(file.uploaded_by) === Number(currentUserId)) && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${file.original_name}`} onClick={() => remove(file)}>Remove</button>}
      </li>)}</ul>}
    {canAdd && <div className="st-update-actions">
      <label className="btn btn-sm btn-ghost">
        {busy ? 'Attaching…' : 'Attach files'}
        <input ref={inputRef} type="file" multiple hidden disabled={busy} onChange={event => add([...event.target.files])} />
      </label>
      <span className="text-muted text-sm">Up to 20 MB each. No passwords or keys.</span>
    </div>}
  </section>;
}
