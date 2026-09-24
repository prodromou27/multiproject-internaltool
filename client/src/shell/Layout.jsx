import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { visiblePages, primaryPages, pageForPath } from '../navigation';
import QuickCreate from '../components/QuickCreate';
import HelpMenu from '../components/HelpMenu';
import { PRODUCT_NAME, PRODUCT_WORDMARK } from '../product';
import { useAuth } from '../auth';
import { NotificationBell } from './NotificationBell';
import { GlobalSearch } from './GlobalSearch';
import { Hamburger } from './Sidebar';
import { SidebarContent } from './Sidebar';
import { ModuleLauncher } from './ModuleLauncher';
import { CommandPalette } from './CommandPalette';

/* ── Layout ──────────────────────────────────────────────── */
export function Layout({ children }) {
  const { user, logout, saAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() => localStorage.getItem(`hub_nav_compact_${user.id}`) === '1');
  const [dense, setDense] = useState(() => localStorage.getItem(`hub_density_${user.id}`) === 'compact');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const drawerRef = useRef(null);
  const location = useLocation();
  const currentPage = pageForPath(location.pathname);
  const currentTeams = saAccess.teams.map(team => team.name).join(', ');
  const availablePages = useMemo(() => visiblePages(user, saAccess.enabled).filter(page => !page.hidden), [user, saAccess.enabled]);
  const defaultPinnedIds = useMemo(() => primaryPages(user, saAccess.enabled, saAccess.capabilities).map(page => page.id), [user, saAccess.enabled, saAccess.capabilities]);
  const pinnedStorageKey = `hub_nav_pinned_${user.id}`;
  const recentStorageKey = `hub_nav_recent_${user.id}`;
  const pinsInitializedFromStorage = useRef(localStorage.getItem(pinnedStorageKey) !== null);
  const [pinnedIds, setPinnedIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(pinnedStorageKey) || 'null');
      return Array.isArray(saved) ? saved : defaultPinnedIds;
    } catch { return defaultPinnedIds; }
  });
  const [recentIds, setRecentIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recentStorageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const validPinnedIds = pinnedIds.filter(id => availablePages.some(page => page.id === id));
  const sidebarPages = validPinnedIds.map(id => availablePages.find(page => page.id === id)).filter(Boolean);

  const togglePinnedPage = id => {
    setPinnedIds(current => {
      const valid = current.filter(pageId => availablePages.some(page => page.id === pageId));
      const next = valid.includes(id) ? valid.filter(pageId => pageId !== id) : [...valid, id];
      localStorage.setItem(pinnedStorageKey, JSON.stringify(next));
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
    if (pinsInitializedFromStorage.current || !saAccess.loaded) return;
    setPinnedIds(defaultPinnedIds);
  }, [defaultPinnedIds, saAccess.loaded]);
  useEffect(() => {
    if (!currentPage || currentPage.hidden) return;
    setRecentIds(current => {
      const next = [currentPage.id, ...current.filter(id => id !== currentPage.id)].slice(0, 4);
      localStorage.setItem(recentStorageKey, JSON.stringify(next));
      return next;
    });
  }, [currentPage?.id, recentStorageKey]);
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
      if (e.key === 'Escape') { setOpen(false); setPaletteOpen(false); setLauncherOpen(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setLauncherOpen(false);
        setPaletteOpen(value => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const initials = user.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`layout operations-shell${compactNav ? ' nav-compact' : ''}${dense ? ' density-compact' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ModuleLauncher open={launcherOpen} pages={availablePages} pinnedIds={validPinnedIds}
        recentIds={recentIds} onTogglePin={togglePinnedPage} onClose={() => setLauncherOpen(false)} />
      {/* Desktop sidebar */}
      <aside ref={drawerRef} id="primary-navigation" className={`sidebar${open ? ' open' : ''}`} aria-label="Primary navigation"
        role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}
        aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open ? '' : undefined}>
        {mobile && open && <button className="drawer-close" type="button" onClick={() => setOpen(false)}><X size={18} /> Close navigation</button>}
        <SidebarContent user={user} logout={logout} onNav={() => setOpen(false)} pages={sidebarPages}
          compact={compactNav && !mobile} onOpenLauncher={() => { setOpen(false); setPaletteOpen(false); setLauncherOpen(true); }}
          onToggleCompact={toggleCompactNav} dense={dense} onToggleDensity={toggleDensity} />
      </aside>

      {/* Mobile overlay */}
      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

      {/* Mobile topbar */}
      <header className="topbar" inert={mobile && open ? '' : undefined}>
        <Hamburger open={open} onClick={() => setOpen(o => !o)} />
        <div className="topbar-logo">{PRODUCT_WORDMARK.prefix}<span>{PRODUCT_WORDMARK.suffix}</span></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          <QuickCreate user={user} serviceActivityEnabled={saAccess.enabled} capabilities={saAccess.capabilities} />
          <GlobalSearch />
          <HelpMenu role={user.role} />
          <NotificationBell />
          <NavLink to="/profile" className="topbar-user" style={{ textDecoration: 'none', color: 'inherit' }}>
            <strong>{initials}</strong><br />
            <span style={{ fontSize: 10 }}>{user.role}</span>
          </NavLink>
        </div>
      </header>

      <div className="main" inert={mobile && open ? '' : undefined}>
        {/* Desktop-only top bar */}
        <div className="desktop-topbar">
          <div className="workspace-context">
            <span className="workspace-section">{currentPage?.section || 'Workspace'}</span>
            <span className="workspace-page">{currentPage?.label || PRODUCT_NAME}</span>
          </div>
          {currentTeams && <span className="workspace-team" title={currentTeams}>{currentTeams}</span>}
          <button type="button" className="workspace-command" onClick={() => setPaletteOpen(true)} aria-label="Open page navigation">
            <Search size={15} aria-hidden="true" /> Go to a page <kbd>Ctrl K</kbd>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <QuickCreate user={user} serviceActivityEnabled={saAccess.enabled} capabilities={saAccess.capabilities} />
            <GlobalSearch />
            <HelpMenu role={user.role} />
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
