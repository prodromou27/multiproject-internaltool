import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, FolderOpen, CheckSquare, Wrench, ClipboardList } from 'lucide-react';
import { quickCreateActions } from '../navigation';

const icons = { project: FolderOpen, task: CheckSquare, visit: Wrench, activity: ClipboardList };

export default function QuickCreate({ user, serviceActivityEnabled, capabilities }) {
  const role = user?.role;
  const actions = quickCreateActions(user, serviceActivityEnabled, capabilities);
  const ref = useRef(null);
  const location = useLocation();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [location.pathname, location.search]);
  useEffect(() => {
    const outside = event => { if (ref.current && !ref.current.contains(event.target)) ref.current.open = false; };
    const escape = event => {
      if (event.key !== 'Escape' || !ref.current?.open) return;
      const focusedInside = ref.current.contains(document.activeElement);
      ref.current.open = false;
      if (focusedInside) ref.current.querySelector('summary').focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  if (!actions.length) return null;
  return <details className="quick-create" ref={ref}>
    <summary className="btn btn-primary" aria-label="Create new work"><Plus size={16} aria-hidden="true" /> New</summary>
    <div className="quick-create-panel" role="group" aria-label="Create new work">
      <p className="quick-create-title">Create work</p>
      {actions.map(action => {
        const Icon = icons[action.id];
        return <Link key={action.id} to={`${action.destination.path}?create=1`} onClick={() => { ref.current.open = false; }}>
          <Icon size={18} aria-hidden="true" />
          <span><strong>{action.label}</strong><small>{role === 'engineer' && action.id === 'task' ? 'Add a task to your assigned project' : action.hint}</small></span>
        </Link>;
      })}
    </div>
  </details>;
}
