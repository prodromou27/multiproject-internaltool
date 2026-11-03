import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckSquare, FolderOpen, HardDrive, Search, Ticket, Wrench } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { visiblePages } from '../navigation';
import { PAGE_ICONS } from './Sidebar';
import { fmtDate } from '../components/Shared';

/* One search for everything (top bar, Ctrl K): the pages you can open, and the
   records you may see — customers, assets (by name, hostname, serial, tag, IP,
   MAC or model), tasks, projects, visits and tickets. Server: routes/search.js. */

const c360 = (customerId, params = '') => `/customers/${customerId}/service-profile${params}`;

// The server's results as one list of rows to show and open, grouped.
function recordRows(results) {
  if (!results) return [];
  const rows = [];
  const add = (group, icon, items, map) => items?.forEach(item => rows.push({ group, icon, ...map(item) }));
  add('Customers', Building2, results.customers, c => ({ key: `c${c.id}`, label: c.name, hint: c.contact_name || c.contact_email || '', path: c360(c.id) }));
  add('Assets', HardDrive, results.assets, a => ({ key: `a${a.id}`, label: a.name, hint: [a.matched ? `${a.matched.field}: ${a.matched.value}` : a.asset_type, a.customer_name, a.retired ? 'retired' : ''].filter(Boolean).join(' · '),
    path: c360(a.customer_id, `?section=assets&q=${encodeURIComponent(a.matched?.value || a.name)}`) }));
  add('Tasks', CheckSquare, results.tasks, t => ({ key: `t${t.id}`, label: t.title, hint: [t.project_title, t.assigned_to_name, t.deadline ? `due ${fmtDate(t.deadline)}` : ''].filter(Boolean).join(' · '),
    path: t.customer_id ? c360(t.customer_id, `?section=tasks&task=${t.id}`) : t.project_id ? `/projects/${t.project_id}` : '/tasks' }));
  add('Projects', FolderOpen, results.projects, p => ({ key: `p${p.id}`, label: p.title, hint: p.customer_name || '', path: `/projects/${p.id}` }));
  add('Maintenance visits', Wrench, results.visits, v => ({ key: `v${v.id}`, label: v.title, hint: [v.customer_name, fmtDate(v.scheduled_date)].filter(Boolean).join(' · '), path: `/maintenance-visits?visit=${v.id}` }));
  add('Tickets', Ticket, results.tickets, t => ({ key: `k${t.id}`, label: `#${t.ticket_number} ${t.subject}`, hint: [t.customer_name, t.status_group].filter(Boolean).join(' · '), path: c360(t.customer_id, '?section=tickets') }));
  return rows;
}

export function CommandPalette({ open, onClose }) {
  const { user, saAccess } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState(null), [loading, setLoading] = useState(false);
  const term = query.trim();

  const pages = useMemo(() => {
    const q = term.toLowerCase();
    const list = visiblePages(user, saAccess?.enabled).filter(page => !page.hidden && (!q || page.label.toLowerCase().includes(q)))
      .map(page => ({ key: `page-${page.id}`, group: 'Pages', icon: PAGE_ICONS[page.icon], label: page.label, hint: 'Page', path: page.path }));
    return q ? list.slice(0, 4) : list;
  }, [term, user, saAccess?.enabled]);

  // Records, once two characters are typed (debounced; an older answer never replaces a newer one).
  useEffect(() => {
    if (term.length < 2) { setResults(null); setLoading(false); return undefined; }
    setLoading(true);
    let stale = false;
    const timer = setTimeout(() => api.search(term).then(r => { if (!stale) setResults(r); }).catch(() => { if (!stale) setResults(null); }).finally(() => { if (!stale) setLoading(false); }), 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [term]);

  const rows = useMemo(() => {
    const records = recordRows(results);
    const all = term.length >= 2 ? [...records, ...pages] : pages;
    if (term.length >= 2) all.push({ key: 'all', group: '', icon: Search, label: `See all results for “${term}”`, hint: 'Smart Search', path: `/search?q=${encodeURIComponent(term)}` });
    return all;
  }, [results, pages, term]);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults(null); setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [query, results]);
  useEffect(() => { document.getElementById(`search-row-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  if (!open) return null;

  function run(row) {
    if (!row) return;
    onClose();
    navigate(row.path);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, rows.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); run(rows[active]); }
  }

  let lastGroup = null;
  return (
    <div className="command-backdrop" onMouseDown={onClose} role="presentation">
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={e => e.stopPropagation()}>
        <div className="command-input-row">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} maxLength={200}
            placeholder="Search customers, assets, serials, hostnames, tasks, pages…" aria-label="Search everything"
            role="combobox" aria-expanded="true" aria-controls="search-results" aria-activedescendant={rows[active] ? `search-row-${active}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results" role="listbox" id="search-results" aria-label="Results">
          {rows.map((row, index) => {
            const Icon = row.icon;
            const heading = row.group && row.group !== lastGroup ? <div className="command-group" role="presentation">{row.group}</div> : null;
            lastGroup = row.group;
            return <div key={row.key}>{heading}
              <button id={`search-row-${index}`} type="button" role="option" aria-selected={index === active}
                className={`command-item${index === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(index)} onClick={() => run(row)}>
                {Icon && <Icon size={17} aria-hidden="true" />} <span className="command-label">{row.label}</span>{row.hint && <span className="command-hint">{row.hint}</span>}
              </button>
            </div>;
          })}
          {term.length >= 2 && loading && !results && <div className="command-empty" role="status">Searching…</div>}
          {term.length >= 2 && !loading && results && rows.length <= 1 && <div className="command-empty">Nothing found for “{term}”.</div>}
        </div>
        <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>
  );
}
