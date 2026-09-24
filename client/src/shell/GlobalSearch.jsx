import React, { useState, useEffect, useRef } from 'react';
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
        className="topbar-action"
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 6, borderRadius: 8,
          color: open ? 'var(--primary)' : 'var(--gray-500)',
          display: 'flex', alignItems: 'center',
          transition: 'color .15s',
        }}
        aria-label="Search"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Global search"
      >
        <Search size={18} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="topbar-popover search-popover" role="search" aria-label="Global search" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 'min(380px, calc(100vw - 20px))',
          background: 'var(--surface)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.15)',
          border: '1px solid var(--gray-100)', zIndex: 2000,
        }}>
          {/* Search input row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderBottom: '1px solid var(--gray-100)',
            position: 'sticky', top: 0, background: 'var(--surface)',
          }}>
            <Search size={14} color="var(--gray-400)" className="flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && query.length >= 2) go(`/search?q=${encodeURIComponent(query)}`); if (e.key === 'Escape') setOpen(false); }}
              placeholder="Search projects, tasks, customers…"
              aria-label="Search projects, tasks, and customers"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13,
                padding: 0, background: 'none', color: 'var(--gray-900)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}
                aria-label="Clear search"
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray-400)', padding: 2, display: 'flex', flexShrink: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          {/* Results */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {query.length < 2 && (
              <div className="search-empty-state">
                <Search size={22} aria-hidden="true" />
                <span>Type at least 2 characters to search</span>
                <small><kbd>Enter</kbd> opens Smart Search · <kbd>Esc</kbd> closes</small>
              </div>
            )}
            {query.length >= 2 && loading && (
              <div style={{ padding: '14px 16px', color: 'var(--gray-400)', fontSize: 13 }}>Searching…</div>
            )}
            {query.length >= 2 && !loading && !hasResults && (
              <div style={{ padding: '14px 16px', color: 'var(--gray-400)', fontSize: 13 }}>
                No results for "{query}"
              </div>
            )}
            {!loading && hasResults && <>
              {results.projects?.length > 0 && (
                <div>
                  <div style={{ padding: '10px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: 1 }}>Projects</div>
                  {results.projects.map(p => (
                    <div key={p.id} onClick={() => go(`/projects/${p.id}`)}
                      style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot[p.status] || '#9ca3af', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                      {p.customer_name && <span style={{ fontSize: 11, color: 'var(--gray-400)', flexShrink: 0 }}>{p.customer_name}</span>}
                    </div>
                  ))}
                </div>
              )}
              {results.tasks?.length > 0 && (
                <div>
                  <div style={{ padding: '10px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: 1 }}>Tasks</div>
                  {results.tasks.map(t => (
                    <div key={t.id} onClick={() => go(t.project_id ? `/projects/${t.project_id}` : '/tasks')}
                      style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <CheckSquare size={13} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                        {t.project_title && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{t.project_title}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--gray-400)', flexShrink: 0 }}>{t.assigned_to_name || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
              {results.customers?.length > 0 && (
                <div>
                  <div style={{ padding: '10px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: 1 }}>Customers</div>
                  {results.customers.map(c => (
                    <div key={c.id}
                      onClick={() => go(`/search?q=${encodeURIComponent(c.name)}&entity=customers`)}
                      style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <Building2 size={13} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{c.name}</span>
                      {c.contact_name && <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{c.contact_name}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>}
          </div>

          {/* Smart Search footer */}
          <button
            type="button"
            className="search-footer"
            onClick={() => go(`/search?q=${encodeURIComponent(query)}`)}
            style={{ padding: '10px 14px', borderTop: '1px solid var(--gray-100)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}
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
