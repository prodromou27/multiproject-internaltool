import { useState } from 'react';
import { Users as UsersIcon, FolderOpen, CheckCircle2, Lock, ClipboardList, Trash2, MessageSquare, Plus } from 'lucide-react';
import { fmtDate } from '../../components/Shared';
import { useToast } from '../../components/Toast';

/* ── helpers ─────────────────────────────────────────────── */
export function fileSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

export function timeSince(dt) {
  if (!dt) return '—';
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return fmtDate(dt);
}

export const ACTIVITY_ICONS = {
  status_update:  <MessageSquare size={15} color="var(--primary)" />,
  task_done:      <CheckCircle2  size={15} color="var(--success)" />,
  project_closed: <Lock          size={15} color="var(--gray-500)" />,
  mv_report:      <ClipboardList size={15} color="var(--warning)" />,
  new_project:    <FolderOpen    size={15} color="var(--primary)" />,
  new_user:       <UsersIcon     size={15} color="#0891b2" />,
};

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={["u-584a7aa", (disabled ? 'u-61a0750' : 'u-3b6a3a6'), (disabled ? 'u-e1549fd' : 'u-c6e7979')].filter(Boolean).join(' ')}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={["u-e118dc8", (checked ? 'u-1eab90a' : 'u-231159d'), (disabled ? 'u-61a0750' : 'u-3b6a3a6')].filter(Boolean).join(' ')}>
        <div className={["u-6bc4309", (checked ? 'u-04509a7' : 'u-f7bcc11')].filter(Boolean).join(' ')} />
      </button>
      <span className="u-5e0faad">{label}</span>
    </label>
  );
}

export function ToggleRow({ label, description, value, onChange, recommended }) {
  return (
    <div className="u-184ccf1">
      <div>
        <div className="u-c0193ba">
          {label}
          {recommended && <span className="u-619abb4">Recommended</span>}
        </div>
        {description && <div className="u-711e404">{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={["u-c3e9d34", (value ? 'u-1eab90a' : 'u-231159d')].filter(Boolean).join(' ')}
      >
        <span className={["u-bb3c7c5", (value ? 'u-04509a7' : 'u-f7bcc11')].filter(Boolean).join(' ')} />
      </button>
    </div>
  );
}

/* ── Service Activity Tracking admin tab ──────────────────── */
// extraColumns: array of { label, render(item) } — rendered as additional table columns.
// extraField: { label, initial, render(value, setValue) } — an extra control in the add
// form; its value is passed as the second argument to onAdd(name, extraValue).
export function LookupTable({ title, items, onAdd, onToggle, onDelete, extraColumns, extraField }) {
  const [name, setName] = useState('');
  const [fieldValue, setFieldValue] = useState(extraField?.initial ?? null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const columns = extraColumns || [];

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onAdd(name.trim(), fieldValue); setName(''); setFieldValue(extraField?.initial ?? null); }
    catch (e2) { toast.error(e2.message); } finally { setBusy(false); }
  }

  return (
    <div className="card mb-16">
      <div className="section-title">{title}</div>
      <form onSubmit={add} className="u-bad162e">
        <input value={name} onChange={e => setName(e.target.value)} placeholder={`New ${title.toLowerCase()}…`} className="u-eb62184" />
        {extraField && extraField.render(fieldValue, setFieldValue)}
        <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}><Plus size={13} /> Add</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Active</th>{columns.map(c => <th key={c.label}>{c.label}</th>)}<th></th></tr></thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  <label className="u-896e5ae">
                    <input type="checkbox" checked={!!item.active} onChange={() => onToggle(item)} className="u-30e741d" />
                  </label>
                </td>
                {columns.map(c => <td key={c.label}>{c.render(item)}</td>)}
                <td><button className="btn btn-sm btn-ghost" onClick={() => onDelete(item)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={3 + columns.length} className="text-muted">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
