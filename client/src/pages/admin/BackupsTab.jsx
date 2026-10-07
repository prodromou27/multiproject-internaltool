import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, DatabaseBackup, Download, RotateCcw, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { Toggle } from './shared';
import './BackupsTab.css';

/* Settings → Backups: the app backs up its own database on a schedule, on
   request and before every restore; a backup can be checked (restored into a
   temporary database), downloaded, uploaded and restored. Server:
   routes/settings/backups.js, databaseBackups.js. */

const KINDS = { scheduled: 'Scheduled', manual: 'Manual', 'before-restore': 'Before a restore', uploaded: 'Uploaded' };
const size = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = iso => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/* Asks for the manager's password (and, to restore, the word RESTORE). */
function PasswordDialog({ title, children, action, needsWord = false, onConfirm, onClose }) {
  const [password, setPassword] = useState(''), [word, setWord] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onConfirm(password); onClose(); } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={title} onClose={busy ? () => {} : onClose}>
    <form onSubmit={submit}>
      {children}
      {error && <div className="error-msg" role="alert">{error}</div>}
      {needsWord && <div className="form-group"><label htmlFor="backup-word">Type RESTORE to confirm</label><input id="backup-word" value={word} onChange={event => setWord(event.target.value)} autoComplete="off" /></div>}
      <div className="form-group"><label htmlFor="backup-password">Your password</label><input id="backup-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required autoFocus={!needsWord} /></div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className={`btn ${needsWord ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !password || (needsWord && word !== 'RESTORE')}>{busy ? 'Working…' : action}</button></div>
    </form>
  </Modal>;
}

