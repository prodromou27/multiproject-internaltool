import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2, Award, BarChart2, UsersIcon, Settings, Search, MessageSquare, CheckCheck, ClipboardList, FileText, StickyNote, UserCircle, ShieldCheck, Zap, Activity, BellRing, Grid3X3, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { api } from '../api';
import { PRODUCT_WORDMARK } from '../product';
import { useLiveRefresh } from '../live';

/* ── Hamburger icon ──────────────────────────────────────── */
export function Hamburger({ open, onClick }) {
  return (
    <button className="hamburger" onClick={onClick} aria-label="Toggle menu" aria-expanded={open} aria-controls="primary-navigation">
      <span className={[(open ? 'u-b055aea' : 'u-e480998')].filter(Boolean).join(' ')} />
      <span className={[(open ? 'u-8d919cb' : 'u-c6e7979')].filter(Boolean).join(' ')} />
      <span className={[(open ? 'u-58b808c' : 'u-e480998')].filter(Boolean).join(' ')} />
    </button>
  );
}

/* ── Sidebar content ─────────────────────────────────────── */
export const PAGE_ICONS = { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2,
  Award, BarChart2, UsersIcon, Settings, Search, ClipboardList, FileText, StickyNote,
  UserCircle, MessageSquare, ShieldCheck, Zap, Activity, CheckCheck, BellRing };

function OverdueDot({ count }) {
  if (!count) return null;
  return (
    <span className="sidebar-overdue-count u-ffa914c">{count > 99 ? '99+' : count}</span>
  );
}

export function SidebarContent({ onNav, pages, compact, onOpenLauncher, onToggleCompact }) {

  const [overdue, setOverdue] = useState({ tasks: 0, visits: 0 });
  useLiveRefresh(() => api.overdueCounts().then(setOverdue).catch(() => {}));
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

      {/* Main nav */}
      <nav className="sidebar-primary-nav" aria-label="Pinned modules">
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

      {/* Footer: only the rail toggle. Account, display preferences and external
          tools live in the account menu in the top bar. */}
      <div className="sidebar-footer">
        <button onClick={onToggleCompact} className="sidebar-collapse" title={compact ? 'Expand navigation' : 'Collapse navigation'}>
          {compact ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          <span>{compact ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </>
  );
}
