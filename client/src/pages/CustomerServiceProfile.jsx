import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import { StatusBadge, fmtDate } from '../components/Shared';
import CustomerOverview from '../components/CustomerOverview';
import CustomerRecommendations from '../components/CustomerRecommendations';
import CustomerAssets from '../components/CustomerAssets';
import { useAuth } from '../App';

function fmtDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`;
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

      {summary && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <div className="card stat"><div className="stat-value">{summary.total_activities}</div><div className="stat-label">Total Activities</div></div>
          <div className="card stat"><div className="stat-value">{summary.total_hours}h</div><div className="stat-label">Total Hours</div></div>
          <div className="card stat"><div className="stat-value">{summary.byEngineer.length}</div><div className="stat-label">Engineers Involved</div></div>
          <div className="card stat"><div className="stat-value">{summary.byCategory.length}</div><div className="stat-label">Categories</div></div>
        </div>
      )}

      {contractHours?.enabled && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-title">Contract Hours ({contractHours.period === 'annual' ? 'Annual' : 'Monthly'})</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="progress-bar" style={{ flex: 1 }}>
              <div className="progress-bar-fill" style={{
                width: `${Math.min(100, (contractHours.consumed_hours / contractHours.included_hours) * 100)}%`,
                background: contractHours.remaining_hours < 0 ? 'var(--danger)' : contractHours.remaining_hours < contractHours.included_hours * 0.2 ? 'var(--warning)' : 'var(--success)',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {contractHours.consumed_hours}h used / {contractHours.included_hours}h included
              {' · '}
              <span style={{ color: contractHours.remaining_hours < 0 ? 'var(--danger)' : 'var(--gray-600)' }}>
                {contractHours.remaining_hours}h remaining
              </span>
            </span>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid-2" style={{ marginBottom: 20, gap: 20 }}>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Activities by Category</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={summary.byCategory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="hours" name="Hours" fill="#0891b2" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Billable vs Contract vs Non-Billable</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={summary.byBillable} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="classification" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="hours" name="Hours" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <div className="form-group"><label>From</label><input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></div>
          <div className="form-group"><label>To</label><input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select value={engineerFilter} onChange={e => { setEngineerFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="">All Engineers</option>
            {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : loading ? <p className="text-muted">Loading…</p> : timeline.length === 0 ? (
        <div className="empty"><div className="empty-icon"><ClipboardList size={40} strokeWidth={1.2} /></div><p>No activities in this range</p></div>
      ) : (
        <div className="card">
          {timeline.map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ width: 90, flexShrink: 0, fontSize: 12, color: 'var(--gray-400)' }}>{fmtDate(t.activity_date)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{t.engineer_name} · {t.category_name}{t.duration_minutes ? ` · ${fmtDuration(t.duration_minutes)}` : ''}</div>
              </div>
              <StatusBadge entityType="task" s={t.status} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{total} activities</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button className="btn btn-ghost btn-sm" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
