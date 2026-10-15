import { useMemo, useState } from 'react';

/* Pick any number of items with tick boxes — easier than a multi-select list,
   where a plain click replaces the selection and adding needs Ctrl-click.
   Long lists get a search box; ticked items are listed first. */
export default function CheckList({ id, label, options, selected, onChange, disabled = false, emptyText = 'Nothing to choose from.', searchPlaceholder = 'Search…' }) {
  const [query, setQuery] = useState('');
  // Ticked-first order is fixed when the list opens, so items do not jump while ticking.
  const [initial] = useState(() => new Set(selected));
  const chosen = new Set(selected);
  const ordered = useMemo(() => [...options].sort((a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id))), [options, initial]);
  const term = query.trim().toLowerCase();
  const shown = term ? ordered.filter(option => `${option.label} ${option.detail || ''}`.toLowerCase().includes(term)) : ordered;
  const toggle = optionId => onChange(chosen.has(optionId) ? selected.filter(value => value !== optionId) : [...selected, optionId]);
  const setShown = on => {
    const ids = new Set(shown.map(option => option.id));
    onChange(on ? [...new Set([...selected, ...ids])] : selected.filter(value => !ids.has(value)));
  };
  return (
    <div className="checklist" role="group" aria-labelledby={id ? `${id}-label` : undefined} aria-label={id ? undefined : label}>
      <div className="checklist-bar">
        {options.length > 8 && <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`Search ${label}`} disabled={disabled} />}
        <span className="checklist-count">{chosen.size} selected</span>
        {shown.length > 1 && <>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setShown(true)}>{term ? 'Select shown' : 'Select all'}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || !chosen.size} onClick={() => setShown(false)}>{term ? 'Clear shown' : 'Clear'}</button>
        </>}
      </div>
      <ul className="checklist-items">
        {shown.map(option => (
          <li key={option.id}>
            <label className={chosen.has(option.id) ? 'is-on' : ''}>
              <input type="checkbox" checked={chosen.has(option.id)} disabled={disabled} onChange={() => toggle(option.id)} />
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </label>
          </li>
        ))}
        {!options.length && <li className="text-muted text-sm">{emptyText}</li>}
        {!!options.length && !shown.length && <li className="text-muted text-sm">No matches for “{query}”.</li>}
      </ul>
    </div>
  );
}
