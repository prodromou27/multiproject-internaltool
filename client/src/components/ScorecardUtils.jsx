import React from 'react';

export const WEIGHTS = {
  timeline_rating:         { label: 'Timeline Rating',          pct: 15, color: '#3b82f6' },
  delivery_quality:        { label: 'Delivery Quality',         pct: 30, color: '#8b5cf6' },
  communication_ownership: { label: 'Communication & Ownership',pct: 20, color: '#f59e0b' },
  documentation_quality:   { label: 'Documentation Quality',    pct: 15, color: '#10b981' },
  customer_feedback:       { label: 'Customer Feedback',        pct: 20, color: '#ef4444' },
};

export const DIFFICULTY_LABELS = {
  1: { label: 'Very Simple',    mult: '×0.90', color: '#6b7280' },
  2: { label: 'Simple',         mult: '×0.95', color: '#3b82f6' },
  3: { label: 'Medium',         mult: '×1.00', color: '#f59e0b' },
  4: { label: 'Complex',        mult: '×1.05', color: '#8b5cf6' },
  5: { label: 'Highly Complex', mult: '×1.10', color: '#ef4444' },
};

export function getRating(score) {
  if (score == null) return { label: '—',                   color: '#9ca3af', bg: '#f3f4f6' };
  if (score >= 90)   return { label: 'Exceptional',         color: '#065f46', bg: '#d1fae5' };
  if (score >= 80)   return { label: 'Strong',              color: '#1d4ed8', bg: '#dbeafe' };
  if (score >= 70)   return { label: 'Acceptable',          color: '#854d0e', bg: '#fef9c3' };
  if (score >= 60)   return { label: 'Needs Improvement',   color: '#92400e', bg: '#fef3c7' };
  return               { label: 'Performance Concern',       color: '#991b1b', bg: '#fee2e2' };
}

export function ScoreBadge({ score, size = 'md' }) {
  const r = getRating(score);
  const fs = size === 'lg' ? 13 : 11;
  const pad = size === 'lg' ? '4px 12px' : '2px 8px';
  return (
    <span style={{ background: r.bg, color: r.color, borderRadius: 99, padding: pad,
      fontSize: fs, fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-block' }}>
      {score != null ? `${score}%` : ''} {r.label}
    </span>
  );
}

export function ScoreGauge({ score, size = 80 }) {
  const r = getRating(score);
  const pct = score ?? 0;
  const radius = size / 2 - 8;
  const circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={7} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={r.color}
          strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center'
      }}>
        <span style={{ fontSize: size > 70 ? 16 : 13, fontWeight: 800, color: r.color, lineHeight: 1 }}>
          {score != null ? `${score}%` : '—'}
        </span>
      </div>
    </div>
  );
}

/* Star-style 1-5 picker */
export function DimPicker({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" disabled={disabled} onClick={() => onChange(n)}
          style={{
            width: 34, height: 34, borderRadius: 6, border: 'none', cursor: disabled ? 'default' : 'pointer',
            fontWeight: 700, fontSize: 14,
            background: value >= n ? '#2563eb' : '#e5e7eb',
            color: value >= n ? '#fff' : '#6b7280',
            transition: 'background .1s'
          }}>
          {n}
        </button>
      ))}
    </div>
  );
}

/* Full scorecard breakdown view (read-only) */
export function ScorecardBreakdown({ sc }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Object.entries(WEIGHTS).map(([key, meta]) => {
        const val = sc[key];
        const pct = (val / 5) * 100;
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: '#374151' }}>{meta.label}</span>
              <span style={{ color: '#6b7280' }}>{val}/5 &nbsp;<strong style={{ color: meta.color }}>{meta.pct}%</strong></span>
            </div>
            <div style={{ background: '#e5e7eb', borderRadius: 99, height: 7, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 99, transition: 'width .4s' }} />
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 6, padding: '8px 12px', background: '#f9fafb', borderRadius: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
        <span>Base score: <strong>{sc.base_score}%</strong></span>
        <span>Difficulty: <strong style={{ color: DIFFICULTY_LABELS[sc.difficulty]?.color }}>
          {DIFFICULTY_LABELS[sc.difficulty]?.label} ({DIFFICULTY_LABELS[sc.difficulty]?.mult})
        </strong></span>
        <span>Final: <strong>{sc.adjusted_score}%</strong></span>
      </div>
    </div>
  );
}
