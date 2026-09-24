import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../auth';
import { PAGES } from '../navigation';
import { PAGE_ICONS } from './Sidebar';

const COMMANDS = [
  { label: 'Global search', action: 'search', icon: Search, roles: ['manager', 'engineer', 'planner', 'pm'] },
  ...PAGES.map(page => ({ ...page, label: page.label, path: page.path, icon: PAGE_ICONS[page.icon], requiresServiceActivity: !!page.feature })),
];

export function CommandPalette({ open, onClose }) {
  const { user, saAccess } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter(c =>
      c.roles.includes(user.role) &&
      (!c.requiresServiceActivity || user.role === 'manager' || saAccess?.enabled) &&
      (!q || c.label.toLowerCase().includes(q))
    );
  }, [query, user.role, saAccess?.enabled]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => setActive(0), [query]);
  if (!open) return null;

  function run(command) {
    if (!command) return;
    onClose();
    if (command.action === 'search') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('solutionshub:open-search')));
      return;
    }
    navigate(command.path);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, commands.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); run(commands[active]); }
  }

  return (
    <div className="command-backdrop" onMouseDown={onClose} role="presentation">
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={e => e.stopPropagation()}>
        <div className="command-input-row">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Go to a page or run a command…" aria-label="Search commands" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results" role="listbox">
          {commands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button key={command.path || command.action} type="button" role="option" aria-selected={index === active}
                className={`command-item${index === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(index)} onClick={() => run(command)}>
                <Icon size={17} /> <span>{command.label}</span><span className="command-hint">Open</span>
              </button>
            );
          })}
          {!commands.length && <div className="command-empty">No matching commands</div>}
        </div>
        <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span></div>
      </div>
    </div>
  );
}
