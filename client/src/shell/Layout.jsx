import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { menuGroups, pageForPath } from '../navigation';
import QuickCreate from '../components/QuickCreate';
import HelpMenu from '../components/HelpMenu';
import { PRODUCT_WORDMARK } from '../product';
import { useAuth } from '../auth';
import { NotificationBell } from './NotificationBell';
import { Hamburger } from './Sidebar';
import { SidebarContent } from './Sidebar';
import UserMenu from './UserMenu';
import { CommandPalette } from './CommandPalette';

/* ── Layout ──────────────────────────────────────────────── */
export function Layout({ children }) {
  const { user, logout, saAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() => localStorage.getItem(`hub_nav_compact_${user.id}`) === '1');
  const [dense, setDense] = useState(() => localStorage.getItem(`hub_density_${user.id}`) === 'compact');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const drawerRef = useRef(null);
  const location = useLocation();
  const currentPage = pageForPath(location.pathname);
  const currentTeams = saAccess.teams.map(team => team.name).join(', ');
  const groups = useMemo(() => menuGroups(user, saAccess.enabled), [user, saAccess.enabled]);
  const foldedStorageKey = `hub_nav_folded_${user.id}`;
  const [folded, setFolded] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(foldedStorageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const toggleGroup = section => {
    setFolded(current => {
      const next = current.includes(section) ? current.filter(name => name !== section) : [...current, section];
      try { localStorage.setItem(foldedStorageKey, JSON.stringify(next)); } catch { /* the menu still works without storage */ }
      return next;
    });
  };

  const toggleCompactNav = () => {
    setCompactNav(current => {
      localStorage.setItem(`hub_nav_compact_${user.id}`, current ? '0' : '1');
      return !current;
    });
  };

  const toggleDensity = () => {
    setDense(current => {
      localStorage.setItem(`hub_density_${user.id}`, current ? 'comfortable' : 'compact');
      return !current;
    });
  };

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


  return (
    <div className={`layout operations-shell${compactNav ? ' nav-compact' : ''}${dense ? ' density-compact' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* Desktop sidebar */}
      <aside ref={drawerRef} id="primary-navigation" className={`sidebar${open ? ' open' : ''}`} aria-label="Primary navigation"
        role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}
        aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open}>
        {mobile && open && <button className="drawer-close" type="button" onClick={() => setOpen(false)}><X size={18} /> Close navigation</button>}
        <SidebarContent onNav={() => setOpen(false)} groups={groups} currentPage={currentPage}
          compact={compactNav && !mobile} collapsed={folded} onToggleGroup={toggleGroup}
          onToggleCompact={toggleCompactNav} />
      </aside>

      {/* Mobile overlay */}
      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

      {/* Mobile topbar */}
      <header className="topbar" inert={mobile && open}>
        <Hamburger open={open} onClick={() => setOpen(o => !o)} />
        <div className="topbar-logo">{PRODUCT_WORDMARK.prefix}<span>{PRODUCT_WORDMARK.suffix}</span></div>
        <div className="u-6bb9e7a">
          <QuickCreate user={user} serviceActivityEnabled={saAccess.enabled} capabilities={saAccess.capabilities} />
          <button type="button" className="topbar-action u-83eb2d8" onClick={() => setPaletteOpen(true)} aria-label="Search" title="Search"><Search size={18} aria-hidden="true" /></button>
          <HelpMenu role={user.role} />
          <NotificationBell />
          <UserMenu user={user} team={currentTeams} logout={logout} dense={dense} onToggleDensity={toggleDensity} />
        </div>
      </header>

      <div className="main" inert={mobile && open}>
        {/* Desktop-only top bar: find, create, alerts, account. The page names
            itself with its own heading, so it is not repeated here. */}
        <div className="desktop-topbar">
          {/* One search for everything: pages and records (customers, assets by serial or hostname, tasks…). */}
          <button type="button" className="workspace-command" onClick={() => setPaletteOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K">
            <Search size={15} aria-hidden="true" /> <span>Search customers, assets, serials, hostnames…</span> <kbd>Ctrl K</kbd>
          </button>
          <div className="u-2f5dfa5">
            <QuickCreate user={user} serviceActivityEnabled={saAccess.enabled} capabilities={saAccess.capabilities} />
            <HelpMenu role={user.role} />
            <NotificationBell />
            <UserMenu user={user} team={currentTeams} logout={logout} dense={dense} onToggleDensity={toggleDensity} />
          </div>
        </div>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
