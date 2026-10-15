
// ─────────────────────────────────────────────────────────────────────────────
// Result cards
// ─────────────────────────────────────────────────────────────────────────────
export const STATUS_BG = {
  active: 'var(--success-light)', on_hold: 'var(--gray-100)', pending_closure: 'var(--warning-light)', closed: 'var(--gray-50)',
  open: '#eff6ff', in_progress: '#eff6ff', done: '#ecfdf5', cancelled: '#f9fafb',
  scheduled: '#eff6ff', completed: '#ecfdf5',
};

// Text on the tinted badge backgrounds: the tone colours keep 4.5:1 (and follow dark mode).
export const STATUS_COLOR = {
  active: 'var(--tone-success-text)', on_hold: 'var(--gray-600)', pending_closure: 'var(--tone-warning-text)', closed: 'var(--gray-600)',
  open: 'var(--tone-info-text)', in_progress: 'var(--tone-info-text)', done: 'var(--tone-success-text)', cancelled: 'var(--gray-600)',
  scheduled: 'var(--tone-info-text)', completed: 'var(--tone-success-text)',
};

export const STATUS_LABEL = {
  active: 'Active', on_hold: 'On Hold', pending_closure: 'Pending Closure', closed: 'Closed',
  open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
  scheduled: 'Scheduled', completed: 'Completed',
};

export const PRIORITY_COLOR = { high: 'var(--tone-danger-text)', medium: 'var(--tone-warning-text)', low: 'var(--tone-success-text)' };

export function SBadge({ s }) {
  if (!s) return null;
  return (
    <span className="u-db8a14c" style={{ background: STATUS_BG[s] || 'var(--gray-100)', color: STATUS_COLOR[s] || 'var(--gray-600)' }}>{STATUS_LABEL[s] || s}</span>
  );
}

export function PBadge({ p }) {
  if (!p) return null;
  return (
    <span className="u-db8a14c" style={{ background: p === 'high' ? '#fef2f2' : p === 'medium' ? '#fffbeb' : '#ecfdf5', color: PRIORITY_COLOR[p] || 'var(--gray-600)' }}>
      {p === 'high' ? '↑' : p === 'medium' ? '→' : '↓'} {p}
    </span>
  );
}
