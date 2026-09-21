import React from 'react';
import './billingMix.css';
import './ActivityLedger.css';

/* Day-by-day ledger helpers shared by the Activity Log and the Customer Service
   Profile: grouping rows into days, day labels, and the per-day billing bar. */

export function fmtDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`;
}

/* ── Ledger helpers ───────────────────────────────────────────────────── */
export const MIX = {
  included_in_contract: { label: 'Included in contract', color: 'var(--mix-included)' },
  billable:             { label: 'Billable',             color: 'var(--mix-billable)' },
  internal:             { label: 'Internal',             color: 'var(--mix-internal)' },
  non_billable:         { label: 'Non-billable',         color: 'var(--mix-other)' },
  not_applicable:       { label: 'Not applicable',       color: 'var(--mix-other)' },
};
export const mixOf = cls => MIX[cls] || { label: 'Billing not set', color: 'var(--mix-other)' };
export const WORKDAY_MINUTES = 480;

function parseDay(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLabels(value) {
  const date = parseDay(value);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const diff = Math.round((startOfToday - date) / 86400000);
  return {
    when: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'long' }),
    day: date.getDate(),
    month: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
  };
}

/* Rows arrive newest-first, so a day's rows are contiguous. Pagination can cut
   the first or last day on a page; those totals would be wrong, so they're
   flagged `partial` and shown without a total or bar. */
export function groupByDay(rows, page, totalPages) {
  const groups = [];
  for (const row of rows) {
    const date = String(row.activity_date).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(row);
    else groups.push({ date, rows: [row] });
  }
  groups.forEach((group, index) => {
    group.partial = (index === 0 && page > 1) || (index === groups.length - 1 && page < totalPages);
    group.minutes = group.rows.reduce((sum, row) => sum + (row.duration_minutes || 0), 0);
  });
  return groups;
}

export function DayBar({ rows, minutes }) {
  const scale = Math.max(WORKDAY_MINUTES, minutes);
  const chronological = [...rows].reverse().filter(row => row.duration_minutes > 0);
  const byMix = new Map();
  chronological.forEach(row => {
    const label = mixOf(row.billable_classification).label;
    byMix.set(label, (byMix.get(label) || 0) + row.duration_minutes);
  });
  const summary = [...byMix].map(([label, mins]) => `${fmtDuration(mins)} ${label.toLowerCase()}`).join(', ');
  return (
    <>
      <div className="al-bar" role="img" aria-label={`${fmtDuration(minutes)} logged. ${summary}`}>
        {chronological.map(row => (
          <span key={row.id} style={{ width: `${(row.duration_minutes / scale) * 100}%`, background: mixOf(row.billable_classification).color }} />
        ))}
      </div>
      <div className="al-bar-caption" aria-hidden="true">
        {minutes === WORKDAY_MINUTES ? 'A full 8h day'
          : minutes > WORKDAY_MINUTES ? `${fmtDuration(minutes - WORKDAY_MINUTES)} over 8h`
          : `${fmtDuration(WORKDAY_MINUTES - minutes)} left to 8h`}
      </div>
    </>
  );
}

/* One day in the ledger: the date rail with the day's total, the billing bar, and
   the entries (pass <li> rows as children). */
export function LedgerDay({ group, children }) {
  const labels = dayLabels(group.date);
  return (
    <section className="al-day" aria-label={`${labels.when}, ${group.date}`}>
      <div className="al-rail">
        <span className="al-rail-when">{labels.when}</span>
        <span className="al-rail-day">{labels.day}</span>
        <span className="al-rail-month">{labels.month}</span>
        {group.partial
          ? <span className="al-rail-note">Day continues on another page</span>
          : group.minutes > 0 && <span className="al-rail-total">{fmtDuration(group.minutes)}</span>}
      </div>
      <div>
        {!group.partial && group.minutes > 0 && <DayBar rows={group.rows} minutes={group.minutes} />}
        <ul className="al-entries">{children}</ul>
      </div>
    </section>
  );
}
