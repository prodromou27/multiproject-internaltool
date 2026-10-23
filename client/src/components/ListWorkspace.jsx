import { Search, X } from 'lucide-react';

export function ListSearch({ value, onChange, placeholder, label = 'Search', maxLength, disabled = false }) {
  return <label className="list-search">
    <span className="sr-only">{label}</span>
    <Search size={15} aria-hidden="true" />
    <input value={value} maxLength={maxLength} disabled={disabled}
      onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    {value && <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label.toLowerCase()}`}>
      <X size={14} aria-hidden="true" />
    </button>}
  </label>;
}

export function FilterGroup({ label, children, className = '' }) {
  return <div className={`list-filter-group${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
    <span className="list-filter-label">{label}</span>
    <div className="filter-bar">{children}</div>
  </div>;
}

export function ResultContext({ shown, total, noun, activeFilters = 0, onClear }) {
  return <div className="list-result-context" aria-live="polite">
    <span><strong>{shown}</strong> of {total} {noun}</span>
    {activeFilters > 0 && <span className="list-filter-summary">{activeFilters} active filter{activeFilters === 1 ? '' : 's'}</span>}
    {activeFilters > 0 && onClear && <button type="button" onClick={onClear}>Reset view</button>}
  </div>;
}
