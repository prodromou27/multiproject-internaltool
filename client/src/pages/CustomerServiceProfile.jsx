import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ClipboardList, Ticket, Clock, ExternalLink, Settings2, Mail, Phone, MapPin, Layers } from 'lucide-react';
import { api } from '../api';
import { StatusBadge, fmtDate } from '../components/Shared';
import CustomerOverview from '../components/CustomerOverview';
import CustomerRecommendations from '../components/CustomerRecommendations';
import CustomerAssets from '../components/CustomerAssets';
import ManagedCustomerConfiguration from '../components/ManagedCustomerConfiguration';
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

/* One at-a-glance card in the health strip. `state` drives the accent color,
   matching ContractMeter's own success/warning/danger convention. */
function HealthCard({ icon: Icon, label, value, note, state = 'default', onClick, href }) {
  const body = <>
    <div className="cs-health-head"><Icon size={14} aria-hidden="true" /><span>{label}</span></div>
    <div className="cs-health-value">{value}</div>
    {note && <div className="cs-health-note">{note}</div>}
  </>;
  const className = `card cs-health-card${state !== 'default' ? ` is-${state}` : ''}${onClick || href ? ' is-actionable' : ''}`;
  if (href) return <Link to={href} className={className}>{body}</Link>;
  if (onClick) return <button type="button" className={className} onClick={onClick}>{body}</button>;
  return <section className={className}>{body}</section>;
}

/* Visible on every tab (not just Overview) so a manager sees customer health
   without an extra click, and so it can link across to the separate Managed
   Customers dashboard (/managed-customers/:id) — a different page covering
   tickets/reporting for the same customer that nothing else here points to. */
function CustomerHealthStrip({ customerId, contractHours, recommendations, managed, onSelectTab }) {
  const cards = [];

  if (contractHours?.enabled) {
    const over = contractHours.remaining_hours < 0;
    const low = !over && contractHours.remaining_hours < contractHours.included_hours * 0.2;
    cards.push(
      <HealthCard key="hours" icon={Clock} label="Contract hours" state={over ? 'danger' : low ? 'warning' : 'default'}
        value={`${fmtHours(contractHours.consumed_hours)} / ${fmtHours(contractHours.included_hours)}`}
        note={over ? `${fmtHours(-contractHours.remaining_hours)} over` : `${fmtHours(contractHours.remaining_hours)} left`}
        onClick={() => onSelectTab('activities')} />
    );
  }

  if (recommendations !== null) {
    cards.push(
      <HealthCard key="recs" icon={ClipboardList} label="Open recommendations" value={recommendations}
        state={recommendations > 0 ? 'warning' : 'default'} onClick={() => onSelectTab('recommendations')} />
    );
  }

  if (managed) {
    if (managed.ticketing) {
      cards.push(
        <HealthCard key="tickets" icon={Ticket} label="Open tickets" value={managed.open_tickets}
          state={managed.sla_breached > 0 ? 'danger' : managed.open_tickets > 0 ? 'warning' : 'default'}
          note={managed.sla_breached > 0 ? `${managed.sla_breached} SLA breach${managed.sla_breached === 1 ? '' : 'es'}` : 'No SLA breaches'}
          href={`/managed-customers/${customerId}`} />
      );
    } else if (managed.enabled) {
      cards.push(
        <HealthCard key="managed" icon={ExternalLink} label="Managed Services" value="Enrolled"
          note="Open the ticket and reporting dashboard" href={`/managed-customers/${customerId}`} />
      );
    } else {
      cards.push(
        <HealthCard key="not-managed" icon={Settings2} label="Managed Services" value="Not enrolled"
          note="Enable it to track tickets and reports" onClick={() => onSelectTab('managed-services')} />
      );
    }
  }

  if (!cards.length) return null;
  return <div className="cs-health-strip">{cards}</div>;
}

