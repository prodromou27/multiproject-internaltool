import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, X, FolderOpen, CheckSquare, Wrench, Building2, ChevronDown, ChevronUp, Zap, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { parseQuery } from './search/parseQuery';
import { ProjectCard, TaskCard, MVCard, CustomerCard } from './search/ResultCards';
import { EXAMPLES, AdvancedFilters } from './search/AdvancedFilters';

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function SearchPage() {
  const { user } = useAuth();
  const isManager = user.role === 'manager';
  const location  = useLocation();
  const navigate  = useNavigate();
  const inputRef  = useRef(null);
  const searchRequest = useRef(0);

  // Seed query from URL ?q=
  const initQ = new URLSearchParams(location.search).get('q') || '';
  const [query,        setQuery]        = useState(initQ);
  const [chips,        setChips]        = useState([]);
  const [parsedFilters, setParsedFilters] = useState({});
  const [manualFilters, setManualFilters] = useState({ entity: 'all' });
  const [results,      setResults]      = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [activeTab,    setActiveTab]    = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page,          setPage]          = useState(1);
  const [users,        setUsers]        = useState([]);
  const [customers,    setCustomers]    = useState([]);

  // Load users + customers for parser
  useEffect(() => {
    api.users().then(setUsers).catch(() => {});
    if (isManager) api.customers().then(setCustomers).catch(() => {});
  }, []);

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Parse query whenever text, users, or customers change
  useEffect(() => {
    if (!query.trim()) {
      setChips([]);
      setParsedFilters({});
      return;
    }
    const { filters, chips: c } = parseQuery(query, users, customers);
    setChips(c);
    setParsedFilters(filters);
  }, [query, users, customers]);

  useEffect(() => { setPage(1); }, [parsedFilters, manualFilters]);

  // Debounced search — fires on parsed filters + manual filter changes
  const doSearch = useCallback(async (merged) => {
    // Need at least a query or one active filter
    const hasInput = query.trim().length >= 1 || Object.values(merged).some(v => v && v !== 'all');
    if (!hasInput) { searchRequest.current += 1;setResults(null);setLoading(false);return; }

    const request=++searchRequest.current;setLoading(true);
    try {
      const data = await api.smartSearch({ ...merged,page,page_size:25 });
      if (request===searchRequest.current) setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      if (request===searchRequest.current) setLoading(false);
    }
  }, [query,page]);

  useEffect(() => {
    const combined = { ...parsedFilters, ...Object.fromEntries(Object.entries(manualFilters).filter(([, v]) => v && v !== 'all')) };
    const t = setTimeout(() => doSearch(combined), 300);
    return () => clearTimeout(t);
  }, [parsedFilters, manualFilters, page, doSearch]);

  // Remove a chip → clear that filter from manual override
  function removeChip(key) {
    const next = { ...parsedFilters };
    delete next[key];
    setParsedFilters(next);
    // Also clear from manual filters
    setManualFilters(f => {
      const n = { ...f };
      if (key === 'entity')        n.entity = 'all';
      if (key === 'status')        delete n.status;
      if (key === 'overdue')       delete n.overdue;
      if (key === 'priority')      delete n.priority;
      if (key === 'customer_id')   delete n.customer_id;
      if (key === 'engineer_id')   delete n.engineer_id;
      if (key === 'report_status') delete n.report_status;
      if (key === 'my_tasks')      delete n.my_tasks;
      if (key === 'unassigned')    delete n.unassigned;
      return n;
    });
  }

  function clearAll() {
    setQuery('');
    setChips([]);
    setParsedFilters({});
    setManualFilters({ entity: 'all' });
    setResults(null);
    setPage(1);
    inputRef.current?.focus();
  }

  const total     = results ? (results.projects?.length || 0) + (results.tasks?.length || 0) + (results.mv?.length || 0) + (results.customers?.length || 0) : 0;
  const hasQuery  = query.trim().length > 0 || Object.values(manualFilters).some(v => v && v !== 'all');
  const hasNextPage = Object.values(results?.pagination?.has_more || {}).some(Boolean);
  const tabs      = [
    { key: 'all',       label: 'All',       count: total },
    { key: 'projects',  label: 'Projects',  count: results?.projects?.length  || 0, icon: FolderOpen },
    { key: 'tasks',     label: 'Tasks',     count: results?.tasks?.length     || 0, icon: CheckSquare },
    { key: 'mv',        label: 'Visits',    count: results?.mv?.length        || 0, icon: Wrench },
    ...(isManager ? [{ key: 'customers', label: 'Customers', count: results?.customers?.length || 0, icon: Building2 }] : []),
  ].filter(t => t.key === 'all' || t.count > 0 || (results && total === 0));

  function renderResults() {
    if (!results) return null;
    if (total === 0) {
      return (
        <div className="empty" style={{ marginTop: 40 }}>
          <div className="empty-icon"><Search size={36} strokeWidth={1.2} /></div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>No results found</p>
          <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>Try adjusting your search or removing some filters</p>
        </div>
      );
    }

    const show = (type) => activeTab === 'all' || activeTab === type;

    return (
      <div className="flex-col gap-8">
        {show('projects') && results.projects?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><FolderOpen size={13} /> Projects ({results.projects.length})</div>}
            {results.projects.map(p => <ProjectCard key={p.id} item={p} navigate={navigate} />)}
          </div>
        )}
        {show('tasks') && results.tasks?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><CheckSquare size={13} /> Tasks ({results.tasks.length})</div>}
            {results.tasks.map(t => <TaskCard key={t.id} item={t} navigate={navigate} />)}
          </div>
        )}
        {show('mv') && results.mv?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><Wrench size={13} /> Maintenance Visits ({results.mv.length})</div>}
            {results.mv.map(v => <MVCard key={v.id} item={v} navigate={navigate} />)}
          </div>
        )}
        {show('customers') && results.customers?.length > 0 && (
          <div>
            {activeTab === 'all' && <div className="result-section-label"><Building2 size={13} /> Customers ({results.customers.length})</div>}
            {results.customers.map(c => <CustomerCard key={c.id} item={c} navigate={navigate} />)}
          </div>
        )}
        {(page>1 || hasNextPage) && <nav className="approval-pagination" aria-label="Search result pages"><span>Page {page}</span><button className="btn btn-ghost btn-sm" disabled={loading || page===1} onClick={() => setPage(value => Math.max(1,value-1))}>Previous</button><button className="btn btn-ghost btn-sm" disabled={loading || !hasNextPage} onClick={() => setPage(value => value+1)}>Next</button></nav>}
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Zap size={20} color="var(--primary)" /> Smart Search
        </h1>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>
          Search in plain English — by status, customer, engineer, date and more.
          <span style={{ marginLeft: 8, background: 'var(--gray-100)', border: '1px solid var(--gray-200)', borderRadius: 4, padding: '1px 5px', fontSize: 11, fontFamily: 'monospace', color: 'var(--gray-600)' }}>Ctrl K</span>
        </p>
      </div>

      {/* Search box */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && clearAll()}
          placeholder='Try: "open projects for Acme", "overdue tasks assigned to John", "reports not sent"…'
          style={{ paddingLeft: 42, paddingRight: query ? 40 : 16, height: 48, fontSize: 15, borderRadius: 12, fontWeight: 400 }}
        />
        {query && (
          <button onClick={clearAll} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4 }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Interpretation chips */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, marginRight: 2 }}>INTERPRETED AS</span>
          {chips.map(chip => (
            <span key={chip.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: chip.bg, color: chip.color,
              border: `1px solid ${chip.color}33`,
              borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600,
            }}>
              {chip.label}
              <button onClick={() => removeChip(chip.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: chip.color, padding: 0, display: 'flex', lineHeight: 1, opacity: 0.6 }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Advanced filters toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: showAdvanced ? 'var(--primary)' : 'none', color: showAdvanced ? '#fff' : 'var(--gray-600)', border: '1px solid ' + (showAdvanced ? 'var(--primary)' : 'var(--gray-200)'), borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          <Search size={13} /> Filters {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {hasQuery && (
          <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--gray-400)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Clear all
          </button>
        )}
        {loading && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Searching…</span>}
        {!loading && results && <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 'auto' }}>{total} result{total !== 1 ? 's' : ''} on page {page}</span>}
      </div>

      {showAdvanced && (
        <div className="mb-16">
          <AdvancedFilters filters={{ ...parsedFilters, ...manualFilters }} setFilters={setManualFilters} users={users} customers={customers} isManager={isManager} />
        </div>
      )}

      {/* Examples (shown when no query) */}
      {!hasQuery && !results && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            Example searches
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXAMPLES.map(ex => (
              <button
                key={ex.q}
                onClick={() => setQuery(ex.q)}
                style={{
                  background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
                  borderRadius: 20, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  color: 'var(--gray-700)', fontWeight: 500,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.color = 'var(--gray-700)'; }}
              >
                <ArrowRight size={11} /> {ex.label}
              </button>
            ))}
          </div>

          {/* Tips */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Tips</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, color: 'var(--gray-600)' }}>
              {[
                ['"open projects for Acme"',         'Filter by customer + status'],
                ['"overdue tasks assigned to John"',  'Filter by engineer + overdue'],
                ['"reports not sent"',                'MV report workflow filter'],
                ['"projects pending approval"',       'Closure workflow filter'],
                ['"high priority unassigned tasks"',  'Combine multiple filters'],
                ['"my tasks"',                        'Show your own items'],
              ].map(([ex, desc]) => (
                <div key={ex} className="flex gap-6">
                  <code style={{ background: 'var(--gray-100)', borderRadius: 4, padding: '1px 5px', fontSize: 11, flexShrink: 0, cursor: 'pointer', color: 'var(--gray-700)' }} onClick={() => setQuery(ex.replace(/"/g, ''))}>{ex}</code>
                  <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {results && total > 0 && (
        <div className="filter-bar mb-12">
          {tabs.map(t => (
            <button
              key={t.key}
              className={'filter-pill' + (activeTab === t.key ? ' active' : '')}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}{t.key !== 'all' ? ` (${t.count})` : ` (${total})`}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {renderResults()}
    </div>
  );
}
