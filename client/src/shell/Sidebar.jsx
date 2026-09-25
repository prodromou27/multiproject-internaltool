import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2, Award, BarChart2, UsersIcon, Settings, LogOut, Search, MessageSquare, Ticket, Database, CheckCheck, ClipboardList, FileText, StickyNote, UserCircle, Moon, Sun, ShieldCheck, Zap, Activity, Grid3X3, PanelLeftClose, PanelLeftOpen, Rows3 } from 'lucide-react';
import { api } from '../api';
import { PRODUCT_WORDMARK } from '../product';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';

/* ── Hamburger icon ──────────────────────────────────────── */
export function Hamburger({ open, onClick }) {
  return (
    <button className="hamburger" onClick={onClick} aria-label="Toggle menu" aria-expanded={open} aria-controls="primary-navigation">
      <span style={{ transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }} />
      <span style={{ opacity: open ? 0 : 1 }} />
      <span style={{ transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
    </button>
  );
}

/* ── Sidebar content ─────────────────────────────────────── */
export const PAGE_ICONS = { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2,
  Award, BarChart2, UsersIcon, Settings, Search, ClipboardList, FileText, StickyNote,
  UserCircle, MessageSquare, ShieldCheck, Zap, Activity, CheckCheck };

function OverdueDot({ count }) {
  if (!count) return null;
  return (
    <span className="sidebar-overdue-count u-ffa914c">{count > 99 ? '99+' : count}</span>
  );
}

export function SidebarContent({ user, logout, onNav, pages, compact, onOpenLauncher, onToggleCompact, dense, onToggleDensity }) {
  const toast = useToast();
  const { dark, toggleDark } = useAuth();
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

  return (
    <>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">
          <img src="/logo.png" alt="Odyssey" className="u-94aaddb" />
        </div>
        <span className="sidebar-brand-name">{PRODUCT_WORDMARK.prefix}<strong>{PRODUCT_WORDMARK.suffix}</strong></span>
      </div>

      {/* User info — click to go to profile */}
      <NavLink to="/profile" onClick={onNav} style={{ textDecoration: 'none' }}>
        <div className="sidebar-user cursor-pointer">
          <div className="sidebar-user-avatar u-d18c502">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="avatar" className="u-2410f0a" />
              : initials}
          </div>
          <div className="sidebar-user-info">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
        </div>
      </NavLink>

      {/* Main nav */}
      <nav className="sidebar-primary-nav" aria-label="Pinned modules">
        <div className="sidebar-section-label">Workspace</div>
        {pages.map(page => {
          const Icon = PAGE_ICONS[page.icon];
          return <NavLink key={page.id} to={page.path} end={page.path === '/'} onClick={onNav}
            title={compact ? page.label : undefined} aria-label={compact ? page.label : undefined}>
            <Icon size={18} aria-hidden="true" /> <span>{page.label}</span>
            <OverdueDot count={overdue[page.badge]} />
          </NavLink>;
        })}
        <button type="button" className="sidebar-launcher" onClick={onOpenLauncher}
          title={compact ? 'All modules' : undefined} aria-label={compact ? 'All modules' : undefined}>
          <Grid3X3 size={18} aria-hidden="true" /><span>All modules</span>
        </button>
      </nav>

      {/* Footer — external tools live here as compact links, out of the way of
          the app's own pages, instead of a full "Useful Links" section above. */}
      <div className="sidebar-footer">
        <div className="sidebar-external-links">
          <a href="https://ts.odysseycs.com/" target="_blank" rel="noopener noreferrer" onClick={onNav} title="Odyssey Ticketing (opens in a new tab)">
            <Ticket size={14} /> Ticketing
          </a>
          <a href="https://9605283.app.netsuite.com" target="_blank" rel="noopener noreferrer" onClick={onNav} title="Netsuite (opens in a new tab)">
            <Database size={14} /> Netsuite
          </a>
        </div>
        <button onClick={onToggleDensity} className="u-4e420af" title={dense ? 'Use comfortable spacing' : 'Use compact spacing'}>
          <Rows3 size={15} />
          <span>{dense ? 'Comfortable spacing' : 'Compact spacing'}</span>
        </button>
        <button onClick={onToggleCompact} className="sidebar-collapse" title={compact ? 'Expand navigation' : 'Collapse navigation'}>
          {compact ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          <span>{compact ? 'Expand' : 'Collapse'}</span>
        </button>
        <button onClick={toggleDark} className="u-4e420af" title={dark ? 'Use light mode' : 'Use dark mode'}>
          {dark ? <Sun size={14} /> : <Moon size={14} />}
          <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
        <button title="Sign out" onClick={async () => { try { await logout(); onNav(); } catch (e) { toast.error(e.message || 'Unable to sign out'); } }}>
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
      </div>
    </>
  );
}
