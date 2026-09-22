import { useState } from 'react';
import { Users as UsersIcon, FolderOpen, CheckCircle2, Lock, ClipboardList, Trash2, MessageSquare, Activity, Plus } from 'lucide-react';
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

/* ── Stat Card ───────────────────────────────────────────── */
export function StatCard({ label, value, sub, color, Icon: IconComp }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
      <div style={{ width: 48, height: 48, borderRadius: 10, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {IconComp && <IconComp size={22} color={color} />}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: disabled ? 0.5 : 1 }}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} style={{ border: 0,padding: 0,width: 40, height: 22, borderRadius: 11, position: 'relative', flexShrink: 0, transition: 'background 0.2s', background: checked ? 'var(--primary)' : 'var(--gray-300)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
      </button>
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

export function ToggleRow({ label, description, value, onChange, recommended }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {recommended && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--success-light)', color: 'var(--tone-success-text)' }}>Recommended</span>}
        </div>
        {description && <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          width: 42, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer',
          background: value ? 'var(--primary)' : 'var(--gray-300)',
          position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 21 : 3, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
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
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={`New ${title.toLowerCase()}…`} style={{ flex: 1, minWidth: 160 }} />
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!item.active} onChange={() => onToggle(item)} style={{ width: 'auto' }} />
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
