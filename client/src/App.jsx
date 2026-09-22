import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench,
  Building2, Award, BarChart2, Users as UsersIcon, Settings, LogOut, Search, X,
  ExternalLink, MessageSquare, Ticket, Database, Bell, CheckCheck, Trash2,
  ClipboardList, Briefcase, Wrench as WrenchIcon, FileText, StickyNote, UserCircle,
  Moon, Sun, AtSign, ShieldCheck, Zap, Activity,
} from 'lucide-react';
import Login from './pages/Login';
import { api } from './api';
import { PAGES, visiblePages, pageForPath, canAccessPage } from './navigation';
import { PageState } from './components/PageLayout';
import ErrorBoundary from './components/ErrorBoundary';
import QuickCreate from './components/QuickCreate';
import { StatusProvider } from './hooks/useStatuses';
import { ToastProvider, useToast } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';

// Route-level code splitting: each page loads on first visit instead of in the
// initial bundle. Login stays eager so the unauthenticated first paint is instant.
const Dashboard         = lazy(() => import('./pages/Dashboard'));
const Approvals         = lazy(() => import('./pages/Approvals'));
const Projects          = lazy(() => import('./pages/Projects'));
const ProjectDetail     = lazy(() => import('./pages/ProjectDetail'));
const Tasks             = lazy(() => import('./pages/Tasks'));
const Reports           = lazy(() => import('./pages/Reports'));
const UsersPage         = lazy(() => import('./pages/Users'));
const CalendarPage      = lazy(() => import('./pages/CalendarPage'));
const MaintenanceVisits = lazy(() => import('./pages/MaintenanceVisits'));
const Customers         = lazy(() => import('./pages/Customers'));
const AdminPanel        = lazy(() => import('./pages/AdminPanel'));
const Scorecards        = lazy(() => import('./pages/Scorecards'));
const CustomerResponses = lazy(() => import('./pages/CustomerResponses'));
const Templates         = lazy(() => import('./pages/Templates'));
const Workload          = lazy(() => import('./pages/Workload'));
const Notes             = lazy(() => import('./pages/Notes'));
const Profile           = lazy(() => import('./pages/Profile'));
const SLAPage           = lazy(() => import('./pages/SLAPage'));
const SearchPage        = lazy(() => import('./pages/SearchPage'));
const EngineerHub       = lazy(() => import('./pages/EngineerHub'));
const ActivityLog       = lazy(() => import('./pages/ActivityLog'));
const ServiceOperations = lazy(() => import('./pages/ServiceOperations'));
const ManagedCustomers   = lazy(() => import('./pages/ManagedCustomers'));
const CustomerServiceProfile = lazy(() => import('./pages/CustomerServiceProfile'));

export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

/* ── Dark mode hook ──────────────────────────────────────── */
function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('hub_theme') === 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('hub_theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, () => setDark(d => !d)];
}

/* ── Notification Bell ───────────────────────────────────── */
const NOTIF_ICONS = {
  'task.assigned':    <CheckSquare size={14} color="#3b82f6" />,
  'visit.assigned':   <WrenchIcon  size={14} color="#f59e0b" />,
  'visit.reminder':   <WrenchIcon  size={14} color="#ef4444" />,
  'project.assigned': <Briefcase   size={14} color="#8b5cf6" />,
  'report.submitted': <FileText    size={14} color="#10b981" />,
  'managed_report.submitted': <FileText size={14} color="#f59e0b" />,
  'managed_report.approved':  <FileText size={14} color="#10b981" />,
  'managed_report.rejected':  <FileText size={14} color="#ef4444" />,
  'managed_report.finalized': <FileText size={14} color="#10b981" />,
  'managed_report.reopened':  <FileText size={14} color="#f59e0b" />,
  'mention':          <AtSign      size={14} color="#ec4899" />,
};

