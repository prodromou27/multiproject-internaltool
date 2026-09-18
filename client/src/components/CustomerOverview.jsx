import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { fmtDate, StatusBadge } from './Shared';

export default function CustomerOverview({ customer }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadedScope, setLoadedScope] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const scope = `${customer.id}:${page}`;
  const { begin, isCurrent } = useLatestRequest(scope);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.customerOverview(customer.id, { page }, { signal: request.signal }).then(result => {
      if (isCurrent(request)) { setData(result); setLoadedScope(scope); }
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); })
      .finally(() => { if (isCurrent(request)) setLoading(false); });
  }, [customer.id, page, scope, begin, isCurrent]);
  useEffect(() => { load(); }, [load]);
  if (error) return <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div>;
  if (loading || loadedScope !== scope) return <p role="status">Loading customer history...</p>;
  const sections = [
    ['projects', 'Projects', row => <><Link to={`/projects/${row.id}`}>{row.title}</Link><StatusBadge entityType="project" s={row.status} /><span>{fmtDate(row.deadline)}</span></>],
    ['tasks', 'Tasks linked through projects', row => <><Link to={`/projects/${row.project_id}`}>{row.title}</Link><StatusBadge entityType="task" s={row.status} /><span>{row.assignee || 'Unassigned'} · {fmtDate(row.deadline)}</span></>],
    ['visits', 'Maintenance visits', row => <><span>{row.title}</span><span>{row.status.replaceAll('_', ' ')} · {fmtDate(row.scheduled_date)}</span><span>{row.report_sent_to_customer ? 'Report forwarded' : row.report_sent ? 'Awaiting review' : 'Report not submitted'}</span></>],
    ['documents', 'Project documents', row => <><Link to={`/projects/${row.project_id}`}>{row.original_name}</Link><span>{row.project_title}</span><span>{fmtDate(row.created_at)}</span></>],
  ];
  return <>
    <section className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 18 }}>Contacts and service profile</h2>
      <p>{customer.contact_name || customer.primary_contact || 'No contact recorded'}</p>
      <p>{[customer.contact_email, customer.contact_phone, customer.address || customer.location].filter(Boolean).join(' · ')}</p>
      <p className="text-muted">{customer.contract_type || 'No contract type recorded'}{customer.contract_end_date ? ` · Contract ends ${fmtDate(customer.contract_end_date)}` : ''}</p>
    </section>
    <div className="grid-2" style={{ gap: 20, marginBottom: 20 }}>
      {sections.map(([key, title, render]) => <section className="card" key={key}>
        <h2 style={{ fontSize: 16 }}>{title} ({data.counts[key]})</h2>
        <p className="text-muted text-sm">Latest {data[key].length} of {data.counts[key]}. {key === 'tasks' && 'Ad-hoc tasks have no customer relationship and are excluded.'}</p>
        {data[key].length === 0 ? <p className="text-muted">No records</p> : data[key].map(row => <div key={row.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>{render(row)}</div>)}
        {key === 'visits' && <Link to="/maintenance-visits?filter=all">Open maintenance visits</Link>}
      </section>)}
    </div>
    <section className="card">
      <h2 style={{ fontSize: 18 }}>Customer timeline</h2>
      <p className="text-muted text-sm">Recorded creation, project history and current report submission events. Undone report submissions no longer appear here.</p>
      {data.timeline.length === 0 && <p>No recorded events</p>}
      {data.timeline.map(row => <div key={`${row.kind}:${row.entity_id}`} style={{ padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}><span className="text-muted text-sm">{fmtDate(row.event_at)}</span><div><strong>{row.action.replaceAll('_', ' ')}</strong> · {row.title}</div></div>)}
      <div className="flex gap-8" style={{ marginTop: 12 }}>
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page} · {data.total} events</span>
        <button className="btn btn-ghost" disabled={page * data.page_size >= data.total} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>
    </section>
  </>;
}
