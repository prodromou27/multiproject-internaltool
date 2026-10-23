import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { LoadError } from '../../components/LoadError';
import { useToast } from '../../components/Toast';

/* Settings → Backups & health → Storage: how long customer report files are kept,
   and what the uploads folder holds. A removed report stays in the customer's
   report history and can be generated again there. */
const size = bytes => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

export function StorageTab() {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(null), [days, setDays] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.reportRetention().then(result => { setData(result); setDays(String(result.days)); }).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try { const result = await api.saveReportRetention(Number(days)); setData(result); toast.success(Number(days) ? `Report files kept for ${days} days` : 'Report files kept always'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  async function purge() {
    setBusy(true);
    try { const result = await api.purgeReportFiles(); setData(d => ({ ...d, usage: result.usage })); toast.success(result.removed ? `${result.removed} old report files removed (${size(result.bytes)})` : 'No report files are past the limit'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  if (error && !data) return <LoadError what="Storage" error={error} onRetry={load} />;
  if (!data) return <p className="text-muted" role="status">Loading…</p>;
  const u = data.usage;
  return <div>
    <p className="text-sm" role="status">Report files: <strong>{u.report_files}</strong> ({size(u.report_bytes)}){u.reports_removed ? `, ${u.reports_removed} removed after the limit` : ''} · Attachments: <strong>{u.attachments}</strong> ({size(u.attachment_bytes)})</p>
    <form className="flex gap-8" style={{ alignItems: 'end', flexWrap: 'wrap' }} onSubmit={save}>
      <div className="form-group" style={{ margin: 0 }}><label htmlFor="report-retention-days">Keep customer report files for (days)</label>
        <input id="report-retention-days" type="number" min="0" max="3650" required value={days} onChange={event => setDays(event.target.value)} style={{ width: 120 }} /></div>
      <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !data.days} onClick={purge}>Remove old files now</button>
    </form>
    <p className="text-sm text-muted">After this many days a report's file is removed each morning; 0 keeps them always. The report stays in the customer's report history, with its period and notes, and can be generated again there (with the data as it is then). Reports waiting for review are kept. Compressing would not save space: the files are encrypted, and Word and PDF files are already compressed.</p>
  </div>;
}
