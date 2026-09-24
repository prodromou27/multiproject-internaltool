import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Result cards
// ─────────────────────────────────────────────────────────────────────────────
export const STATUS_BG = {
  active: 'var(--success-light)', on_hold: 'var(--gray-100)', pending_closure: 'var(--warning-light)', closed: 'var(--gray-50)',
  open: '#eff6ff', in_progress: '#eff6ff', done: '#ecfdf5', cancelled: '#f9fafb',
  scheduled: '#eff6ff', completed: '#ecfdf5',
};

export const STATUS_COLOR = {
  active: '#059669', on_hold: '#6b7280', pending_closure: '#b45309', closed: '#6b7280',
  open: '#2563eb', in_progress: '#2563eb', done: '#059669', cancelled: '#6b7280',
  scheduled: '#2563eb', completed: '#059669',
};

export const STATUS_LABEL = {
  active: 'Active', on_hold: 'On Hold', pending_closure: 'Pending Closure', closed: 'Closed',
  open: 'Open', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
  scheduled: 'Scheduled', completed: 'Completed',
};

export const PRIORITY_COLOR = { high: '#dc2626', medium: '#d97706', low: '#16a34a' };

export function SBadge({ s }) {
  if (!s) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: STATUS_BG[s] || 'var(--gray-100)',
      color: STATUS_COLOR[s] || '#6b7280',
    }}>{STATUS_LABEL[s] || s}</span>
  );
}

export function PBadge({ p }) {
  if (!p) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: p === 'high' ? '#fef2f2' : p === 'medium' ? '#fffbeb' : '#ecfdf5',
      color: PRIORITY_COLOR[p] || '#6b7280',
    }}>
      {p === 'high' ? '↑' : p === 'medium' ? '→' : '↓'} {p}
    </span>
  );
}
