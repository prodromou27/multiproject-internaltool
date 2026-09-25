import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, Building2, Search, X, Zap } from 'lucide-react';
import { api } from '../api';

/* ── Global Search (compact icon + dropdown) ─────────────── */
export function GlobalSearch() {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState(null);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const ref      = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const showSearch = () => setOpen(true);
    window.addEventListener('solutionshub:open-search', showSearch);
    return () => window.removeEventListener('solutionshub:open-search', showSearch);
  }, []);

  useEffect(() => {
    if (query.length < 2) { setResults(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(query)
        .then(r => { setResults(r); setLoading(false); })
        .catch(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Auto-focus input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const hasResults = results && (results.projects?.length || results.tasks?.length || results.customers?.length);
  function go(path) { navigate(path); setQuery(''); setResults(null); setOpen(false); }

  const statusDot = { active: '#22c55e', on_hold: '#94a3b8', pending_approval: '#f59e0b', closed: '#6b7280' };

  return (
    <div ref={ref} className="relative">
      {/* Icon button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="topbar-action u-83eb2d8"
        style={{ color: open ? 'var(--primary)' : 'var(--gray-500)' }}
        aria-label="Search"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Global search"
      >
        <Search size={18} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="topbar-popover search-popover u-debc61a" role="search" aria-label="Global search">
          {/* Search input row */}
          <div className="u-dab4e63">
            <Search size={14} color="var(--gray-400)" className="flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && query.length >= 2) go(`/search?q=${encodeURIComponent(query)}`); if (e.key === 'Escape') setOpen(false); }}
              placeholder="Search projects, tasks, customers…"
              aria-label="Search projects, tasks, and customers"
              className="u-7d13a5b"
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}
                aria-label="Clear search"
                className="u-baf3a42">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="u-98a7e0c">
            {query.length < 2 && (
              <div className="search-empty-state">
                <Search size={22} aria-hidden="true" />
                <span>Type at least 2 characters to search</span>
                <small><kbd>Enter</kbd> opens Smart Search · <kbd>Esc</kbd> closes</small>
              </div>
            )}
            {query.length >= 2 && loading && (
              <div className="u-d9e5a65">Searching…</div>
            )}
            {query.length >= 2 && !loading && !hasResults && (
              <div className="u-d9e5a65">
                No results for "{query}"
              </div>
            )}
            {!loading && hasResults && <>
              {results.projects?.length > 0 && (
                <div>
                  <div className="u-be64ca3">Projects</div>
                  {results.projects.map(p => (
                    <div key={p.id} onClick={() => go(`/projects/${p.id}`)}
                      className="u-c7fdd81"
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <span className="u-68bde25" style={{ background: statusDot[p.status] || '#9ca3af' }} />
                      <span className="u-b4a7719">{p.title}</span>
                      {p.customer_name && <span className="u-45c5f78">{p.customer_name}</span>}
                    </div>
                  ))}
                </div>
              )}
              {results.tasks?.length > 0 && (
                <div>
                  <div className="u-be64ca3">Tasks</div>
                  {results.tasks.map(t => (
                    <div key={t.id} onClick={() => go(t.project_id ? `/projects/${t.project_id}` : '/tasks')}
                      className="u-c7fdd81"
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <CheckSquare size={13} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div className="u-b644c50">{t.title}</div>
                        {t.project_title && <div className="u-5be3ef4">{t.project_title}</div>}
                      </div>
                      <span className="u-45c5f78">{t.assigned_to_name || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
              {results.customers?.length > 0 && (
                <div>
                  <div className="u-be64ca3">Customers</div>
                  {results.customers.map(c => (
                    <div key={c.id}
                      onClick={() => go(`/search?q=${encodeURIComponent(c.name)}&entity=customers`)}
                      className="u-c7fdd81"
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <Building2 size={13} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
                      <span className="u-b192d9f">{c.name}</span>
                      {c.contact_name && <span className="u-5be3ef4">{c.contact_name}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>}
          </div>

          {/* Smart Search footer */}
          <button
            type="button"
            className="search-footer u-06d622a"
            onClick={() => go(`/search?q=${encodeURIComponent(query)}`)}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}
          >
            <Zap size={13} />
            Open Smart Search{query ? ` for "${query}"` : ''} →
          </button>
        </div>
      )}
    </div>
  );
}
