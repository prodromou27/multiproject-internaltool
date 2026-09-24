import { useEffect, useState, useRef, useCallback } from 'react';
import '../components/billingMix.css';
import './ActivityForm.css';
import { ClipboardList, Search, Copy, CheckCircle2, ListPlus, Pencil, Flag, SlidersHorizontal, X } from 'lucide-react';
import { fmtDuration, MIX, mixOf, groupByDay, LedgerDay } from '../components/activityLedger';
import { PageHeader } from '../components/PageLayout';
import { useSearchParams } from 'react-router-dom';
import { customerIdFromCreateIntent, useCreateIntent } from '../hooks/useCreateIntent';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, fmtDate, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { todayRange, weekRange, monthRange, RANGE_LABEL, BILLABLE_LABELS } from './activityLog/helpers';
import { ActivityForm } from './activityLog/ActivityForm';
import { ActivityDetailModal } from './activityLog/ActivityDetailModal';

/* ── Main page ────────────────────────────────────────────────────────── */
export default function ActivityLog() {
  const { user, saAccess } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isManager = user.role === 'manager';

  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const listRequest = useRef(null);
  const exportFilters = useRef({});
  const [exporting, setExporting] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [datePreset, setDatePreset] = useSavedFilter('activity_log_date_preset', 'this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [technologyFilter, setTechnologyFilter] = useState('');
  const [billableFilter, setBillableFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [createInitial,setCreateInitial]=useState(null);
  const [editActivity, setEditActivity] = useState(null);
  const [editLoadingId, setEditLoadingId] = useState(null);
  const editRequest = useRef(null);
  const [viewId, setViewId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const activity = searchParams.get('activity');
    if (!meta || activity === null) return;
    if (/^[1-9]\d*$/.test(activity) && Number.isSafeInteger(Number(activity))) setViewId(Number(activity));
    const next = new URLSearchParams(searchParams);
    next.delete('activity');
    setSearchParams(next, { replace: true });
  }, [meta, searchParams, setSearchParams]);

  useCreateIntent({ allowed: isManager || (saAccess.enabled && ['engineer', 'pm'].includes(user.role)), ready: !!meta, onCreate: params => { const customerId=customerIdFromCreateIntent(params);setCreateInitial(customerId?{ customer_id:customerId }:null);setShowForm(true); } });

  useEffect(() => () => editRequest.current?.abort(), []);

  async function handleEdit(row) {
    editRequest.current?.abort();
    const controller = new AbortController();
    editRequest.current = controller;
    setEditLoadingId(row.id);
    try {
      const detail = await api.serviceActivity(row.id, { signal: controller.signal });
      if (!controller.signal.aborted) setEditActivity(detail);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error.message || 'Could not load the activity for editing');
    } finally {
      if (!controller.signal.aborted) setEditLoadingId(null);
    }
  }

  useEffect(() => {
    api.serviceActivityMeta().then(setMeta).catch(e => setMetaError(e.message || 'Failed to load form data'));
  }, []);

  const load = useCallback(() => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setLoadError('');
    const [from, to] = datePreset === 'today' ? todayRange()
      : datePreset === 'this_week' ? weekRange()
      : datePreset === 'this_month' ? monthRange()
      : datePreset === 'custom' ? [customFrom, customTo] : [null, null];
    const params = { page, page_size: pageSize };
    if (from) params.from = from;
    if (to) params.to = to;
    if (customerFilter) params.customer_id = customerFilter;
    if (categoryFilter) params.category_id = categoryFilter;
    if (statusFilter) params.status = statusFilter;
    if (technologyFilter) params.technology_id = technologyFilter;
    if (billableFilter) params.billable_classification = billableFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    exportFilters.current = { ...params };
    delete exportFilters.current.page;
    delete exportFilters.current.page_size;
    return api.serviceActivities(params, { signal: controller.signal }).then(d => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(d.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows(d.rows);
      setTotal(d.total);
    }).catch(e => {
      if (!controller.signal.aborted) setLoadError(e.message || 'Failed to load activities');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [page, datePreset, customFrom, customTo, customerFilter, categoryFilter, statusFilter, technologyFilter, billableFilter, debouncedSearch]);

  useEffect(() => {
    load();
    return () => listRequest.current?.abort();
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setDebouncedSearch(search.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleCreate(payload) {
    await api.createServiceActivity(payload);
    setShowForm(false);
    setCreateInitial(null);
    toast.success('Activity logged');
    load();
  }

  async function handleUpdate(payload) {
    await api.updateServiceActivity(editActivity.id, { ...payload, version: editActivity.version });
    setEditActivity(null);
    toast.success('Activity updated');
    load();
  }

  async function handleComplete(row) {
    try { await api.completeServiceActivity(row.id); toast.success('Marked as completed'); load(); }
    catch (e) { toast.error(e.message); }
  }

  async function handleDuplicate(row) {
    try {
      const { activity_reference } = await api.duplicateServiceActivity(row.id);
      toast.success(`Duplicated as ${activity_reference}`);
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function handleFollowUp(row) {
    const ok = await confirm(`Create a follow-up task for "${row.title}"?`, { title: 'Create Follow-Up Task' });
    if (!ok) return;
    try { const result = await api.createFollowUpTask(row.id); toast.success(result.created ? 'Follow-up task created' : 'Follow-up task already exists'); load(); }
    catch (e) { toast.error(e.message); }
  }

  if (saAccess.loaded && !saAccess.enabled && !isManager) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon"><ClipboardList size={40} strokeWidth={1.2} /></div>
          <p className="font-semibold">Service Activity Tracking is not enabled for your team</p>
          <p style={{ fontSize: 13 }}>Ask your manager to enable it for your team if you need access to the Activity Log.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filterDefs = meta ? [
    { key: 'customer', label: 'Customer', value: customerFilter, set: setCustomerFilter, options: meta.customers.map(c => [c.id, c.name]) },
    { key: 'category', label: 'Category', value: categoryFilter, set: setCategoryFilter, options: meta.categories.map(c => [c.id, c.name]) },
    { key: 'status', label: 'Status', value: statusFilter, set: setStatusFilter, options: meta.statuses.map(s => [s.value, s.label]) },
    { key: 'technology', label: 'Technology', value: technologyFilter, set: setTechnologyFilter, options: meta.technologies.map(t => [t.id, t.name]) },
    { key: 'billing', label: 'Billing', value: billableFilter, set: setBillableFilter, options: Object.entries(BILLABLE_LABELS) },
  ] : [];
  const activeFilters = filterDefs.filter(f => f.value !== '');
  const hasNarrowing = activeFilters.length > 0 || debouncedSearch !== '';
  const groups = groupByDay(rows, page, totalPages);
  const showLegend = rows.some(row => row.duration_minutes > 0);

  function clearFilters() {
    filterDefs.forEach(f => f.set(''));
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
  }

  const completedValue = meta?.statuses?.find(s => s.is_terminal && /complet/i.test(s.value))?.value || 'completed';
  const canFollowUp = ['manager', 'engineer'].includes(user.role) && meta?.settings?.allow_follow_up_task_creation !== false;

  return (
    <div className="page activity-log">
      <PageHeader eyebrow="Operations" title="Activity log" description="Record customer service work, supporting evidence and operational follow-ups." actions={<>
        <button className="btn btn-ghost" disabled={loading || !!loadError || exporting || !meta} onClick={async () => {
          setExporting(true);
          try { await api.exportServiceActivities(exportFilters.current); }
          catch (error) { toast.error(error.message); }
          finally { setExporting(false); }
        }}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!meta}>Log activity</button>
      </>} />

      {metaError && <div className="error-msg mb-12">{metaError}</div>}

      <div className="al-toolbar">
        <div className="al-segment" role="group" aria-label="Date range">
          {[['today', 'Today'], ['this_week', 'This week'], ['this_month', 'This month'], ['custom', 'Custom']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={datePreset === k} onClick={() => { setDatePreset(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <div className="al-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search activities" placeholder="Search title, notes, reference or ticket" />
        </div>
        {meta && (
          <details className="al-filters">
            <summary>
              <SlidersHorizontal size={15} aria-hidden="true" /> Filters
              {activeFilters.length > 0 && <span className="al-filter-count" aria-label={`${activeFilters.length} active`}>{activeFilters.length}</span>}
            </summary>
            <div className="al-filter-panel">
              {filterDefs.map(f => (
                <div key={f.key}>
                  <label htmlFor={`al-filter-${f.key}`}>{f.label}</label>
                  <select id={`al-filter-${f.key}`} value={f.value} onChange={e => { f.set(e.target.value); setPage(1); }}>
                    <option value="">All</option>
                    {f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {datePreset === 'custom' && (
        <div className="form-row" style={{ marginBottom: 12, maxWidth: 520 }}>
          <div className="form-group"><label htmlFor="al-from">From</label><input id="al-from" type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} /></div>
          <div className="form-group"><label htmlFor="al-to">To</label><input id="al-to" type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); }} /></div>
        </div>
      )}

      {hasNarrowing && (
        <div className="al-chips">
          {activeFilters.map(f => (
            <span className="al-chip" key={f.key}>
              {f.label}: {f.options.find(([value]) => String(value) === String(f.value))?.[1] ?? f.value}
              <button type="button" aria-label={`Remove ${f.label} filter`} onClick={() => { f.set(''); setPage(1); }}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
          {debouncedSearch && (
            <span className="al-chip">
              Search: {debouncedSearch}
              <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }}><X size={12} aria-hidden="true" /></button>
            </span>
          )}
          <button type="button" className="al-clear" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      {loading ? <div className="skeleton-table" aria-label="Loading activities"><span /><span /><span /><span /></div> : loadError ? (
        <div className="error-msg" role="alert">
          <p>{loadError}</p>
          <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card al-empty">
          <h2>{hasNarrowing ? 'No activities match these filters' : `Nothing logged ${RANGE_LABEL[datePreset] || 'in this range'} yet`}</h2>
          <p>{hasNarrowing
            ? 'Try removing a filter or widening the date range.'
            : 'Log the work you have done for a customer and it will show up here, grouped by day.'}</p>
          {hasNarrowing
            ? <button className="btn btn-ghost" onClick={clearFilters}>Clear filters</button>
            : <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!meta}>Log activity</button>}
        </div>
      ) : (
        <>
          {showLegend && (
            <ul className="al-legend" aria-label="Billing colours">
              {[['included_in_contract'], ['billable'], ['internal'], ['non_billable']].map(([key]) => (
                <li key={key}><span className="al-swatch" style={{ background: MIX[key].color }} aria-hidden="true" />{MIX[key].label}</li>
              ))}
            </ul>
          )}
          <div className="card al-ledger">
            {groups.map(group => (
              <LedgerDay key={group.date} group={group}>
                {group.rows.map(r => {
                        const mix = mixOf(r.billable_classification);
                        return (
                          <li className="al-entry" key={r.id}>
                            <span className={'al-duration' + (r.duration_minutes ? '' : ' is-unset')}>{r.duration_minutes ? fmtDuration(r.duration_minutes) : 'No time'}</span>
                            <div className="al-main">
                              <button type="button" className="al-title" onClick={() => setViewId(r.id)}>{r.title}</button>
                              <div className="al-meta">
                                <span className="al-customer">{r.customer_name}</span>
                                <span>{r.category_name}</span>
                                {r.billable_classification && (
                                  <span className="al-mix"><span className="al-swatch" style={{ background: mix.color }} aria-hidden="true" />{mix.label}</span>
                                )}
                                <span className="al-ref">{r.activity_reference}</span>
                                {r.follow_up_required ? (
                                  <span className="al-followup"><Flag size={12} aria-hidden="true" />Follow-up{r.follow_up_date ? ` ${fmtDate(r.follow_up_date)}` : ''}</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="al-side">
                              <StatusBadge entityType="service_activity" s={r.status} />
                              <div className="al-actions">
                                <button type="button" aria-label={`Edit ${r.title}`} title="Edit" disabled={!meta || editLoadingId === r.id} onClick={() => handleEdit(r)}><Pencil size={15} aria-hidden="true" /></button>
                                <button type="button" aria-label={`Duplicate ${r.title}`} title="Duplicate" onClick={() => handleDuplicate(r)}><Copy size={15} aria-hidden="true" /></button>
                                {r.status !== completedValue
                                  ? <button type="button" aria-label={`Mark ${r.title} complete`} title="Mark complete" onClick={() => handleComplete(r)}><CheckCircle2 size={15} aria-hidden="true" /></button>
                                  : <span className="al-action-gap" aria-hidden="true" />}
                                {canFollowUp && (
                                  <button type="button" aria-label={`Create follow-up task for ${r.title}`} title="Create follow-up task" onClick={() => handleFollowUp(r)}><ListPlus size={15} aria-hidden="true" /></button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
              </LedgerDay>
            ))}
            <div className="al-pager">
              <span>{total} {total === 1 ? 'activity' : 'activities'}</span>
              <div className="al-pager-nav">
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span>Page {page} of {totalPages}</span>
                <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          </div>
        </>
      )}

      {showForm && meta && (
        <Modal title="Log activity" onClose={() => { setShowForm(false);setCreateInitial(null); }}>
          <ActivityForm meta={meta} initial={createInitial} onSave={handleCreate} onClose={() => { setShowForm(false);setCreateInitial(null); }} />
        </Modal>
      )}

      {editActivity && meta && (
        <Modal title={`Edit ${editActivity.activity_reference || ''}`} onClose={() => setEditActivity(null)}>
          <ActivityForm key={`${editActivity.id}-${editActivity.version}`} meta={meta} initial={editActivity} onReload={async () => {
            if (await confirm('Reloading replaces your unsaved draft with the latest activity.', { title: 'Reload Activity', label: 'Reload', danger: false })) await handleEdit(editActivity);
          }} onSave={handleUpdate} onClose={() => setEditActivity(null)} />
        </Modal>
      )}

      {viewId && (
        <ActivityDetailModal id={viewId} allowAttachments={meta?.settings?.allow_attachments}
          onClose={() => { setViewId(null); load(); }} />
      )}
    </div>
  );
}
