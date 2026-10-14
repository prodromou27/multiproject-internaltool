import { AlertTriangle, RefreshCw } from 'lucide-react';

/* A part of a page that could not be loaded, with Retry. Used instead of showing
   empty or default values, which would look like real (editable) data. */
export function LoadError({ what, error, onRetry, compact = false }) {
  return <div className={`load-error${compact ? ' is-compact' : ''}`} role="alert">
    <AlertTriangle size={compact ? 13 : 15} aria-hidden="true" />
    <span><strong>{what} could not be loaded.</strong>{error ? ` ${error}` : ''}{compact ? '' : ' Nothing was changed.'}</span>
    {onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Retry</button>}
  </div>;
}