const initialsOf = name => (name || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

/* The account's identity, held constant while the section below it changes —
   the one thing on this page that stays visually distinct from the metric
   and list cards around it, the same way the signed-in user's own avatar is
   the one fixed point in the top bar. */
function IdentityPanel({ customer, assetCount }) {
  const contact = customer.contact_name || customer.primary_contact;
  const details = [
    customer.contact_email && { icon: Mail, text: customer.contact_email },
    customer.contact_phone && { icon: Phone, text: customer.contact_phone },
    (customer.address || customer.location) && { icon: MapPin, text: customer.address || customer.location },
  ].filter(Boolean);

  return (
    <aside className="cs-identity">
      <div className="cs-identity-avatar" aria-hidden="true">{initialsOf(customer.name)}</div>
      <h1 className="cs-identity-name">{customer.name}</h1>
      <p className="cs-identity-contract">
        {customer.contract_type || 'No contract type recorded'}
        {customer.contract_end_date && <span> · renews {fmtDate(customer.contract_end_date)}</span>}
      </p>

      {contact && <div className="cs-identity-contact-name">{contact}</div>}
      {details.length > 0 && (
        <ul className="cs-identity-details">
          {details.map(({ icon: Icon, text }) => <li key={text}><Icon size={13} aria-hidden="true" /><span>{text}</span></li>)}
        </ul>
      )}

      {assetCount != null && (
        <div className="cs-identity-facts">
          <div><Layers size={13} aria-hidden="true" /><span>{assetCount} asset{assetCount === 1 ? '' : 's'} on record</span></div>
        </div>
      )}
    </aside>
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
    if (requested==='managed-services' && user.role==='manager') return requested;
    return user.role==='manager' ? 'overview' : 'activities';
  });
  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section');
    if (section==='overview' && user.role==='manager') setTab(section);
    else if (section==='recommendations' && recommendationAccess) setTab(section);
    else if (section==='assets' && user.role==='manager') setTab(section);
    else if (section==='managed-services' && user.role==='manager') setTab(section);
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

  // Health strip data — loaded once per customer (not per tab), independent of
  // which tab is active, since the strip itself is visible on all of them.
  const [openRecommendations, setOpenRecommendations] = useState(null);
  const [managedStatus, setManagedStatus] = useState(null);
  const [assetCount, setAssetCount] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setOpenRecommendations(null); setManagedStatus(null); setAssetCount(null);
    if (user.role === 'manager') {
      api.customerAssets(id, { page: 1 }, options)
        .then(result => { if (!controller.signal.aborted) setAssetCount(result.total); })
        .catch(() => {});
    }
    if (recommendationAccess) {
      api.customerRecommendations(id, { status: 'open', page: 1 }, options)
        .then(result => { if (!controller.signal.aborted) setOpenRecommendations(result.total); })
        .catch(() => {}); // the strip card is a bonus, not core — a failure here shouldn't block the page
    }
    if (user.role === 'manager') {
      api.managedCustomerConfiguration(id, options).then(config => {
        if (controller.signal.aborted) return;
        if (!config.managed_services_enabled) { setManagedStatus({ enabled: false }); return; }
        if (!config.ticket_integration_enabled) { setManagedStatus({ enabled: true, ticketing: false }); return; }
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
        api.managedCustomerOverview(id, { from: monthStart, to: monthEnd }, options).then(overview => {
          if (controller.signal.aborted) return;
          setManagedStatus({ enabled: true, ticketing: true, open_tickets: overview.tickets.open_now, sla_breached: overview.tickets.sla_breached_open });
        }).catch(() => {});
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [id, user.role, recommendationAccess]);

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

  const sections = [
    user.role === 'manager' && ['overview', 'Overview'],
    ['activities', 'Service activities'],
    recommendationAccess && ['recommendations', 'Recommendations'],
    user.role === 'manager' && ['assets', 'Assets'],
    user.role === 'manager' && ['managed-services', 'Managed Services'],
  ].filter(Boolean);

  return (
    <div className="page cs-page">
      <Link to="/customers" className="cs-back">
        <ArrowLeft size={12} /> Back to Customers
      </Link>
      <div className="cs-shell">
        <IdentityPanel customer={customer} assetCount={assetCount} />

        <div className="cs-main">
          <CustomerHealthStrip customerId={customer.id} contractHours={contractHours} recommendations={openRecommendations}
            managed={managedStatus} onSelectTab={setTab} />

          <div className="tabs" role="tablist" aria-label="Customer 360 sections">
            {sections.map(([key, label]) => (
              <button key={key} type="button" className={`tab${tab === key ? ' active' : ''}`} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>

      {tab === 'overview' ? <CustomerOverview key={customer.id} customer={customer} /> : tab === 'managed-services' && user.role === 'manager' ? <ManagedCustomerConfiguration key={customer.id} customerId={customer.id} /> : tab === 'assets' && user.role === 'manager' ? <CustomerAssets key={customer.id} customerId={customer.id} /> : tab === 'recommendations' ? <CustomerRecommendations key={customer.id} customerId={customer.id} sourceVisitId={sourceVisitId} onSourceConsumed={() => {
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
      </div>
    </div>
  );
}
