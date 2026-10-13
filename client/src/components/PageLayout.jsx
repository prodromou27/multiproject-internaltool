import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ArrowLeft, AlertCircle, MoreHorizontal } from 'lucide-react';

/* One heading per page. `meta` is an optional short fact about the view (the date,
   the sort order), not a tagline restating the title. */
export function PageHeader({ title, meta, actions }) {
  return <header className="operations-page-header">
    <div>
      <h1>{title}</h1>
      {meta && <p className="operations-description">{meta}</p>}
    </div>
    {actions && <div className="operations-page-actions">{actions}</div>}
  </header>;
}

export function PageState({ title, description, children }) {
  return <div className="page"><section className="operations-page-state" aria-labelledby="page-state-title">
    <AlertCircle size={32} aria-hidden="true" />
    <h1 id="page-state-title">{title}</h1>
    <p>{description}</p>
    {children || <Link to="/" className="btn btn-primary"><ArrowLeft size={16} /> Back to dashboard</Link>}
  </section></div>;
}

/* The page's less frequent actions (export, import, related pages) behind one
   "⋯" button, so the header shows only the main action. Children are links or
   buttons; choosing one closes the menu. */
export function HeaderMenu({ label = 'More actions', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = event => { if (ref.current?.open && (event.type === 'pointerdown' ? !ref.current.contains(event.target) : event.key === 'Escape')) ref.current.open = false; };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  return <details className="header-menu" ref={ref}>
    <summary className="btn btn-ghost" aria-label={label} title={label}><MoreHorizontal size={16} aria-hidden="true" /></summary>
    <div className="header-menu-panel" onClick={event => { if (event.target.closest('a,button')) ref.current.open = false; }}>{children}</div>
  </details>;
}
