import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Pencil, Trash2, Save, Loader2, Tag, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../../api';
import { useStatuses } from '../../hooks/useStatuses';

export const COLOR_PRESETS = [
  { bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', name: 'Blue'   },
  { bg: '#fef9c3', text: '#854d0e', dot: '#eab308', name: 'Yellow' },
  { bg: '#fff7ed', text: '#9a3412', dot: '#f97316', name: 'Orange' },
  { bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', name: 'Purple' },
  { bg: '#dcfce7', text: '#166534', dot: '#22c55e', name: 'Green'  },
  { bg: '#d1fae5', text: '#065f46', dot: '#10b981', name: 'Teal'   },
  { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', name: 'Red'    },
  { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', name: 'Amber'  },
  { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', name: 'Slate'  },
  { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6', name: 'Indigo' },
  { bg: '#fce7f3', text: '#9d174d', dot: '#ec4899', name: 'Pink'   },
  { bg: '#f0fdf4', text: '#065f46', dot: '#86efac', name: 'Lime'   },
];

export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function StatusRow({ status, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(status.label);
  const [editValue, setEditValue] = useState(status.value);
  const [showColors, setShowColors] = useState(false);

  function save() {
    if (!editLabel.trim()) return;
    const val = editValue.trim() || slugify(editLabel.trim());
    onUpdate({ ...status, label: editLabel.trim(), value: val });
    setEditing(false);
    setShowColors(false);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-200)',
      flexWrap: 'wrap',
    }}>
      {/* Color preview */}
      <span style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: status.bg, border: `2px solid ${status.dot}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }} onClick={() => setShowColors(v => !v)} title="Change colour">
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.dot }} />
      </span>

      {/* Color picker popup */}
      {showColors && (
        <div style={{
          position: 'absolute', zIndex: 100, background: '#fff', border: '1px solid var(--gray-200)',
          borderRadius: 10, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          display: 'flex', flexWrap: 'wrap', gap: 6, width: 200,
        }}>
          {COLOR_PRESETS.map(p => (
            <span key={p.name} title={p.name}
              onClick={() => { onUpdate({ ...status, bg: p.bg, text: p.text, dot: p.dot }); setShowColors(false); }}
              style={{ width: 28, height: 28, borderRadius: 6, cursor: 'pointer', background: p.bg, border: `2px solid ${p.dot}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.dot }} />
            </span>
          ))}
        </div>
      )}

      {/* Label & value */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex-center gap-6 flex-wrap">
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              placeholder="Label"
              style={{ flex: 1, minWidth: 120, fontSize: 13, padding: '4px 8px' }}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
            />
            <input
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              placeholder="value_slug"
              style={{ width: 130, fontSize: 12, padding: '4px 8px', fontFamily: 'monospace', color: 'var(--gray-500)' }}
            />
          </div>
        ) : (
          <div className="flex-center gap-8">
            <span style={{ fontWeight: 600, fontSize: 13 }}>{status.label}</span>
            <code style={{ fontSize: 11, color: 'var(--gray-400)', background: 'var(--gray-100)', padding: '1px 5px', borderRadius: 4 }}>{status.value}</code>
          </div>
        )}
      </div>

      {/* Toggles */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap', userSelect: 'none' }}>
        <input type="checkbox" checked={!!status.requires_reason} style={{ width: 'auto' }}
          onChange={e => onUpdate({ ...status, requires_reason: e.target.checked })} />
        Requires reason
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap', userSelect: 'none' }}>
        <input type="checkbox" checked={!!status.is_terminal} style={{ width: 'auto' }}
          onChange={e => onUpdate({ ...status, is_terminal: e.target.checked })} />
        Terminal
      </label>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {!isFirst && <button className="btn btn-sm btn-ghost" onClick={onMoveUp} style={{ padding: '3px 5px' }}><ChevronUp size={12} /></button>}
        {!isLast  && <button className="btn btn-sm btn-ghost" onClick={onMoveDown} style={{ padding: '3px 5px' }}><ChevronDown size={12} /></button>}
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={save} style={{ padding: '3px 8px', fontSize: 11 }}>Save</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(false); setEditLabel(status.label); setEditValue(status.value); }} style={{ padding: '3px 6px' }}>✕</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} style={{ padding: '3px 5px' }}><Pencil size={12} /></button>
        )}
        <button className="btn btn-sm btn-danger" onClick={onDelete} style={{ padding: '3px 5px' }}><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

export function StatusSection({ title, statuses, onChange }) {
  function update(idx, updated) {
    const next = [...statuses];
    next[idx] = updated;
    onChange(next);
  }
  function remove(idx) {
    onChange(statuses.filter((_, i) => i !== idx));
  }
  function moveUp(idx) {
    if (idx === 0) return;
    const next = [...statuses];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }
  function moveDown(idx) {
    if (idx === statuses.length - 1) return;
    const next = [...statuses];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }
  function addNew() {
    onChange([...statuses, { value: 'new_status_' + Date.now(), label: 'New Status', bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false }]);
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-800)' }}>{title}</h3>
        <button className="btn btn-sm btn-ghost inline-flex items-center gap-4" onClick={addNew}>
          <Plus size={12} /> Add Status
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        {statuses.map((s, i) => (
          <StatusRow
            key={s.value + i}
            status={s}
            onUpdate={updated => update(i, updated)}
            onDelete={() => remove(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
            isFirst={i === 0}
            isLast={i === statuses.length - 1}
          />
        ))}
        {statuses.length === 0 && (
          <p className="text-muted text-sm" style={{ padding: '12px 0' }}>No statuses defined. Click "+ Add Status" to add one.</p>
        )}
      </div>
    </div>
  );
}

export function StatusManagementTab() {
  const statusCtx = useStatuses();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (statusCtx?.config && !draft) {
      setDraft(JSON.parse(JSON.stringify(statusCtx.config)));
    }
  }, [statusCtx?.config]);  

  async function save() {
    if (!draft) return;
    setSaving(true); setMsg(''); setErr('');
    try {
      await api.saveStatuses(draft);
      await statusCtx.reload();
      setMsg('Status configuration saved successfully.');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  if (!draft) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading status config…
    </div>
  );

  return (
    <div style={{ maxWidth: 740 }}>
      {/* Info banner */}
      <div className="card" style={{ marginBottom: 24, background: 'var(--primary-light)', border: '1px solid #bfdbfe' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Tag size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--tone-info-text)' }}>
            Customise the statuses available for Projects, Tasks, and Maintenance Visits.
            Changes take effect immediately for all users. Click the colour dot to change the badge colour.
            Check <strong>Requires reason</strong> to prompt users for a note when selecting that status.
            Check <strong>Terminal</strong> to mark it as a final/closed state.
          </div>
        </div>
      </div>

      {msg && <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> {msg}</div>}
      {err && <div className="alert alert-danger"  style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {err}</div>}

      <StatusSection
        title="Project Statuses"
        statuses={draft.project || []}
        onChange={list => setDraft(d => ({ ...d, project: list }))}
      />
      <StatusSection
        title="Task Statuses"
        statuses={draft.task || []}
        onChange={list => setDraft(d => ({ ...d, task: list }))}
      />
      <StatusSection
        title="Maintenance Visit Statuses"
        statuses={draft.visit || []}
        onChange={list => setDraft(d => ({ ...d, visit: list }))}
      />

      <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
        <button className="btn btn-primary inline-flex items-center gap-6" onClick={save} disabled={saving}>
          {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save All Changes</>}
        </button>
        <button className="btn btn-ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(statusCtx.config)))} disabled={saving}>
          Reset to Last Saved
        </button>
      </div>
    </div>
  );
}
