import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, FolderOpen, CheckSquare, Wrench, Building2, Award, BarChart2, UsersIcon, Settings, Search, MessageSquare, CheckCheck, ClipboardList, FileText, StickyNote, UserCircle, ShieldCheck, Zap, Activity, BellRing, ShieldAlert, PackageCheck, GraduationCap, Gauge, ListChecks, Clock, CalendarClock, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { api } from '../api';
import { PRODUCT_WORDMARK } from '../product';
import { pageZoom } from '../utils/zoom';
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
  UserCircle, MessageSquare, ShieldCheck, ShieldAlert, PackageCheck, GraduationCap, Gauge, ListChecks, Clock, CalendarClock, Zap, Activity, CheckCheck, BellRing };

function OverdueDot({ count }) {
  if (!count) return null;
  return (
    <span className="sidebar-overdue-count u-ffa914c">{count > 99 ? '99+' : count}</span>
  );
}

export function SidebarContent({ onNav, groups, currentPage, compact, collapsed, onToggleGroup, onToggleCompact }) {

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

  const link = page => {
    const Icon = PAGE_ICONS[page.icon];
    const childActive = currentPage?.parent === page.id;
    return <NavLink key={page.id} to={page.path} end={page.path === '/'} onClick={onNav}
      className={({ isActive }) => (isActive || childActive ? 'active' : undefined)}
      aria-current={childActive ? 'page' : undefined}
      title={compact ? page.label : undefined} aria-label={compact ? page.label : undefined}>
      <Icon size={18} aria-hidden="true" /> <span>{page.label}</span>
      <OverdueDot count={overdue[page.badge]} />
    </NavLink>;
  };
  const more = groups.find(group => group.section === 'More');

  // Keep the current page in view when the menu is longer than the screen.
  useEffect(() => {
    // Scroll only the menu itself (scrollIntoView would also move the page and
    // the keyboard's starting point), and only when the menu is on screen.
    const nav = document.querySelector('.sidebar-primary-nav'), active = nav?.querySelector('a.active');
    if (!nav || !active || !nav.offsetParent) return;
    const box = nav.getBoundingClientRect(), item = active.getBoundingClientRect();
    const z = pageZoom(); // screen pixels → the menu's own (zoomed) pixels
    if (item.top < box.top) nav.scrollTop -= (box.top - item.top) / z;
    else if (item.bottom > box.bottom) nav.scrollTop += (item.bottom - box.bottom) / z;
  }, [currentPage?.id]);

  return (
    <>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">
          <img src="/logo.png" alt="Odyssey" className="u-94aaddb" />
        </div>
        <span className="sidebar-brand-name">{PRODUCT_WORDMARK.prefix}<strong>{PRODUCT_WORDMARK.suffix}</strong></span>
        {/* The rail toggle sits by the logo, so the menu keeps its height for pages. */}
        <button type="button" onClick={onToggleCompact} className="sidebar-rail-toggle" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} title={compact ? 'Expand navigation' : 'Collapse navigation'}>
          {compact ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Main nav: every page this person can open, in short groups. A group
          can be folded away, except the one holding the current page. */}
      <nav className="sidebar-primary-nav" aria-label="Main">
        {groups.filter(group => group.section !== 'More').map(group => {
          const id = `nav-${group.section.toLowerCase().replace(/[^a-z]+/g, '-')}`;
          const holdsCurrent = group.pages.some(page => page.id === currentPage?.id || page.id === currentPage?.parent);
          const folded = group.titled && !compact && collapsed.includes(group.section) && !holdsCurrent;
          return <div key={group.section} className={`sidebar-group${group.titled ? '' : ' is-untitled'}`}>
            {group.titled && !compact && <button type="button" className="sidebar-group-toggle" aria-expanded={!folded} aria-controls={id}
              onClick={() => onToggleGroup(group.section)} disabled={holdsCurrent}>
              <span>{group.section}</span><ChevronDown size={14} aria-hidden="true" />
            </button>}
            <div id={id} hidden={folded}>
              {group.pages.map(link)}
            </div>
          </div>;
        })}
      </nav>

      {/* Footer: notes and settings, always in view. Account, display preferences and
          external tools live in the account menu in the top bar. */}
      {more && <div className="sidebar-footer">
        <nav className="sidebar-more-nav" aria-label="Notes and settings">{more.pages.map(link)}</nav>
      </div>}
    </>
  );
}
