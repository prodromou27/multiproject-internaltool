import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench,
  Building2, Award, BarChart2, Users as UsersIcon, Settings, LogOut, Search, X,
  ExternalLink, MessageSquare, Ticket, Database, Bell, CheckCheck, Trash2,
  ClipboardList, Briefcase, Wrench as WrenchIcon, FileText, StickyNote, UserCircle,
  Moon, Sun, AtSign, ShieldCheck, Zap,
} from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Tasks from './pages/Tasks';
import Reports from './pages/Reports';
import UsersPage from './pages/Users';
import CalendarPage from './pages/CalendarPage';
import MaintenanceVisits from './pages/MaintenanceVisits';
import Customers from './pages/Customers';
import AdminPanel from './pages/AdminPanel';
import Scorecards from './pages/Scorecards';
import CustomerResponses from './pages/CustomerResponses';
import Templates from './pages/Templates';
import Workload from './pages/Workload';
import Notes from './pages/Notes';
import Profile from './pages/Profile';
import SLAPage from './pages/SLAPage';
import SearchPage from './pages/SearchPage';
import { api } from './api';
import { StatusProvider } from './hooks/useStatuses';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';

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
  const [open, setOpen]       = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.notifications().then(d => {
      setNotifs(d.notifications || []);
      setUnread(d.unread || 0);
    }).catch(() => {});
  }, []);

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
    setNotifs(n => n.map(x => ({ ...x, read: 1 })));
    setUnread(0);
  }

  async function clearAll() {
    await api.clearNotifications().catch(() => {});
    setNotifs([]);
    setUnread(0);
  }

  async function dismiss(id, e) {
    e.stopPropagation();
    await api.deleteNotification(id).catch(() => {});
    setNotifs(n => n.filter(x => x.id !== id));
    setUnread(u => Math.max(0, u - 1));
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
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 6, borderRadius: 8,
          color: open ? 'var(--primary)' : 'var(--gray-500)',
          display: 'flex', alignItems: 'center',
          transition: 'color .15s',
        }}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: 1,
            borderRadius: 10, minWidth: 15, height: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', border: '2px solid #fff',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 340, maxHeight: 480, overflowY: 'auto',
          background: '#fff', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.15)',
          border: '1px solid var(--gray-100)', zIndex: 2000,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--gray-100)',
            position: 'sticky', top: 0, background: '#fff', zIndex: 1,
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
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
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
                  background: n.read ? '#fff' : '#f0f9ff',
                  borderBottom: '1px solid var(--gray-50)',
                  transition: 'background .1s',
                  alignItems: 'flex-start',
                }}
                onMouseEnter={e => { if (n.link) e.currentTarget.style.background = n.read ? 'var(--gray-50)' : '#e0f2fe'; }}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? '#fff' : '#f0f9ff'}
              >
                <div style={{ width: 28, height: 28, borderRadius: 8, background: n.read ? 'var(--gray-100)' : '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  {NOTIF_ICONS[n.type] || <Bell size={14} color="var(--gray-500)" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: 'var(--gray-900)', marginBottom: 2 }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 11, color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                  <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>{timeSinceNotif(n.created_at)}</div>
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

  const statusDot = { active: '#22c55e', on_hold: '#94a3b8', pending_closure: '#f59e0b', closed: '#6b7280' };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Icon button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 6, borderRadius: 8,
          color: open ? 'var(--primary)' : 'var(--gray-500)',
          display: 'flex', alignItems: 'center',
          transition: 'color .15s',
        }}
        aria-label="Search"
        title="Search (Ctrl+K)"
      >
        <Search size={18} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 'min(380px, calc(100vw - 20px))',
          background: '#fff', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,.15)',
          border: '1px solid var(--gray-100)', zIndex: 2000,
        }}>
          {/* Search input row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderBottom: '1px solid var(--gray-100)',
            position: 'sticky', top: 0, background: '#fff',
          }}>
            <Search size={14} color="var(--gray-400)" style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && query.length >= 2) go(`/search?q=${encodeURIComponent(query)}`); if (e.key === 'Escape') setOpen(false); }}
              placeholder="Search projects, tasks, customers…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13,
                padding: 0, background: 'none', color: 'var(--gray-900)' }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--gray-400)', padding: 2, display: 'flex', flexShrink: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          {/* Results */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {query.length < 2 && (
              <div style={{ padding: '16px', color: 'var(--gray-400)', fontSize: 13, textAlign: 'center' }}>
                Type to search…
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
          <div
            onClick={() => go(`/search?q=${encodeURIComponent(query)}`)}
            style={{ padding: '10px 14px', borderTop: '1px solid var(--gray-100)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}
          >
            <Zap size={13} />
            Open Smart Search{query ? ` for "${query}"` : ''} →
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Hamburger icon ──────────────────────────────────────── */
function Hamburger({ open, onClick }) {
  return (
    <button className="hamburger" onClick={onClick} aria-label="Toggle menu">
      <span style={{ transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }} />
      <span style={{ opacity: open ? 0 : 1 }} />
      <span style={{ transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
    </button>
  );
}

/* ── Sidebar content ─────────────────────────────────────── */
const NAV_MANAGER_EXTRA = [
  { to: '/customers',  label: 'Customers',  icon: Building2 },
  { to: '/workload',   label: 'Workload',   icon: UsersIcon },
  { to: '/templates',  label: 'Templates',  icon: LayoutDashboard },
  { to: '/scorecards', label: 'Scorecards', icon: Award },
  { to: '/reports',    label: 'Reports',    icon: BarChart2 },
  { to: '/sla',        label: 'SLA',        icon: ShieldCheck },
  { to: '/users',      label: 'Team',       icon: UsersIcon },
];

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
  const { dark, toggleDark } = useAuth();
  const isManager = user.role === 'manager';
  const isPlanner = user.role === 'planner';
  const isPM      = user.role === 'pm';
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

  const NAV_ENGINEER = [
    { to: '/',                   label: 'Dashboard',  icon: LayoutDashboard, end: true },
    { to: '/calendar',           label: 'Calendar',   icon: CalendarDays },
    { to: '/projects',           label: 'Projects',   icon: FolderOpen },
    { to: '/tasks',              label: 'Tasks',      icon: CheckSquare,   badge: overdue.tasks },
    { to: '/maintenance-visits', label: 'Maintenance',icon: Wrench,        badge: overdue.visits },
  ];
  const NAV_PLANNER = [
    { to: '/',                   label: 'Dashboard',  icon: LayoutDashboard, end: true },
    { to: '/maintenance-visits', label: 'Maintenance',icon: Wrench,        badge: overdue.visits },
  ];
  const NAV_PM = [
    { to: '/',                   label: 'Dashboard',  icon: LayoutDashboard, end: true },
    { to: '/projects',           label: 'Projects',   icon: FolderOpen },
    { to: '/maintenance-visits', label: 'Maintenance',icon: Wrench,        badge: overdue.visits },
  ];
  const NAV_MANAGER = [
    { to: '/',                   label: 'Dashboard',  icon: LayoutDashboard, end: true },
    { to: '/calendar',           label: 'Calendar',   icon: CalendarDays },
    { to: '/projects',           label: 'Projects',   icon: FolderOpen },
    { to: '/tasks',              label: 'Tasks',      icon: CheckSquare,   badge: overdue.tasks },
    { to: '/maintenance-visits', label: 'Maintenance',icon: Wrench,        badge: overdue.visits },
  ];

  const mainNav = isManager ? NAV_MANAGER : isPlanner ? NAV_PLANNER : isPM ? NAV_PM : NAV_ENGINEER;

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
        <div className="sidebar-section-label">Navigation</div>
        {mainNav.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end} onClick={onNav}>
            <Icon size={16} />
            {label}
            <OverdueDot count={badge} />
          </NavLink>
        ))}

        {isManager && (
          <>
            <div className="sidebar-section-label" style={{ marginTop: 8 }}>Management</div>
            {NAV_MANAGER_EXTRA.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={onNav}>
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
            <NavLink
              to="/settings"
              onClick={onNav}
              className={({ isActive }) => 'admin-link' + (isActive ? ' active' : '')}
            >
              <Settings size={16} />
              Settings
            </NavLink>
          </>
        )}

        {/* Personal — visible to all roles */}
        <div className="sidebar-section-label" style={{ marginTop: 8 }}>Personal</div>
        <NavLink to="/profile" onClick={onNav}>
          <UserCircle size={16} />
          My Profile
        </NavLink>
        <NavLink to="/notes" onClick={onNav}>
          <StickyNote size={16} />
          My Notes
        </NavLink>

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
        <NavLink to="/customer-responses" onClick={onNav}>
          <MessageSquare size={16} />
          Customer Responses
        </NavLink>
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
        <button onClick={() => { onNav(); logout(); }}>
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </>
  );
}

/* ── Layout ──────────────────────────────────────────────── */
function Layout({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const initials = user.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="layout">
      {/* Desktop sidebar */}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <SidebarContent user={user} logout={logout} onNav={() => setOpen(false)} />
      </aside>

      {/* Mobile overlay */}
      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />

      {/* Mobile topbar */}
      <header className="topbar">
        <Hamburger open={open} onClick={() => setOpen(o => !o)} />
        <div className="topbar-logo">Solutions<span>Hub</span></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          <GlobalSearch />
          <NotificationBell />
          <div className="topbar-user">
            <strong>{initials}</strong><br />
            <span style={{ fontSize: 10 }}>{user.role}</span>
          </div>
        </div>
      </header>

      <div className="main">
        {/* Desktop-only top bar */}
        <div className="desktop-topbar">
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
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
        {children}
      </div>
    </div>
  );
}

/* ── Route guard ─────────────────────────────────────────── */
function PrivateRoute({ children, allowedRoles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const fallback = user.role === 'planner' || user.role === 'pm' ? '/maintenance-visits' : '/';
    return <Navigate to={fallback} replace />;
  }
  return <Layout>{children}</Layout>;
}

function LegacySettingsRedirect() {
  const { section } = useParams();
  return <Navigate to={section ? `/settings/${section}` : '/settings'} replace />;
}

/* ── App root ────────────────────────────────────────────── */
export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [dark, toggleDark] = useDarkMode();

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, dark, toggleDark }}>
      <ToastProvider>
      <ConfirmProvider>
      <StatusProvider enabled={!!user}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/"                    element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/calendar"            element={<PrivateRoute><CalendarPage /></PrivateRoute>} />
          <Route path="/projects"            element={<PrivateRoute allowedRoles={['manager','engineer','pm']}><Projects /></PrivateRoute>} />
          <Route path="/projects/:id"        element={<PrivateRoute allowedRoles={['manager','engineer','pm']}><ProjectDetail /></PrivateRoute>} />
          <Route path="/tasks"               element={<PrivateRoute allowedRoles={['manager','engineer']}><Tasks /></PrivateRoute>} />
          <Route path="/maintenance-visits"  element={<PrivateRoute><MaintenanceVisits /></PrivateRoute>} />
          <Route path="/customers"           element={<PrivateRoute allowedRoles={['manager']}><Customers /></PrivateRoute>} />
          <Route path="/scorecards"          element={<PrivateRoute allowedRoles={['manager']}><Scorecards /></PrivateRoute>} />
          <Route path="/reports"             element={<PrivateRoute allowedRoles={['manager']}><Reports /></PrivateRoute>} />
          <Route path="/users"               element={<PrivateRoute allowedRoles={['manager']}><UsersPage /></PrivateRoute>} />
          <Route path="/settings"            element={<PrivateRoute allowedRoles={['manager']}><AdminPanel /></PrivateRoute>} />
          <Route path="/settings/:section"   element={<PrivateRoute allowedRoles={['manager']}><AdminPanel /></PrivateRoute>} />
          <Route path="/admin"               element={<LegacySettingsRedirect />} />
          <Route path="/admin/:section"      element={<LegacySettingsRedirect />} />
          <Route path="/templates"           element={<PrivateRoute allowedRoles={['manager']}><Templates /></PrivateRoute>} />
          <Route path="/workload"            element={<PrivateRoute allowedRoles={['manager']}><Workload /></PrivateRoute>} />
          <Route path="/sla"               element={<PrivateRoute allowedRoles={['manager']}><SLAPage /></PrivateRoute>} />
          <Route path="/notes"               element={<PrivateRoute><Notes /></PrivateRoute>} />
          <Route path="/search"             element={<PrivateRoute><SearchPage /></PrivateRoute>} />
          <Route path="/profile"             element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/customer-responses"  element={<PrivateRoute><CustomerResponses /></PrivateRoute>} />
          <Route path="*"                    element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </StatusProvider>
      </ConfirmProvider>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
