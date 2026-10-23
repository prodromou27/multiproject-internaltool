import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../components/Shared';
import { PageHeader } from '../components/PageLayout';
import { LoadError } from '../components/LoadError';
import { Surface, ToneBadge } from '../components/EnterpriseUI';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useLiveVersion } from '../live';
import { SEVERITY_TONE, STATUS_TONE, caseAttention } from '../components/VendorCases';

/* Renewals & cases: across the customers a person may open, what expires soon
   (licences, subscriptions, certificates, contracts, device support and warranty)
   or expired in the last 30 days, and the vendor cases still open, with what needs
   a follow-up first. Each row leads to the customer's tab. Server: routes/renewals.js. */

const TYPES = { licence: 'Licence', subscription: 'Subscription', certificate: 'Certificate', contract: 'Contract', support: 'Device support', warranty: 'Device warranty' };
const SEVERITIES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const STATUSES = { open: 'Open', waiting_vendor: 'Waiting for vendor', waiting_us: 'Waiting for us' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function when(item) {
  if (item.days_left < 0) return { tone: 'danger', text: `Expired ${plural(-item.days_left, 'day', 'days')} ago` };
  if (item.days_left === 0) return { tone: 'danger', text: 'Today' };
  return { tone: item.days_left <= 30 ? 'warning' : 'neutral', text: `In ${plural(item.days_left, 'day', 'days')}` };
}
const customerLink = (item, section, extra = '') => `/customers/${item.customer_id}/service-profile?section=${section}${extra}`;

export default function Renewals() {
  const live = useLiveVersion();
  const [days, setDays] = useSavedFilter('renewals.days', '90', { param: 'days', allowed: ['30', '60', '90', '180'] });
  const [data, setData] = useState(null), [error, setError] = useState(null);
  const load = useCallback(() => api.renewals(days).then(result => { setData({ days: Number(days), expiring: [], vendor_cases: [], ...(result && !Array.isArray(result) ? result : {}) }); setError(null); }).catch(setError), [days]);
  useEffect(() => { load(); }, [load, live]);

  if (error && !data) return <div className="page"><PageHeader title="Renewals & cases" /><LoadError what="Renewals" error={error} onRetry={load} /></div>;
  return <div className="page">
    <PageHeader title="Renewals & cases" />
    <Surface title="Expiring" label="Expiring"
      description="Licences, subscriptions, certificates, contracts and device support or warranty, soonest first, with those that expired in the last 30 days."
      actions={<label className="flex gap-8 text-sm" style={{ alignItems: 'center' }}>Next
        <select value={days} onChange={event => setDays(event.target.value)} aria-label="How far ahead">{['30', '60', '90', '180'].map(d => <option key={d} value={d}>{d} days</option>)}</select></label>}>
      {!data ? <p className="text-muted" role="status">Loading…</p>
        : !data.expiring.length ? <p className="text-muted">Nothing expires in the next {data.days} days.</p>
        : <div className="table-wrap"><table>
          <caption className="sr-only">What expires</caption>
          <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Customer</th><th scope="col">Type</th></tr></thead>
          <tbody>{data.expiring.map(item => { const w = when(item); return <tr key={`${item.type}:${item.id}`}>
            <td>{fmtDate(item.date)}<div><ToneBadge tone={item.not_renewing ? 'neutral' : w.tone}>{item.not_renewing ? 'Not renewing' : w.text}</ToneBadge></div></td>
            <td><Link to={customerLink(item, item.section)}>{item.name}</Link>{item.detail && <div className="text-sm text-muted">{item.detail}</div>}</td>
            <td>{item.customer_name}</td>
            <td>{TYPES[item.type] || item.type}</td>
          </tr>; })}</tbody>
        </table></div>}
    </Surface>
    <Surface title="Open vendor cases" label="Open vendor cases" description="Cases with a follow-up due or no update for a week come first.">
      {!data ? <p className="text-muted" role="status">Loading…</p>
        : !data.vendor_cases.length ? <p className="text-muted">No open vendor cases.</p>
        : <div className="table-wrap"><table>
          <caption className="sr-only">Open vendor cases</caption>
          <thead><tr><th scope="col">Case</th><th scope="col">Customer</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Next</th></tr></thead>
          <tbody>{data.vendor_cases.map(c => { const next = caseAttention(c); return <tr key={c.id}>
            <td><Link to={customerLink(c, 'vendor-cases', `&case=${c.id}`)}>{c.vendor} {c.case_number}</Link><div className="text-sm">{c.subject}</div></td>
            <td>{c.customer_name}</td>
            <td><ToneBadge tone={SEVERITY_TONE[c.severity]}>{SEVERITIES[c.severity]}</ToneBadge></td>
            <td><ToneBadge tone={STATUS_TONE[c.status]}>{STATUSES[c.status]}</ToneBadge></td>
            <td>{c.owner_name || <span className="text-muted">No owner</span>}</td>
            <td>{next ? <ToneBadge tone={next.tone}>{next.text}</ToneBadge> : <span className="text-muted">—</span>}</td>
          </tr>; })}</tbody>
        </table></div>}
    </Surface>
  </div>;
}
