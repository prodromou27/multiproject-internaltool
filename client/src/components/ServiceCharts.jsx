import React, { useState } from 'react';
import './billingMix.css';
import './ServiceCharts.css';

/* Shared by Service Operations and the Customer Service Profile: the billing-mix
   bar and the ranking table. Colour follows the billing type everywhere; ranking
   bars stay neutral so a coloured mark always means a billing type. */

export function fmtHours(hours) {
  const total = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* Billing types, in a fixed order. Colour follows the type, not its rank. */
const MIX = [
  { key: 'included_in_contract', label: 'Included in contract', color: 'var(--mix-included)' },
  { key: 'billable',             label: 'Billable',             color: 'var(--mix-billable)' },
  { key: 'internal',             label: 'Internal',             color: 'var(--mix-internal)' },
];

export function buildMix(byBillable = []) {
  const known = new Set(MIX.map(m => m.key));
  const rows = MIX.map(m => ({ ...m, hours: byBillable.find(r => r.classification === m.key)?.hours || 0 }));
  rows.push({
    key: 'other', label: 'Other', hint: 'Non-billable, not applicable or not set', color: 'var(--mix-other)',
    hours: byBillable.filter(r => !known.has(r.classification)).reduce((sum, r) => sum + (r.hours || 0), 0),
  });
  const total = rows.reduce((sum, r) => sum + r.hours, 0);
  return { rows: rows.filter(r => r.hours > 0), total };
}

/* Top N by value; the tail folds into one "Other" row so the list stays scannable. */
function topRows(rows, valueKey, limit = 8) {
  const sorted = [...rows].sort((a, b) => b[valueKey] - a[valueKey]);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  return [...head, {
    name: `Other (${rest.length})`, isOther: true,
    [valueKey]: rest.reduce((sum, r) => sum + r[valueKey], 0),
    count: rest.reduce((sum, r) => sum + (r.count || 0), 0),
  }];
}

export function MixBar({ mix }) {
  const [hover, setHover] = useState(null);
  const summary = mix.rows.map(r => `${fmtHours(r.hours)} ${r.label.toLowerCase()}`).join(', ');
  return (
    <div className="svc-charts">
      <div className="so-mix" role="img" aria-label={`${fmtHours(mix.total)} logged. ${summary}`}>
        {mix.rows.map(r => (
          <span key={r.key} className={'so-seg' + (hover && hover !== r.key ? ' is-dim' : '')}
            style={{ flex: `${r.hours} 0 0`, background: r.color }}
            title={`${r.label}: ${fmtHours(r.hours)} (${Math.round((r.hours / mix.total) * 100)}%)`}
            onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} />
        ))}
      </div>
      <ul className="so-legend">
        {mix.rows.map(r => (
          <li key={r.key} className={hover && hover !== r.key ? 'is-dim' : ''} title={r.hint}
            onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
            <span className="so-swatch" style={{ background: r.color }} aria-hidden="true" />
            <span className="so-legend-label">{r.label}</span>
            <span className="so-legend-value">{fmtHours(r.hours)}</span>
            <span className="so-legend-share">{Math.round((r.hours / mix.total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* A ranking is a real table (name, bar, value) so the numbers are always readable
   as text. One-row rankings aren't drawn: a single bar says nothing. */
export function Ranking({ title, note, rows, valueKey, format, detail }) {
  if (rows.length < 2) return null;
  const shown = topRows(rows, valueKey);
  const max = Math.max(...shown.map(r => r[valueKey]), 0) || 1;
  return (
    <section className="card so-rank-card svc-charts">
      <table className="so-rank">
        <caption><h2>{title}</h2>{note && <span>{note}</span>}</caption>
        <colgroup><col className="so-col-name" /><col /><col className="so-col-value" />{detail && <col className="so-col-detail" />}</colgroup>
        <tbody>
          {shown.map(r => (
            <tr key={r.name} className={r.isOther ? 'is-other' : ''}
              title={`${r.name}: ${format(r[valueKey])}${detail ? `, ${detail(r)}` : ''}`}>
              <th scope="row">{r.name}</th>
              <td className="so-bar-cell"><span className="so-fill" style={{ width: `${(r[valueKey] / max) * 100}%` }} /></td>
              <td className="so-num">{format(r[valueKey])}</td>
              {detail && <td className="so-detail">{detail(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* The lead block on a service view: total hours as the one big number, beside
   where that time went by billing type. */
export function HoursHero({ label = 'Hours logged', hours, context, mix }) {
  return (
    <section className="card so-hero svc-charts" aria-label="Summary">
      <div className="so-hero-figure">
        <span className="so-hero-label">{label}</span>
        <strong className="so-hero-number">{fmtHours(hours)}</strong>
        {context && <p className="so-hero-context">{context}</p>}
      </div>
      <div className="so-hero-mix">
        <h2>Where the time went</h2>
        {mix.total > 0
          ? <MixBar mix={mix} />
          : <p className="so-muted">No durations were recorded in this period, so time can't be split by billing type.</p>}
      </div>
    </section>
  );
}
