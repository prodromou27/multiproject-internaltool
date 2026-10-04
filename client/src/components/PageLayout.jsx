import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';

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
