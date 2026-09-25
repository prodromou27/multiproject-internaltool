import { useEffect, useState, useRef, useCallback } from 'react';
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
        <div className="empty u-d9f1497">
          <div className="empty-icon"><Search size={36} strokeWidth={1.2} /></div>
          <p className="u-a27006d">No results found</p>
          <p className="u-af50806">Try adjusting your search or removing some filters</p>
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
    <div className="page u-13a1119">
      {/* Page header */}
      <div className="u-8677744">
        <h1 className="page-title u-143e030">
          <Zap size={20} color="var(--primary)" /> Smart Search
        </h1>
        <p className="u-b5e2607">
          Search in plain English — by status, customer, engineer, date and more.
          <span className="u-a17e12d">Ctrl K</span>
        </p>
      </div>

      {/* Search box */}
      <div className="u-456c927">
        <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && clearAll()}
          placeholder='Try: "open projects for Acme", "overdue tasks assigned to John", "reports not sent"…'
          className="u-4b75f79" style={{ paddingRight: query ? 40 : 16 }}
        />
        {query && (
          <button onClick={clearAll} className="u-f2f961b">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Interpretation chips */}
      {chips.length > 0 && (
        <div className="u-e99eec0">
          <span className="u-e5d01c2">INTERPRETED AS</span>
          {chips.map(chip => (
            <span key={chip.key} className="u-7f9f13d" style={{ background: chip.bg, color: chip.color, border: `1px solid ${chip.color}33` }}>
              {chip.label}
              <button onClick={() => removeChip(chip.key)} className="u-6c4515b" style={{ color: chip.color }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Advanced filters toggle */}
      <div className="u-a522af5">
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="u-6351d21" style={{ background: showAdvanced ? 'var(--primary)' : 'none', color: showAdvanced ? '#fff' : 'var(--gray-600)', border: '1px solid ' + (showAdvanced ? 'var(--primary)' : 'var(--gray-200)') }}
        >
          <Search size={13} /> Filters {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {hasQuery && (
          <button onClick={clearAll} className="u-b6d5234">
            <X size={12} /> Clear all
          </button>
        )}
        {loading && <span className="u-d65cb71">Searching…</span>}
        {!loading && results && <span className="u-a834a3b">{total} result{total !== 1 ? 's' : ''} on page {page}</span>}
      </div>

      {showAdvanced && (
        <div className="mb-16">
          <AdvancedFilters filters={{ ...parsedFilters, ...manualFilters }} setFilters={setManualFilters} users={users} customers={customers} isManager={isManager} />
        </div>
      )}

      {/* Examples (shown when no query) */}
      {!hasQuery && !results && (
        <div className="card u-769fed3">
          <div className="u-cd249b4">
            Example searches
          </div>
          <div className="u-c21c70e">
            {EXAMPLES.map(ex => (
              <button
                key={ex.q}
                onClick={() => setQuery(ex.q)}
                className="u-2c6c123"
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.color = 'var(--gray-700)'; }}
              >
                <ArrowRight size={11} /> {ex.label}
              </button>
            ))}
          </div>

          {/* Tips */}
          <div className="u-8008da8">
            <div className="u-3b97ed3">Tips</div>
            <div className="u-557c799">
              {[
                ['"open projects for Acme"',         'Filter by customer + status'],
                ['"overdue tasks assigned to John"',  'Filter by engineer + overdue'],
                ['"reports not sent"',                'MV report workflow filter'],
                ['"projects pending approval"',       'Closure workflow filter'],
                ['"high priority unassigned tasks"',  'Combine multiple filters'],
                ['"my tasks"',                        'Show your own items'],
              ].map(([ex, desc]) => (
                <div key={ex} className="flex gap-6">
                  <code className="u-7a90ff0" onClick={() => setQuery(ex.replace(/"/g, ''))}>{ex}</code>
                  <span className="u-33ea7bc">{desc}</span>
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
