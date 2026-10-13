import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Database, LogOut, Moon, Rows3, Sun, Ticket, UserCircle } from 'lucide-react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';

/* Account menu in the top bar: profile and personal display preferences, the
   two external tools, and sign-out. Keeps the sidebar for navigation only. */
export default function UserMenu({ user, team, logout, dense, onToggleDensity }) {
  const { dark, toggleDark } = useAuth();
  const toast = useToast();
  const ref = useRef(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  const initials = user.name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    const onPointer = event => { if (ref.current?.open && !ref.current.contains(event.target)) close(); };
    const onKey = event => { if (event.key === 'Escape' && ref.current?.open) { close(); ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <details className="user-menu" ref={ref}>
      <summary aria-label="Account menu">
        <span className="user-menu-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : initials}</span>
        <span className="user-menu-who"><strong>{user.name}</strong><span>{team || user.role}</span></span>
      </summary>
      <div className="user-menu-panel">
        <Link to="/profile" onClick={close}><UserCircle size={15} aria-hidden="true" /> Profile and alerts</Link>
        <button type="button" onClick={() => { onToggleDensity(); close(); }}>
          <Rows3 size={15} aria-hidden="true" /> {dense ? 'Comfortable spacing' : 'Compact spacing'}
        </button>
        <button type="button" onClick={() => { toggleDark(); close(); }}>
          {dark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />} {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <hr />
        <a href="https://ts.odysseycs.com/" target="_blank" rel="noopener noreferrer" onClick={close}><Ticket size={15} aria-hidden="true" /> Odyssey Ticketing</a>
        <a href="https://9605283.app.netsuite.com" target="_blank" rel="noopener noreferrer" onClick={close}><Database size={15} aria-hidden="true" /> Netsuite</a>
        <hr />
        <button type="button" className="user-menu-signout"
          onClick={async () => { close(); try { await logout(); } catch (error) { toast.error(error.message || 'Unable to sign out'); } }}>
          <LogOut size={15} aria-hidden="true" /> Sign out
        </button>
      </div>
    </details>
  );
}
