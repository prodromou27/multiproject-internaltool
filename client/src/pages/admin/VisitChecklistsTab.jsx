import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { LoadError } from '../../components/LoadError';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* Settings → Visit checklists (enhancement E03): the lists of checks engineers work
   through on a maintenance visit. A visit keeps its own copy, so changing a list
   here never rewrites visits already done. */
export function VisitChecklistsTab() {
  const toast = useToast(), confirm = useConfirm();
  const [rows, setRows] = useState(null), [error, setError] = useState(null);
  const [editing, setEditing] = useState(null), [form, setForm] = useState({ name: '', items: '' }), [saving, setSaving] = useState(false);
  const load = useCallback(() => { setError(null); return api.visitChecklists().then(data => setRows(Array.isArray(data?.rows) ? data.rows : [])).catch(setError); }, []);
  useEffect(() => { load(); }, [load]);

  function edit(row) { setEditing(row?.id || 'new'); setForm(row ? { name: row.name, items: row.items.join('\n') } : { name: '', items: '' }); }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    const body = { name: form.name, items: form.items.split('\n').map(item => item.trim()).filter(Boolean) };
    try {
      if (editing === 'new') await api.createVisitChecklist(body); else await api.updateVisitChecklist(editing, body);
      toast.success('Checklist saved'); setEditing(null); await load();
    } catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  async function remove(row) {
    if (!await confirm(`Delete the checklist “${row.name}”? Visits that used it keep their copy.`, { title: 'Delete checklist', label: 'Delete' })) return;
    try { await api.deleteVisitChecklist(row.id); toast.success('Checklist deleted'); await load(); }
    catch (failure) { toast.error(failure.message); }
  }

  if (error && !rows) return <LoadError what="Visit checklists" error={error} onRetry={load} />;
  if (!rows) return <p className="text-muted" role="status">Loading…</p>;
  return <div>
    <p className="text-muted text-sm">What engineers check on a maintenance visit. They pick a list on the visit, mark each check OK, an issue or not applicable, and add notes.</p>
    {rows.length === 0 && editing === null && <p className="text-muted">No checklists yet.</p>}
    {rows.map(row => editing === row.id ? null : <div key={row.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div className="flex" style={{ justifyContent: 'space-between', gap: 8 }}><strong>{row.name}</strong><span className="flex gap-6">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(row)} aria-label={`Edit ${row.name}`}>Edit</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(row)} aria-label={`Delete ${row.name}`}>Delete</button></span></div>
      <div className="text-sm text-muted">{row.items.length} check{row.items.length === 1 ? '' : 's'}: {row.items.slice(0, 4).join(' · ')}{row.items.length > 4 ? ' …' : ''}</div>
    </div>)}
    {editing !== null ? <form className="card" style={{ padding: 12 }} onSubmit={save}>
      <div className="form-group"><label htmlFor="checklist-name">Name</label><input id="checklist-name" required maxLength={120} value={form.name} onChange={event => setForm(f => ({ ...f, name: event.target.value }))} /></div>
      <div className="form-group"><label htmlFor="checklist-items">Checks, one per line</label><textarea id="checklist-items" required rows={8} value={form.items} onChange={event => setForm(f => ({ ...f, items: event.target.value }))} /></div>
      <div className="flex gap-8"><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save checklist'}</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
    </form> : <button type="button" className="btn btn-primary btn-sm" onClick={() => edit(null)}>Add checklist</button>}
  </div>;
}
