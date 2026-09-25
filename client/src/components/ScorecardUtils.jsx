
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
  if (score == null) return { label: '—',                   color: '#9ca3af', bg: 'var(--gray-100)' };
  if (score >= 90)   return { label: 'Exceptional',         color: 'var(--tone-success-text)', bg: 'var(--success-light)' };
  if (score >= 80)   return { label: 'Strong',              color: 'var(--tone-info-text)', bg: 'var(--primary-light)' };
  if (score >= 70)   return { label: 'Acceptable',          color: 'var(--tone-warning-text)', bg: 'var(--warning-light)' };
  if (score >= 60)   return { label: 'Needs Improvement',   color: 'var(--tone-warning-text)', bg: 'var(--warning-light)' };
  return               { label: 'Performance Concern',       color: 'var(--tone-danger-text)', bg: 'var(--danger-light)' };
}

export function ScoreBadge({ score, size = 'md' }) {
  const r = getRating(score);
  const fs = size === 'lg' ? 13 : 11;
  const pad = size === 'lg' ? '4px 12px' : '2px 8px';
  return (
    <span className="u-10c16b9" style={{ background: r.bg, color: r.color, padding: pad, fontSize: fs }}>
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
    <div className="u-7df5029" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="u-b2d26bf">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" className="u-aa3fad6" strokeWidth={7} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={r.color}
          strokeWidth={7} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className="u-7e3f924" />
      </svg>
      <div className="u-74f5aa5">
        <span className="u-65c4089" style={{ fontSize: size > 70 ? 16 : 13, color: r.color }}>
          {score != null ? `${score}%` : '—'}
        </span>
      </div>
    </div>
  );
}

/* Star-style 1-5 picker */
export function DimPicker({ value, onChange, disabled }) {
  return (
    <div className="flex gap-4">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" disabled={disabled} onClick={() => onChange(n)}
          className="u-14de30b" style={{ cursor: disabled ? 'default' : 'pointer', background: value >= n ? '#2563eb' : 'var(--gray-200)', color: value >= n ? '#fff' : '#6b7280' }}>
          {n}
        </button>
      ))}
    </div>
  );
}

/* Full scorecard breakdown view (read-only) */
export function ScorecardBreakdown({ sc }) {
  return (
    <div className="u-a56c85e">
      {Object.entries(WEIGHTS).map(([key, meta]) => {
        const val = sc[key];
        const pct = (val / 5) * 100;
        return (
          <div key={key}>
            <div className="u-02cb0d7">
              <span className="u-a82e7d9">{meta.label}</span>
              <span className="u-db12fa5">{val}/5 &nbsp;<strong style={{ color: meta.color }}>{meta.pct}%</strong></span>
            </div>
            <div className="u-3cf2d61">
              <div className="u-e41e2b9" style={{ width: `${pct}%`, background: meta.color }} />
            </div>
          </div>
        );
      })}
      <div className="u-c0b5fd5">
        <span>Base score: <strong>{sc.base_score}%</strong></span>
        <span>Difficulty: <strong style={{ color: DIFFICULTY_LABELS[sc.difficulty]?.color }}>
          {DIFFICULTY_LABELS[sc.difficulty]?.label} ({DIFFICULTY_LABELS[sc.difficulty]?.mult})
        </strong></span>
        <span>Final: <strong>{sc.adjusted_score}%</strong></span>
      </div>
    </div>
  );
}
