import { NavLink } from 'react-router-dom';
import { placedPages } from '../navigation';
import { PAGE_ICONS } from './Sidebar';

/* Calendar and Reminders: one click from anywhere, without a place in the menu. */
export default function TopbarLinks({ user, serviceActivityEnabled }) {
  return placedPages('topbar', user, serviceActivityEnabled).map(page => {
    const Icon = PAGE_ICONS[page.icon];
    return <NavLink key={page.id} to={page.path} className={({ isActive }) => `topbar-action${isActive ? ' is-active' : ''}`} aria-label={page.label} title={page.label}>
      <Icon size={17} aria-hidden="true" />
    </NavLink>;
  });
}
