import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup,ListSearch,ResultContext } from '../components/ListWorkspace';
import { DataTable,MetricStrip,Pagination,Surface,ToneBadge } from '../components/EnterpriseUI';
import { fmtDate } from '../components/Shared';
import { useLatestRequest } from '../hooks/useLatestRequest';

const ROLE_LABELS={ manager:'Manager',engineer:'Engineer',planner:'Planner',pm:'Project Manager' };
const ROLE_TONES={ manager:'danger',engineer:'info',planner:'warning',pm:'success' };
const PAGE_SIZE=25;

export default function Users() {
  const [users,setUsers]=useState([]);
  const [total,setTotal]=useState(0);
  const [counts,setCounts]=useState({ all:0,manager:0,engineer:0,planner:0,pm:0 });
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [role,setRole]=useState('all');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const { begin,isCurrent }=useLatestRequest('team-directory');

  const load=useCallback(() => {
    const request=begin();
    if (request.signal.aborted) return Promise.resolve();
    setLoading(true);setError('');
    return api.pagedUsers({ page,page_size:PAGE_SIZE,search,role },{ signal:request.signal }).then(result => {
      if (!isCurrent(request)) return;
      setUsers(result.rows || []);setTotal(Number(result.total) || 0);setCounts(result.counts || {});
    }).catch(failure => { if (isCurrent(request)) setError(failure.message || 'Could not load the team directory'); })
      .finally(() => { if (isCurrent(request)) setLoading(false); });
  },[begin,isCurrent,page,role,search]);

  useEffect(() => { const timer=setTimeout(load,250);return () => clearTimeout(timer); },[load]);
  useEffect(() => setPage(1),[search,role]);

  const columns=[
    { key:'name',label:'Name',render:user => <strong>{user.name}</strong> },
    { key:'email',label:'Email',render:user => user.email
      ? <a href={`mailto:${user.email}`} className="team-email">{user.email}</a> : <span className="text-muted">—</span> },
    { key:'role',label:'Role',render:user => <ToneBadge tone={ROLE_TONES[user.role] || 'neutral'}>{ROLE_LABELS[user.role] || user.role}</ToneBadge> },
    { key:'status',label:'Status',render:user => <ToneBadge tone={user.active?'success':'neutral'}>{user.active?'Active':'Inactive'}</ToneBadge> },
    { key:'joined',label:'Joined',render:user => fmtDate(user.created_at) },
    { key:'last_login',label:'Last login',render:user => user.last_login ? fmtDate(user.last_login) : 'Never' },
  ];

  return <div className="page">
    <PageHeader eyebrow="Administration" title="Team directory"
      description="Find active and historical accounts without loading the entire organization into the browser." />
    <MetricStrip items={[
      { key:'all',label:'All accounts',value:counts.all || 0,note:'Matching the current search',tone:'info' },
      { key:'engineers',label:'Engineers',value:counts.engineer || 0,note:'Operational delivery users' },
      { key:'management',label:'Management',value:(counts.manager || 0)+(counts.planner || 0)+(counts.pm || 0),note:'Managers, planners and PMs' },
      { key:'shown',label:'This page',value:users.length,note:`Page ${page}`,tone:'success' },
    ]} />
    <Surface title="Directory filters" description="Search names, email addresses, or roles.">
      <ListSearch value={search} onChange={setSearch} label="Search team directory" placeholder="Search by name, email, or role…" maxLength={200} />
      <FilterGroup label="Role">
        {[
          ['all','All'],['manager','Managers'],['planner','Planners'],['pm','Project managers'],['engineer','Engineers'],
        ].map(([value,label]) => <button key={value} type="button" className={`filter-pill${role===value?' active':''}`} onClick={() => setRole(value)}>
          {label} <span>({counts[value] || 0})</span>
        </button>)}
      </FilterGroup>
    </Surface>
    {!loading && !error && <ResultContext shown={users.length} total={total} noun="team members"
      activeFilters={(search.trim()?1:0)+(role!=='all'?1:0)} onClear={() => { setSearch('');setRole('all'); }} />}
    <DataTable columns={columns} rows={users} loading={loading} error={error} onRetry={load}
      caption="Team accounts matching the selected filters"
      empty={search.trim()?'No team members match this search.':'No team members match this role.'}
      emptyAction={(search.trim() || role!=='all')
        ? <button className="btn btn-ghost btn-sm" onClick={() => { setSearch('');setRole('all'); }}>Reset filters</button> : null} />
    {!error && <Pagination page={page} total={total} pageSize={PAGE_SIZE} loading={loading} onPageChange={setPage}
      label="Team directory pages" summary={total ? `${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,total)} of ${total} accounts` : undefined} />}
  </div>;
}
