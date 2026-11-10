import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';

/* A customer picker that searches instead of loading every customer: type part of
   a name (or contact) and pick from the first 10 active matches. The server only
   offers customers this person may see. Keyboard: ↑/↓ to move, Enter to pick,
   Escape to close. `value` is a customer id (or ''/null). */
export default function CustomerSearchSelect({ id, value, onChange, emptyLabel = '— No customer —', allowEmpty = true, placeholder = 'Search customers…', required = false, disabled = false, label }) {
  const listId = useId();
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [typing, setTyping] = useState(false);
  const [results, setResults] = useState([]), [loading, setLoading] = useState(false), [active, setActive] = useState(0);
  const [selected, setSelected] = useState(null); // { id, name }
  const box = useRef(null);

  // The name of the chosen customer, when only its id is known.
  useEffect(() => {
    if (!value) { setSelected(null); return undefined; }
    if (selected && String(selected.id) === String(value)) return undefined;
    const controller = new AbortController();
    api.customer(value, { signal: controller.signal }).then(row => { if (!controller.signal.aborted) setSelected({ id: Number(row.id), name: row.name }); }).catch(() => {});
    return () => controller.abort();
  }, [value]);

  // Matches for what is typed (the first customers, alphabetically, when nothing is).
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api.pagedCustomers({ search: query.trim(), view: 'active', page_size: 10 }, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) { setResults((data.rows || []).map(row => ({ id: Number(row.id), name: row.name }))); setActive(0); } })
        .catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (box.current && !box.current.contains(event.target)) { setOpen(false); setTyping(false); } };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const options = [...(allowEmpty ? [{ id: '', name: emptyLabel }] : []), ...results];
  function choose(option) {
    setSelected(option.id === '' ? null : option);
    onChange(option.id === '' ? null : option.id, option.id === '' ? null : option);
    setOpen(false); setTyping(false); setQuery('');
  }
  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, options.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' && open && options[active]) { event.preventDefault(); choose(options[active]); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); setTyping(false); setQuery(''); }
  }

  const shown = typing ? query : (selected?.name || '');
  return <div className="customer-search-select" ref={box}>
    <input id={id} type="text" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      value={shown} placeholder={selected ? '' : placeholder} required={required && !value} disabled={disabled} autoComplete="off"
      onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
      onChange={event => { setTyping(true); setQuery(event.target.value); setOpen(true); }} />
    {open && <ul id={listId} role="listbox" className="customer-search-list">
      {options.map((option, index) => <li key={option.id || 'none'} id={`${listId}-${index}`} role="option" aria-selected={String(option.id) === String(value || '')}
        className={`${index === active ? 'is-active' : ''}${option.id === '' ? ' is-empty' : ''}`}
        onPointerDown={event => { event.preventDefault(); choose(option); }} onMouseEnter={() => setActive(index)}>{option.name}</li>)}
      {!loading && !results.length && <li className="customer-search-none" role="presentation">{query.trim() ? 'No customer matches' : 'No customers'}</li>}
      {loading && <li className="customer-search-none" role="presentation">Searching…</li>}
    </ul>}
  </div>;
}