function Schedule({ value, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(value), [busy, setBusy] = useState(false);
  useEffect(() => setForm(value), [value]);
  const changed = JSON.stringify(form) !== JSON.stringify(value);
  async function save() {
    setBusy(true);
    try { onSaved(await api.saveBackupSchedule({ ...form, retention_days: Number(form.retention_days), keep_min: Number(form.keep_min) })); toast.success('Backup schedule saved'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <section className="card bk-schedule" aria-labelledby="bk-schedule-title">
    <h3 id="bk-schedule-title">Automatic backups</h3>
    <Toggle checked={form.enabled} onChange={enabled => setForm(current => ({ ...current, enabled }))} label={form.enabled ? 'Back up every day' : 'Automatic backups are off'} />
    <div className="bk-fields">
      <label><span>At (organisation time)</span><input type="time" value={form.time} disabled={!form.enabled} onChange={event => setForm(current => ({ ...current, time: event.target.value }))} /></label>
      <label><span>Keep backups for (days)</span><input type="number" min={1} max={3650} value={form.retention_days} onChange={event => setForm(current => ({ ...current, retention_days: event.target.value }))} /></label>
      <label><span>Always keep at least</span><input type="number" min={1} max={100} value={form.keep_min} onChange={event => setForm(current => ({ ...current, keep_min: event.target.value }))} /></label>
    </div>
    <p className="text-muted text-sm">Older backups are removed after each new one, except the newest ones you always keep and any you uploaded.</p>
    {changed && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save schedule'}</button>}
  </section>;
}

export function BackupsTab() {
  const toast = useToast(), confirm = useConfirm();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [dialog, setDialog] = useState(null), [restarting, setRestarting] = useState(false);
  const fileInput = useRef(null);
  const load = useCallback(async () => {
    try { setData(await api.backups()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(label, work, success) {
    setBusy(label);
    try { const result = await work(); if (success) toast.success(typeof success === 'function' ? success(result) : success); await load(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  async function remove(row) {
    if (!await confirm(`Delete the backup from ${when(row.created_at)}? This cannot be undone.`, { title: 'Delete backup' })) return;
    run(`delete-${row.file}`, () => api.deleteBackup(row.file), 'Backup deleted');
  }
  // After a restore the app restarts; wait for it, then load the restored data.
  async function waitForRestart() {
    setRestarting(true);
    await new Promise(resolve => setTimeout(resolve, 4000));
    for (let attempt = 0; attempt < 90; attempt++) {
      try { const response = await fetch('/api/health', { cache: 'no-store' }); if (response.ok) { window.location.reload(); return; } } catch { /* still restarting */ }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    window.location.reload();
  }

  if (restarting) return <div className="card bk-restarting" role="status"><RotateCcw size={18} className="bk-spin" /> The backup was restored. TeamHub is restarting and this page will reload when it is back.</div>;
  if (error) return <div className="error-msg" role="alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;
  if (!data) return <p className="text-muted">Loading backups…</p>;
  const latest = data.rows[0];
  return <div className="bk">
    {!data.tools && <div className="alert alert-warning" role="alert">This server cannot make backups yet: the PostgreSQL tools (pg_dump, psql) are missing. Rebuild and restart the app container to get them.</div>}
    <section className="card bk-summary">
      <div>
        <h3>Database backups</h3>
        <p className="text-sm">{latest ? <>Last backup {when(latest.created_at)} ({KINDS[latest.kind]?.toLowerCase()}, {size(latest.size_bytes)}).</> : 'No backups yet.'}{' '}
          Backups are kept on the server, in the app&apos;s <code>backups</code> volume. Download one now and then to keep a copy somewhere else.</p>
      </div>
      <div className="bk-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !data.tools || !!data.busy} onClick={() => run('backup', api.createBackup, row => `Backed up (${size(row.size_bytes)})`)}><DatabaseBackup size={14} /> {busy === 'backup' ? 'Backing up…' : 'Back up now'}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={14} /> Upload a backup</button>
        <input ref={fileInput} type="file" accept=".gz,application/gzip" hidden onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) setDialog({ type: 'upload', file });
        }} />
      </div>
    </section>
    <Schedule value={data.schedule} onSaved={schedule => setData(current => ({ ...current, schedule }))} />
    <section className="card" aria-labelledby="bk-list-title">
      <h3 id="bk-list-title">Backups on this server</h3>
      {!data.rows.length ? <p className="text-muted text-sm">None yet. Use “Back up now”, or wait for the scheduled one.</p> :
        <div className="table-wrap"><table className="bk-table">
          <thead><tr><th scope="col">Made</th><th scope="col">Kind</th><th scope="col" className="num">Size</th><th scope="col">Check</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.file}>
            <td>{when(row.created_at)}{row.created_by && <div className="text-muted text-sm">by {row.created_by}</div>}</td>
            <td>{KINDS[row.kind] || row.kind}</td>
            <td className="num">{size(row.size_bytes)}</td>
            <td className="text-sm">{row.verify_error ? <span className="text-danger" title={row.verify_error}><XCircle size={13} /> Failed</span>
              : row.verify_result ? <span className="bk-ok" title={`${row.verify_result.tables} tables, ${row.verify_result.users} users`}><CheckCircle2 size={13} /> Restores ({when(row.verified_at)})</span>
                : <span className="text-muted">Not checked</span>}</td>
            <td><div className="bk-row-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !data.tools} title="Restore it into a temporary database to prove it works" onClick={() => run(`verify-${row.file}`, () => api.verifyBackup(row.file), result => `The backup restores: ${result.tables} tables, ${result.users} users`)}>
                <ShieldCheck size={13} /> {busy === `verify-${row.file}` ? 'Checking…' : 'Check'}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setDialog({ type: 'download', row })}><Download size={13} /> Download</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !data.tools} onClick={() => setDialog({ type: 'restore', row })}><RotateCcw size={13} /> Restore</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete backup from ${when(row.created_at)}`} disabled={!!busy} onClick={() => remove(row)}><Trash2 size={13} /></button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    {dialog?.type === 'download' && <PasswordDialog title="Download backup" action="Download" onClose={() => setDialog(null)}
      onConfirm={password => api.downloadBackup(dialog.row.file, password)}>
      <p className="text-sm">The backup holds the whole database. Keep the file somewhere safe.</p>
    </PasswordDialog>}
    {dialog?.type === 'upload' && <PasswordDialog title="Upload a backup" action="Upload" onClose={() => setDialog(null)}
      onConfirm={async password => { await api.uploadBackup(dialog.file, password); toast.success('Backup uploaded. Check it before restoring.'); await load(); }}>
      <p className="text-sm">{dialog.file.name}: a .sql.gz backup from TeamHub or <code>deploy/backup.sh</code>. Uploading adds it to the list; it does not restore it.</p>
    </PasswordDialog>}
    {dialog?.type === 'restore' && <PasswordDialog title="Restore backup" action="Restore" needsWord onClose={() => setDialog(null)}
      onConfirm={async password => { await api.restoreBackup(dialog.row.file, password); waitForRestart(); }}>
      <div className="alert alert-warning">
        <p><strong>Everything in TeamHub goes back to {when(dialog.row.created_at)}.</strong> Changes made since then are replaced.</p>
        <p className="text-sm">A backup of the current data is made first, so this can be undone. Everyone is signed out while TeamHub restarts, which takes about a minute.</p>
      </div>
    </PasswordDialog>}
  </div>;
}
