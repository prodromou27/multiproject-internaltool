import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, X, Pin, PinOff, Clock3 } from 'lucide-react';
import { PAGE_ICONS } from './Sidebar';

export function ModuleLauncher({ open, pages, pinnedIds, recentIds, onTogglePin, onClose }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
    const trapFocus = event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;
  const normalizedQuery = query.trim().toLowerCase();
  const matches = pages.filter(page => !normalizedQuery ||
    `${page.label} ${page.section} ${page.description || ''}`.toLowerCase().includes(normalizedQuery));
  const sections = [...new Set(matches.map(page => page.section))];
  const recent = recentIds.map(id => pages.find(page => page.id === id)).filter(Boolean);

  return (
    <div className="module-launcher-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className="module-launcher" role="dialog" aria-modal="true" aria-labelledby="module-launcher-title"
        onMouseDown={event => event.stopPropagation()}>
        <header className="module-launcher-header">
          <div>
            <div className="module-launcher-kicker">Workspace directory</div>
            <h2 id="module-launcher-title">All modules</h2>
            <p>Open any area you can access. Pin the modules you use most to the navigation.</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close module launcher"><X size={19} /></button>
        </header>
        <label className="module-launcher-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Find a module</span>
          <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Find a module by name or purpose" />
        </label>
        {!normalizedQuery && recent.length > 0 && (
          <div className="module-recent">
            <span><Clock3 size={14} /> Recently opened</span>
            {recent.map(page => <NavLink key={page.id} to={page.path} onClick={onClose}>{page.label}</NavLink>)}
          </div>
        )}
        <div className="module-launcher-body">
          {sections.map(section => (
            <section className="module-group" key={section} aria-labelledby={`module-${section.toLowerCase().replaceAll(' ', '-')}`}>
              <h3 id={`module-${section.toLowerCase().replaceAll(' ', '-')}`}>{section}</h3>
              <div className="module-grid">
                {matches.filter(page => page.section === section).map(page => {
                  const Icon = PAGE_ICONS[page.icon];
                  const pinned = pinnedIds.includes(page.id);
                  return <article className="module-item" key={page.id}>
                    <NavLink to={page.path} onClick={onClose}>
                      <span className="module-icon"><Icon size={18} /></span>
                      <span><strong>{page.label}</strong><small>{page.description}</small></span>
                    </NavLink>
                    {page.id !== 'dashboard' && <button type="button" onClick={() => onTogglePin(page.id)}
                      aria-label={pinned ? `Unpin ${page.label}` : `Pin ${page.label}`}
                      title={pinned ? 'Remove from navigation' : 'Pin to navigation'}>
                      {pinned ? <PinOff size={15} /> : <Pin size={15} />}
                    </button>}
                  </article>;
                })}
              </div>
            </section>
          ))}
          {matches.length === 0 && <div className="module-launcher-empty">No modules match “{query.trim()}”.</div>}
        </div>
      </section>
    </div>
  );
}
