import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { api } from '../api';
import { fmtHours, plural, buildMix, HoursHero, Ranking } from '../components/ServiceCharts';
import './ServiceOperations.css';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  if (preset === 'last_month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (preset === 'quarter') {
    const start = new Date(now); start.setDate(start.getDate() - 89);
    return { from: iso(start) };
  }
  if (preset === 'custom') return { ...(customFrom ? { from: customFrom } : {}), ...(customTo ? { to: customTo } : {}) };
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
}

const WORK_TYPES = [
  { label: 'Support', names: ['Support'] },
  { label: 'Maintenance', names: ['Maintenance', 'Preventive Maintenance'] },
  { label: 'Configuration changes', names: ['Configuration Change'] },
  { label: 'Upgrades', names: ['Upgrade'] },
];

export default function ServiceOperations() {
  const [preset, setPreset] = useSavedFilter('service_ops_range', 'month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    api.serviceActivityOverview(range)
      .then(d => { if (current) setData(d); })
      .catch(e => { if (current) setError(e.message || 'Could not load service operations'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [range, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const mix = useMemo(() => buildMix(data?.byBillable), [data]);

  const countFor = names => names.reduce((sum, n) => sum + (data?.byCategory?.find(c => c.name === n)?.count || 0), 0);

  return (
    <div className="page service-ops">
      <PageHeader eyebrow="Operations" title="Service Activity Reports"
        description="Where service time went in the selected period, and who spent it. For a single customer's tickets and history, see Managed Customers."
        actions={<><Link to="/reports?view=service_activity" className="btn btn-ghost">Build detailed report</Link>
          <button className="btn btn-ghost" onClick={retry} disabled={loading}><RefreshCw size={14} /> {loading && data ? 'Refreshing…' : 'Refresh'}</button></>} />

      <div className="so-toolbar">
        <div className="so-segment" role="group" aria-label="Period">
          {[['month', 'This month'], ['last_month', 'Last month'], ['quarter', 'Last 90 days'], ['custom', 'Custom']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="so-custom">
            <label>From <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label>
            <label>To <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></label>
          </div>
        )}
      </div>

      <div className="so-period-context" aria-live="polite">
        <span>Reporting period</span><strong>{range.from || 'Beginning'} – {range.to || iso(new Date())}</strong>
        {data && <span>{plural(data.total_activities, 'activity', 'activities')} · {fmtHours(data.total_hours)}</span>}
      </div>

      {error && data && <div className="alert alert-warning" role="alert">{error} Showing the last loaded report. <button className="btn btn-ghost btn-sm" onClick={retry}>Retry</button></div>}

      {loading && !data ? <div className="skeleton-table" aria-label="Loading service operations"><span /><span /><span /><span /></div>
        : error && !data ? (
          <div className="error-msg" role="alert">
            <p>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={retry}>Retry</button>
          </div>
        ) : data.total_activities === 0 ? (
          <div className="card so-empty">
            <h2>No service activity in this period</h2>
            <p>Nothing has been logged for the selected dates. Try a longer period, or check that teams and customers have Service Activity Tracking turned on.</p>
          </div>
        ) : (
          <div className={loading ? 'so-body is-refreshing' : 'so-body'}>
            <HoursHero hours={data.total_hours} mix={mix}
              context={`${plural(data.total_activities, 'activity', 'activities')} for ${plural(data.customers_supported, 'customer', 'customers')}, by ${plural(data.byEngineer.length, 'engineer', 'engineers')}.`} />

            <div className="so-grid">
              <Ranking title="Hours by customer" rows={data.byCustomer || []} valueKey="hours" format={fmtHours} />
              <Ranking title="Hours by engineer" rows={data.byEngineer || []} valueKey="hours" format={fmtHours} />
              <Ranking title="Hours by category" rows={data.byCategory || []} valueKey="hours" format={fmtHours}
                detail={r => plural(r.count, 'activity', 'activities')} />
              <Ranking title="Hours by team" rows={data.byTeam || []} valueKey="hours" format={fmtHours} />
              <Ranking title="Activities by technology" note="Activities can carry more than one technology"
                rows={data.byTechnology || []} valueKey="count" format={n => String(n)} />

              <section className="card so-types" aria-labelledby="so-types-title">
                <h2 id="so-types-title">Common work types</h2>
                <dl>
                  {WORK_TYPES.map(t => (
                    <div key={t.label}>
                      <dt>{t.label}</dt>
                      <dd>{countFor(t.names)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          </div>
        )}
    </div>
  );
}
