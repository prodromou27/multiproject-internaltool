import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="operations-page-header">
    <div>
      {eyebrow && <p className="operations-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="operations-description">{description}</p>}
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
