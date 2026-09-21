import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { api } from '../api';
import { StatusBadge } from '../components/Shared';
import CustomerOverview from '../components/CustomerOverview';
import CustomerRecommendations from '../components/CustomerRecommendations';
import CustomerAssets from '../components/CustomerAssets';
import { fmtHours, plural, buildMix, HoursHero, Ranking } from '../components/ServiceCharts';
import { fmtDuration, mixOf, groupByDay, LedgerDay } from '../components/activityLedger';
import { useAuth } from '../App';
import './CustomerServiceProfile.css';

/* Contract hours as a meter: one ratio against a limit, with the state spelled out
   in words and an icon so it never relies on colour alone. */
function ContractMeter({ data }) {
  const used = data.consumed_hours, total = data.included_hours;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const over = data.remaining_hours < 0;
  const low = !over && data.remaining_hours < total * 0.2;
  return (
    <section className={`card cs-meter${over ? ' is-over' : low ? ' is-low' : ''}`} aria-label="Contract hours">
      <div className="cs-meter-head">
        <h2>Contract hours {data.period === 'annual' ? 'this year' : 'this month'}</h2>
        <span className="cs-meter-state">
          {(over || low) && <AlertTriangle size={14} aria-hidden="true" />}
          {over ? `${fmtHours(-data.remaining_hours)} over` : `${fmtHours(data.remaining_hours)} left`}
        </span>
      </div>
      <div className="cs-meter-track" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used}
        aria-label={`${fmtHours(used)} of ${fmtHours(total)} contract hours used`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="cs-meter-figures"><strong>{fmtHours(used)}</strong> used of {fmtHours(total)} included</p>
    </section>
  );
}

