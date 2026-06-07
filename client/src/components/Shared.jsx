import React, { useContext, useRef, useState, useEffect } from 'react';
import { X, AtSign } from 'lucide-react';
import { StatusContext, getStatusDef } from '../hooks/useStatuses';

// Fallback labels for when config isn't loaded yet
const STATUS_LABELS = {
  active: 'Active', closed: 'Closed', pending_closure: 'Pending', on_hold: 'On Hold',
  open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
  scheduled: 'Scheduled', completed: 'Completed',
  waiting_customer: 'Waiting for Customer', waiting_vendor: 'Waiting for Vendor',
  not_started: 'Not Started', delayed: 'Delayed', completed_engineer: 'Completed by Engineer',
  pending_approval: 'Pending Approval', reopened: 'Reopened',
};

export function StatusBadge({ s }) {
  const ctx = useContext(StatusContext);
  const config = ctx?.config;

  // Try each entity type in turn
  let def = null;
  if (config) {
    for (const et of ['project', 'task', 'visit']) {
      def = getStatusDef(config, et, s);
      if (def) break;
    }
  }

  if (def) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
        background: def.bg, color: def.text, whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: def.dot, flexShrink: 0 }} />
        {def.label}
      </span>
    );
  }

  // Fallback to CSS class (handles legacy values & pre-load state)
  return (
    <span className={`badge badge-${s}`}>
      <span className="badge-dot" />
      {STATUS_LABELS[s] || s}
    </span>
  );
}

/* ── RAG Health Badge ─────────────────────────────────────── */
const RAG_CONFIG = {
  red:   { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444', label: 'Red'   },
  amber: { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b', label: 'Amber' },
  green: { bg: '#f0fdf4', text: '#166534', dot: '#22c55e', label: 'Green' },
};

export function RagBadge({ rag }) {
  const c = RAG_CONFIG[rag];
  if (!c) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.text, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {c.label}
    </span>
  );
}

export function PriorityBadge({ p }) {
  const icons = { high: '↑', medium: '→', low: '↓' };
  return (
    <span className={`badge badge-${p}`}>
      {icons[p] || ''} {p}
    </span>
  );
}

export function fmtDate(d) {
  if (!d) return null;
  // Parse YYYY-MM-DD as local date to avoid UTC-to-local offset shifting the day
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(d) {
  if (!d) return false;
  // Compare date strings directly (YYYY-MM-DD) to avoid time-of-day false positives
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10) < todayStr;
}

/** Returns a human-friendly relative time string ("just now", "5m ago", "3h ago", "2 days ago"). */
export function fmtRelative(dt) {
  if (!dt) return '—';
  const diff = Date.now() - new Date(dt).getTime();
  if (isNaN(diff)) return '—';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d !== 1 ? 's' : ''} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo !== 1 ? 's' : ''} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) !== 1 ? 's' : ''} ago`;
}

export function Modal({ title, onClose, children, footer, wide, width }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : wide ? { maxWidth: 700 } : {}}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, showLabel }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct >= 100 ? 'var(--success)' : pct >= 70 ? 'var(--primary)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="progress-bar" style={{ flex: 1 }}>
        <div className="progress-bar-fill" style={{ width: pct + '%', background: color }} />
      </div>
      {showLabel && <span style={{ fontSize: 11, color: 'var(--gray-500)', width: 34, textAlign: 'right', flexShrink: 0 }}>{Math.round(pct)}%</span>}
    </div>
  );
}

/* ── Confirm Dialog — replaces window.confirm() ─────────── */
/**
 * Usage:
 *   const { confirmDialog, ConfirmDialogNode } = useConfirm();
 *   // In JSX: {ConfirmDialogNode}
 *   // To confirm: const ok = await confirmDialog('Are you sure?', 'Delete user');
 */
export function useConfirm() {
  const [state, setState] = useState(null); // { message, title, resolve }

  const confirmDialog = (message, title = 'Confirm') =>
    new Promise(resolve => setState({ message, title, resolve }));

  const handleChoice = (result) => {
    state?.resolve(result);
    setState(null);
  };

  const ConfirmDialogNode = state ? (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">{state.title}</span>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{state.message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => handleChoice(false)} autoFocus>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleChoice(true)}>Confirm</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirmDialog, ConfirmDialogNode };
}

/* ── Mention-aware text renderer ─────────────────────────── */
export function renderMentions(text) {
  if (!text) return null;
  const parts = text.split(/(@\w[\w\s]*?\w(?=\s|$|[^a-zA-Z]))/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '0 3px', fontWeight: 600, fontSize: '0.92em' }}>{p}</span>
      : p
  );
}

/* ── @Mention autocomplete input ─────────────────────────── */
export function MentionInput({ value, onChange, onKeyDown, placeholder, disabled, style, users = [], rows }) {
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen,  setMentionOpen]  = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef(null);

  // Detect @-trigger on change
  function handleChange(e) {
    const val = e.target.value;
    onChange(val);

    // Find if cursor is right after an @ sequence
    const cursor = e.target.selectionStart;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  }

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(mentionQuery) ||
    u.email?.toLowerCase().includes(mentionQuery)
  ).slice(0, 6);

  function insertMention(name) {
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const textBefore = value.slice(0, cursor);
    const textAfter  = value.slice(cursor);
    const replaced   = textBefore.replace(/@(\w*)$/, `@${name} `);
    onChange(replaced + textAfter);
    setMentionOpen(false);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = replaced.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function handleKeyDown(e) {
    if (mentionOpen && filtered.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[mentionIndex].name); return; }
      if (e.key === 'Escape')    { setMentionOpen(false); return; }
    }
    if (onKeyDown) onKeyDown(e);
  }

  // Close on outside click
  useEffect(() => {
    function onClick(e) {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target)) setMentionOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const Tag = rows ? 'textarea' : 'input';

  return (
    <div style={{ position: 'relative', flex: style?.flex ?? 1 }}>
      <Tag
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Add a comment… (type @name to mention someone)'}
        disabled={disabled}
        rows={rows}
        style={{ width: '100%', fontSize: 13, boxSizing: 'border-box', ...style }}
      />
      {mentionOpen && filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, zIndex: 100,
          background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)', minWidth: 200, marginBottom: 2,
          overflow: 'hidden',
        }}>
          {filtered.map((u, i) => (
            <div
              key={u.id}
              onMouseDown={e => { e.preventDefault(); insertMention(u.name); }}
              style={{
                padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                background: i === mentionIndex ? '#eff6ff' : '#fff',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--gray-100)' : 'none',
              }}
            >
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{u.role}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p style={{ fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4 }}>{title}</p>
      {description && <p style={{ fontSize: 13 }}>{description}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