function timeSinceNotif(dt) {
  if (!dt) return '';
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function NotificationBell() {
  const [notifs, setNotifs]   = useState([]);
  const [unread, setUnread]   = useState(0);
  const [actionRequired,setActionRequired]=useState(0);
  const [filter,setFilter]=useState('all');
  const [page,setPage]=useState(1);
  const [pages,setPages]=useState(1);
  const [open, setOpen]       = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = useCallback((nextPage=1,append=false) => {
    api.notifications({ status:filter,page:nextPage,page_size:30 }).then(d => {
      setNotifs(current => append ? [...current,...(d.notifications || [])] : (d.notifications || []));
      setUnread(d.unread || 0);
      setActionRequired(d.action_required || 0);
      setPage(d.page || 1);setPages(d.pages || 1);
    }).catch(() => {});
  }, [filter]);

  // Initial load + poll every 60 s; pause when tab is hidden
  useEffect(() => {
    load();
    let t = setInterval(load, 60000);
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(t);
      } else {
        load(); // immediate refresh on tab focus
        t = setInterval(load, 60000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  async function markAllRead() {
    await api.markAllNotificationsRead().catch(() => {});
    setNotifs(n => filter==='unread' ? [] : n.map(x => ({ ...x,read:1,read_at:x.read_at || new Date().toISOString() })));
    setUnread(0);
  }

  async function clearAll() {
    await api.clearNotifications().catch(() => {});
    setNotifs([]);
    setUnread(0);
    setActionRequired(0);
  }

  async function dismiss(id, e) {
    e.stopPropagation();
    await api.deleteNotification(id).catch(() => {});
    const item=notifs.find(x => x.id===id);
    setNotifs(n => n.filter(x => x.id !== id));
    if (item && !item.read) setUnread(u => Math.max(0,u-1));
    if (item && ['high','critical'].includes(item.priority) && !item.acknowledged_at) setActionRequired(value => Math.max(0,value-1));
  }

  async function acknowledge(n,e) {
    e.stopPropagation();
    try { await api.acknowledgeNotification(n.id); } catch { return; }
    setNotifs(current => filter==='action_required' ? current.filter(item => item.id!==n.id) : current.map(item => item.id===n.id ? { ...item,read:1,acknowledged_at:new Date().toISOString() } : item));
    if (!n.read) setUnread(value => Math.max(0,value-1));
    setActionRequired(value => Math.max(0,value-1));
  }

  async function clickNotif(n) {
    if (!n.read) {
      await api.markNotificationRead(n.id).catch(() => {});
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: 1 } : x));
      setUnread(u => Math.max(0, u - 1));
    }
    // Guard against open redirects: only follow absolute same-origin paths (not protocol-relative //host/...)
    if (n.link && /^\/[^/]/.test(n.link)) {
      navigate(n.link);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        className="topbar-action"
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 6, borderRadius: 8,
          color: open ? 'var(--primary)' : 'var(--gray-500)',
          display: 'flex', alignItems: 'center',
          transition: 'color .15s',
        }}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: 1,
            borderRadius: 10, minWidth: 15, height: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', border: '2px solid var(--surface)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="topbar-popover notification-popover" role="menu" aria-label="Notifications" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 340, maxHeight: 480, overflowY: 'auto',
          background: 'var(--surface)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.15)',
          border: '1px solid var(--gray-100)', zIndex: 2000,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--gray-100)',
            position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bell size={13} /> Notifications
              {unread > 0 && (
                <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px' }}>
                  {unread} new
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {unread > 0 && (
                <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4 }}>
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              {notifs.length > 0 && (
                <button onClick={clearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--gray-400)', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4 }}>
                  <Trash2 size={12} /> Dismiss all
                </button>
              )}
            </div>
          </div>

          <div style={{ display:'flex',gap:6,padding:'8px 12px',borderBottom:'1px solid var(--gray-100)',position:'sticky',top:45,background:'var(--surface)',zIndex:1 }}>
            {[['all','All'],['unread',`Unread (${unread})`],['action_required',`Action (${actionRequired})`]].map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`btn btn-sm ${filter===value?'btn-primary':'btn-ghost'}`} style={{ flex:1 }}>{label}</button>)}
          </div>

          {/* List */}
          {notifs.length === 0
            ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>
                <Bell size={28} style={{ marginBottom: 8, opacity: .3 }} />
                <div>No notifications yet</div>
              </div>
            )
            : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => clickNotif(n)}
                style={{
                  display: 'flex', gap: 10, padding: '10px 14px',
                  cursor: n.link ? 'pointer' : 'default',
                  background: n.read ? 'var(--surface)' : 'var(--highlight)',
                  borderBottom: '1px solid var(--gray-50)',
                  transition: 'background .1s',
                  alignItems: 'flex-start',
                }}
                onMouseEnter={e => { if (n.link) e.currentTarget.style.background = n.read ? 'var(--gray-50)' : 'var(--highlight-strong)'; }}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? 'var(--surface)' : 'var(--highlight)'}
              >
                <div style={{ width: 28, height: 28, borderRadius: 8, background: n.read ? 'var(--gray-100)' : 'var(--highlight-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  {NOTIF_ICONS[n.type] || <Bell size={14} color="var(--gray-500)" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: 'var(--gray-900)', marginBottom: 2 }}>{n.title}{['high','critical'].includes(n.priority) && <span style={{ marginLeft:6,fontSize:9,textTransform:'uppercase',color:n.priority==='critical'?'#dc2626':'#d97706' }}>{n.priority}</span>}</div>
                  {n.body && <div style={{ fontSize: 11, color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>{timeSinceNotif(n.created_at)}</div>
                  {['high','critical'].includes(n.priority) && !n.acknowledged_at && <button type="button" onClick={e => acknowledge(n,e)} style={{ background:'none',border:0,padding:'4px 0 0',fontSize:10,color:'var(--primary)',cursor:'pointer',fontWeight:700 }}><CheckCheck size={11} style={{ verticalAlign:'middle',marginRight:3 }} />Acknowledge</button>}
                </div>
                <button onClick={e => dismiss(n.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', padding: 2, borderRadius: 4, flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          }
          {page<pages && <div style={{ padding:10,textAlign:'center' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => load(page+1,true)}>Load older notifications</button></div>}
        </div>
      )}
    </div>
  );
}

/* ── Global Search (compact icon + dropdown) ─────────────── */
function GlobalSearch() {
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
    <div ref={ref} style={{ position: 'relative' }}>
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
            <Search size={14} color="var(--gray-400)" style={{ flexShrink: 0 }} />
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
                      <div style={{ flex: 1, minWidth: 0 }}>
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

/* ── Hamburger icon ──────────────────────────────────────── */
function Hamburger({ open, onClick }) {
  return (
    <button className="hamburger" onClick={onClick} aria-label="Toggle menu" aria-expanded={open} aria-controls="primary-navigation">
      <span style={{ transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }} />
      <span style={{ opacity: open ? 0 : 1 }} />
      <span style={{ transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
    </button>
  );
}

/* ── Sidebar content ─────────────────────────────────────── */
const PAGE_ICONS = { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2,
  Award, BarChart2, UsersIcon, Settings, Search, ClipboardList, FileText, StickyNote,
  UserCircle, MessageSquare, ShieldCheck, Zap, Activity, CheckCheck };

function OverdueDot({ count }) {
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 'auto', background: '#ef4444', color: '#fff',
      fontSize: 9, fontWeight: 800, lineHeight: 1, borderRadius: 10,
      minWidth: 16, height: 16, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '0 4px', flexShrink: 0,
    }}>{count > 99 ? '99+' : count}</span>
  );
}

function SidebarContent({ user, logout, onNav }) {
  const toast = useToast();
  const { dark, toggleDark, saAccess } = useAuth();
  const initials = user.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  const [overdue, setOverdue] = useState({ tasks: 0, visits: 0 });
  useEffect(() => {
    let mounted = true;
    const refresh = () => api.overdueCounts().then(d => { if (mounted) setOverdue(d); }).catch(() => {});
    refresh();
    const t = setInterval(refresh, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { mounted = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const pages = visiblePages(user, saAccess.enabled).filter(page => !page.hidden);
  const sections = [...new Set(pages.map(page => page.section))];

  return (
    <>
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ background: '#fff', borderRadius: 6, padding: '2px 7px', display: 'flex', alignItems: 'center', flexShrink: 0, height: 28 }}>
          <img src="/logo.png" alt="Odyssey" style={{ height: 19, width: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>
        Solutions<span>Hub</span>
      </div>

      {/* User info — click to go to profile */}
      <NavLink to="/profile" onClick={onNav} style={{ textDecoration: 'none' }}>
        <div className="sidebar-user" style={{ cursor: 'pointer' }}>
          <div className="sidebar-user-avatar" style={{ overflow: 'hidden', padding: 0 }}>
            {user.avatar_url
              ? <img src={user.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initials}
          </div>
          <div className="sidebar-user-info">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
        </div>
      </NavLink>

      {/* Main nav */}
      <nav style={{ flex: 1, padding: '8px 10px' }}>
        {sections.map(section => <React.Fragment key={section}>
          <div className="sidebar-section-label">{section}</div>
          {pages.filter(page => page.section === section).map(page => {
            const Icon = PAGE_ICONS[page.icon];
            return <NavLink key={page.id} to={page.path} end={page.path === '/'} onClick={onNav}>
              <Icon size={17} aria-hidden="true" /> <span>{page.label}</span>
              <OverdueDot count={overdue[page.badge]} />
            </NavLink>;
          })}
        </React.Fragment>)}

        {/* Useful Links — visible to all roles */}
        <div className="sidebar-section-label" style={{ marginTop: 8 }}>Useful Links</div>
        <a
          href="https://ts.odysseycs.com/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNav}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Ticket size={16} />
          Odyssey Ticketing
          <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: .5 }} />
        </a>
        <a
          href="https://9605283.app.netsuite.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNav}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Database size={16} />
          Netsuite
          <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: .5 }} />
        </a>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button onClick={toggleDark} style={{ marginBottom: 6 }}>
          {dark ? <Sun size={14} /> : <Moon size={14} />}
          {dark ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button onClick={async () => { try { await logout(); onNav(); } catch (e) { toast.error(e.message || 'Unable to sign out'); } }}>
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </>
  );
}

const COMMANDS = [
  { label: 'Global search', action: 'search', icon: Search, roles: ['manager', 'engineer', 'planner', 'pm'] },
  ...PAGES.map(page => ({ ...page, label: page.label, path: page.path, icon: PAGE_ICONS[page.icon], requiresServiceActivity: !!page.feature })),
];

function CommandPalette({ open, onClose }) {
  const { user, saAccess } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter(c =>
      c.roles.includes(user.role) &&
      (!c.requiresServiceActivity || user.role === 'manager' || saAccess?.enabled) &&
      (!q || c.label.toLowerCase().includes(q))
    );
  }, [query, user.role, saAccess?.enabled]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setActive(0), [query]);
  if (!open) return null;

  function run(command) {
    if (!command) return;
    onClose();
    if (command.action === 'search') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('solutionshub:open-search')));
      return;
    }
    navigate(command.path);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, commands.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); run(commands[active]); }
  }

  return (
    <div className="command-backdrop" onMouseDown={onClose} role="presentation">
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={e => e.stopPropagation()}>
        <div className="command-input-row">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Go to a page or run a command…" aria-label="Search commands" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results" role="listbox">
          {commands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button key={command.path || command.action} type="button" role="option" aria-selected={index === active}
                className={`command-item${index === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(index)} onClick={() => run(command)}>
                <Icon size={17} /> <span>{command.label}</span><span className="command-hint">Open</span>
              </button>
            );
          })}
          {!commands.length && <div className="command-empty">No matching commands</div>}
        </div>
        <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span></div>
      </div>
    </div>
  );
}

/* ── Layout ──────────────────────────────────────────────── */
function Layout({ children }) {
  const { user, logout, saAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const drawerRef = useRef(null);
  const location = useLocation();
  const currentPage = pageForPath(location.pathname);
  const currentTeams = saAccess.teams.map(team => team.name).join(', ');

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const change = () => { setMobile(media.matches); if (!media.matches) setOpen(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => [...drawerRef.current.querySelectorAll('a[href], button:not([disabled])')];
    controls()[0]?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trap);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, mobile]);
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setOpen(false); setPaletteOpen(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(value => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const initials = user.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="layout operations-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* Desktop sidebar */}
      <aside ref={drawerRef} id="primary-navigation" className={`sidebar${open ? ' open' : ''}`} aria-label="Primary navigation"
        role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}
        aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open ? '' : undefined}>
        {mobile && open && <button className="drawer-close" type="button" onClick={() => setOpen(false)}><X size={18} /> Close navigation</button>}
        <SidebarContent user={user} logout={logout} onNav={() => setOpen(false)} />
      </aside>

      {/* Mobile overlay */}
      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

      {/* Mobile topbar */}
      <header className="topbar" inert={mobile && open ? '' : undefined}>
        <Hamburger open={open} onClick={() => setOpen(o => !o)} />
        <div className="topbar-logo">Solutions<span>Hub</span></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          <QuickCreate role={user.role} serviceActivityEnabled={saAccess.enabled} />
          <GlobalSearch />
          <NotificationBell />
          <div className="topbar-user">
            <strong>{initials}</strong><br />
            <span style={{ fontSize: 10 }}>{user.role}</span>
          </div>
        </div>
      </header>

      <div className="main" inert={mobile && open ? '' : undefined}>
        {/* Desktop-only top bar */}
        <div className="desktop-topbar">
          <div className="workspace-context">
            <span className="workspace-section">{currentPage?.section || 'Workspace'}</span>
            <span className="workspace-page">{currentPage?.label || 'SolutionsHub'}</span>
          </div>
          {currentTeams && <span className="workspace-team" title={currentTeams}>{currentTeams}</span>}
          <button type="button" className="workspace-command" onClick={() => setPaletteOpen(true)} aria-label="Open page navigation">
            <Search size={15} aria-hidden="true" /> Go to a page <kbd>Ctrl K</kbd>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <QuickCreate role={user.role} serviceActivityEnabled={saAccess.enabled} />
            <GlobalSearch />
            <NotificationBell />
            <NavLink to="/profile" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', marginLeft: 6 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
                {user.avatar_url
                  ? <img src={user.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initials}
              </div>
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
            </NavLink>
          </div>
        </div>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

/* ── Route guard ─────────────────────────────────────────── */
function PageLoader() {
  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gray-400)', paddingTop: 48 }}>
      <span style={{ width: 16, height: 16, border: '2px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin .7s linear infinite', display: 'inline-block' }} />
      Loading…
    </div>
  );
}

function PrivateRoute({ children, allowedRoles, page }) {
  const { user, saAccess } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  const definition = page ? PAGES.find(item => item.id === page) : null;
  if (definition?.feature && user.role !== 'manager' && !saAccess.loaded) return <Layout><PageLoader /></Layout>;
  if ((definition && !canAccessPage(definition, user, saAccess.enabled)) ||
      (allowedRoles && !allowedRoles.includes(user.role))) {
    return <Layout><PageState title="Access unavailable" description="Your role or team settings do not allow access to this page. Contact your administrator if you need access." /></Layout>;
  }
  return <Layout><ErrorBoundary resetKey={location.pathname}><Suspense fallback={<PageLoader />}>{children}</Suspense></ErrorBoundary></Layout>;
}

function LegacySettingsRedirect() {
  const { section } = useParams();
  return <Navigate to={section ? `/settings/${section}` : '/settings'} replace />;
}

/* ── App root ────────────────────────────────────────────── */
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [passwordChangeUser, setPasswordChangeUser] = useState(null);
  const [dark, toggleDark] = useDarkMode();
  // Service Activity Tracking module access is team-membership-driven, not role-driven,
  // so it's fetched separately from the login payload and re-checked on every mount.
  // This only controls nav/route visibility (UX) — every server route independently
  // re-verifies team membership + enablement on each request.
  const [saAccess, setSaAccess] = useState({ enabled: false, teams: [], loaded: false });

  const refreshPermissions=useCallback(async () => {
    const result=await api.myPermissions();
    setUser(current => {
      if (!current) return current;
      const next=result.permissions || {};
      return JSON.stringify(current.permissions || {})===JSON.stringify(next) ? current : { ...current,permissions:next };
    });
  },[]);

  useEffect(() => {
    // Remove legacy browser-stored credentials; identity now comes from the API.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    let mounted = true;
    api.me({ redirectOnUnauthorized: false }).then(fresh => {
      if (!mounted) return;
      if (fresh.must_change_password) setPasswordChangeUser(fresh);
      else setUser(fresh);
    }).catch(error => {
      if (mounted && ![401, 403].includes(error.status)) setAuthError(error.message || 'Unable to restore your session');
    }).finally(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user) { setSaAccess({ enabled: false, teams: [], loaded: false }); return; }
    let mounted = true;
    api.teamsMine().then(d => {
      if (mounted) setSaAccess({ enabled: !!d.service_activity_enabled, teams: d.teams || [], loaded: true });
    }).catch(() => { if (mounted) setSaAccess({ enabled: false, teams: [], loaded: true }); });
    return () => { mounted = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return undefined;
    const refresh=() => refreshPermissions().catch(() => {});
    const timer=setInterval(refresh,60000);
    const onVisibility=() => { if (document.visibilityState==='visible') refresh(); };
    document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('permissions-changed',refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('permissions-changed',refresh);
    };
  },[user?.id,refreshPermissions]);

  const login = (userData) => {
    setPasswordChangeUser(null);
    setUser(userData);
  };
  const logout = async () => {
    await api.logout();
    setPasswordChangeUser(null);
    setUser(null);
  };

  if (authLoading) return <PageLoader />;
  if (authError) return <div className="page"><p className="error-msg" role="alert">{authError}</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button></div>;

  return (
    <AuthContext.Provider value={{ user, login, logout, dark, toggleDark, saAccess, passwordChangeUser }}>
      <ToastProvider>
      <ConfirmProvider>
      <StatusProvider enabled={!!user}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/"                    element={<PrivateRoute page="dashboard"><Dashboard /></PrivateRoute>} />
          <Route path="/calendar"            element={<PrivateRoute page="calendar"><CalendarPage /></PrivateRoute>} />
          <Route path="/projects"            element={<PrivateRoute page="projects"><Projects /></PrivateRoute>} />
          <Route path="/projects/:id"        element={<PrivateRoute page="projects"><ProjectDetail /></PrivateRoute>} />
          <Route path="/tasks"               element={<PrivateRoute page="tasks"><Tasks /></PrivateRoute>} />
          <Route path="/maintenance-visits"  element={<PrivateRoute page="visits"><MaintenanceVisits /></PrivateRoute>} />
          <Route path="/customers"           element={<PrivateRoute page="customers"><Customers /></PrivateRoute>} />
          <Route path="/managed-customers"   element={<PrivateRoute page="managedCustomers"><ManagedCustomers /></PrivateRoute>} />
          <Route path="/managed-customers/:id" element={<PrivateRoute page="managedCustomers"><ManagedCustomers /></PrivateRoute>} />
          <Route path="/scorecards"          element={<PrivateRoute page="scorecards"><Scorecards /></PrivateRoute>} />
          <Route path="/reports"             element={<PrivateRoute page="reports"><Reports /></PrivateRoute>} />
          <Route path="/approvals"           element={<PrivateRoute page="approvals"><Approvals /></PrivateRoute>} />
          <Route path="/users"               element={<PrivateRoute page="users"><UsersPage /></PrivateRoute>} />
          <Route path="/settings"            element={<PrivateRoute page="settings"><AdminPanel /></PrivateRoute>} />
          <Route path="/settings/:section"   element={<PrivateRoute page="settings"><AdminPanel /></PrivateRoute>} />
          <Route path="/admin"               element={<LegacySettingsRedirect />} />
          <Route path="/admin/:section"      element={<LegacySettingsRedirect />} />
          <Route path="/templates"           element={<PrivateRoute page="templates"><Templates /></PrivateRoute>} />
          <Route path="/workload"            element={<PrivateRoute page="workload"><Workload /></PrivateRoute>} />
          <Route path="/sla"               element={<PrivateRoute page="sla"><SLAPage /></PrivateRoute>} />
          <Route path="/notes"               element={<PrivateRoute page="notes"><Notes /></PrivateRoute>} />
          <Route path="/search"             element={<PrivateRoute page="search"><SearchPage /></PrivateRoute>} />
          <Route path="/my-day"             element={<PrivateRoute page="myWork"><EngineerHub /></PrivateRoute>} />
          <Route path="/profile"             element={<PrivateRoute page="profile"><Profile /></PrivateRoute>} />
          <Route path="/customer-responses"  element={<PrivateRoute page="responses"><CustomerResponses /></PrivateRoute>} />
          <Route path="/activity-log"        element={<PrivateRoute page="activities"><ActivityLog /></PrivateRoute>} />
          <Route path="/service-operations"  element={<PrivateRoute page="serviceOperations"><ServiceOperations /></PrivateRoute>} />
          <Route path="/customers/:id/service-profile" element={<PrivateRoute page="customers"><CustomerServiceProfile /></PrivateRoute>} />
          <Route path="*" element={<PrivateRoute><PageState title="Page not found" description="This page may have moved, or the link may be incorrect." /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
      </StatusProvider>
      </ConfirmProvider>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