export default function CustomerServiceProfile() {
  const { user } = useAuth();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const source = query.get('source_visit');
  const sourceVisitId = source && /^[1-9]\d*$/.test(source) && Number.isSafeInteger(Number(source)) ? Number(source) : null;
  const [customer, setCustomer] = useState(null);
  const [engineers, setEngineers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contractHours, setContractHours] = useState(null);
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [retry, setRetry] = useState(0);
  const recommendationAccess=['manager','planner','engineer'].includes(user.role);
  const [tab, setTab] = useState(() => {
    const requested=new URLSearchParams(location.search).get('section');
    if (requested==='recommendations' && recommendationAccess) return requested;
    if (requested==='assets' && user.role==='manager') return requested;
    return user.role==='manager' ? 'overview' : 'activities';
  });
  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section');
    if (section==='overview' && user.role==='manager') setTab(section);
    else if (section==='recommendations' && recommendationAccess) setTab(section);
    else if (section==='assets' && user.role==='manager') setTab(section);
    else if (section==='activities') setTab(section);
  }, [location.search,user.role,recommendationAccess]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setCustomer(null); setProfileError('');
    Promise.all([api.customer(id, options), api.users(options), api.activityCategories(options), api.customerContractHours(id, options)]).then(([c, u, cats, hours]) => {
      if (controller.signal.aborted) return;
      setCustomer(c); setEngineers(u.filter(x => x.role === 'engineer')); setCategories(cats); setContractHours(hours);
    }).catch(failure => { if (!controller.signal.aborted) setProfileError(failure.message); });
    return () => controller.abort();
  }, [id, retry]);

  useEffect(() => {
    const controller = new AbortController();
    const params = { page, page_size: 25 };
    if (from) params.from = from;
    if (to) params.to = to;
    if (engineerFilter) params.engineer_id = engineerFilter;
    if (categoryFilter) params.category_id = categoryFilter;
    if (statusFilter) params.status = statusFilter;
    setLoading(true); setError(''); setSummary(null);
    const options = { signal: controller.signal };
    Promise.all([api.customerServiceActivities(id, params, options), api.customerServiceSummary(id, { from, to }, options)])
      .then(([t, s]) => { if (!controller.signal.aborted) { setTimeline(t.rows); setTotal(t.total); setSummary(s); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, page, from, to, engineerFilter, categoryFilter, statusFilter, retry]);

  if (profileError) return <div className="page"><div className="error-msg" role="alert">{profileError} <button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Retry</button></div></div>;
  if (!customer || customer.id !== Number(id)) return <div className="page"><p className="text-muted">Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/customers" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--gray-400)', marginBottom: 6 }}>
            <ArrowLeft size={12} /> Back to Customers
          </Link>
          <h1 className="page-title">{customer.name} — Customer 360</h1>
        </div>
      </div>
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        {user.role === 'manager' && <button className={`filter-pill${tab === 'overview' ? ' active' : ''}`} aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>Overview and history</button>}
        <button className={`filter-pill${tab === 'activities' ? ' active' : ''}`} aria-pressed={tab === 'activities'} onClick={() => setTab('activities')}>Service activities and hours</button>
        {recommendationAccess && <button className={`filter-pill${tab === 'recommendations' ? ' active' : ''}`} aria-pressed={tab === 'recommendations'} onClick={() => setTab('recommendations')}>Recommendations</button>}
        {user.role === 'manager' && <button className={`filter-pill${tab === 'assets' ? ' active' : ''}`} aria-pressed={tab === 'assets'} onClick={() => setTab('assets')}>Assets</button>}
      </div>
      {tab === 'overview' ? <CustomerOverview key={customer.id} customer={customer} /> : tab === 'assets' && user.role === 'manager' ? <CustomerAssets key={customer.id} customerId={customer.id} /> : tab === 'recommendations' ? <CustomerRecommendations key={customer.id} customerId={customer.id} sourceVisitId={sourceVisitId} onSourceConsumed={() => {
        const params = new URLSearchParams(location.search); params.delete('source_visit');
        navigate(`${location.pathname}?${params.toString()}`, { replace: true });
      }} /> : <>

      <div className="cs-activities activity-log">
        {summary && (
          <HoursHero hours={summary.total_hours} mix={buildMix(summary.byBillable)}
            context={`${plural(summary.total_activities, 'activity', 'activities')} by ${plural(summary.byEngineer.length, 'engineer', 'engineers')}${from || to ? ' in the selected dates' : ''}.`} />
        )}

        {contractHours?.enabled && <ContractMeter data={contractHours} />}

        {summary && summary.total_activities > 0 && (
          <div className="cs-rankings">
            <Ranking title="Hours by category" rows={summary.byCategory || []} valueKey="hours" format={fmtHours}
              detail={r => plural(r.count, 'activity', 'activities')} />
            <Ranking title="Hours by engineer" rows={summary.byEngineer || []} valueKey="hours" format={fmtHours} />
            <Ranking title="Activities by technology" note="Activities can carry more than one technology"
              rows={summary.byTechnology || []} valueKey="count" format={n => String(n)} />
          </div>
        )}

        <div className="cs-toolbar">
          <div><label htmlFor="cs-from">From</label><input id="cs-from" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></div>
          <div><label htmlFor="cs-to">To</label><input id="cs-to" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></div>
          <div><label htmlFor="cs-engineer">Engineer</label>
            <select id="cs-engineer" value={engineerFilter} onChange={e => { setEngineerFilter(e.target.value); setPage(1); }}>
              <option value="">All engineers</option>
              {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="cs-category">Category</label>
            <select id="cs-category" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {(from || to || engineerFilter || categoryFilter) && (
            <button type="button" className="cs-clear" onClick={() => { setFrom(''); setTo(''); setEngineerFilter(''); setCategoryFilter(''); setPage(1); }}>Clear filters</button>
          )}
        </div>

        {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
          : loading ? <div className="skeleton-table" aria-label="Loading activities"><span /><span /><span /></div>
          : timeline.length === 0 ? (
            <div className="card cs-empty">
              <h2>{from || to || engineerFilter || categoryFilter ? 'No activities match these filters' : 'No service activity for this customer yet'}</h2>
              <p>{from || to || engineerFilter || categoryFilter
                ? 'Try removing a filter or widening the dates.'
                : 'Activities logged against this customer will appear here, grouped by day.'}</p>
            </div>
          ) : (
            <div className="card al-ledger">
              {groupByDay(timeline, page, Math.max(1, Math.ceil(total / 25))).map(group => (
                <LedgerDay key={group.date} group={group}>
                  {group.rows.map(t => {
                    const mix = mixOf(t.billable_classification);
                    return (
                      <li className="al-entry" key={t.id}>
                        <span className={'al-duration' + (t.duration_minutes ? '' : ' is-unset')}>{t.duration_minutes ? fmtDuration(t.duration_minutes) : 'No time'}</span>
                        <div className="al-main">
                          {user.role === 'manager'
                            ? <Link className="al-title" to={`/activity-log?activity=${t.id}`}>{t.title}</Link>
                            : <span className="al-title is-static">{t.title}</span>}
                          <div className="al-meta">
                            <span className="al-customer">{t.engineer_name}</span>
                            <span>{t.category_name}</span>
                            {t.billable_classification && <span className="al-mix"><span className="al-swatch" style={{ background: mix.color }} aria-hidden="true" />{mix.label}</span>}
                            <span className="al-ref">{t.activity_reference}</span>
                          </div>
                        </div>
                        <div className="al-side"><StatusBadge entityType="service_activity" s={t.status} /></div>
                      </li>
                    );
                  })}
                </LedgerDay>
              ))}
              <div className="al-pager">
                <span>{total} {total === 1 ? 'activity' : 'activities'}</span>
                <div className="al-pager-nav">
                  <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                  <span>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
                  <button className="btn btn-ghost btn-sm" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              </div>
            </div>
          )}
      </div>
      </>}
    </div>
  );
}
