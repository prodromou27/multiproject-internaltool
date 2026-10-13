import { NavLink } from 'react-router-dom';

/* Advisories is one item in the menu; this switches between its two pages. */
export default function AdvisoryNav() {
  return <nav className="advisory-nav" aria-label="Advisories">
    <NavLink to="/vulnerabilities">Vulnerabilities</NavLink>
    <NavLink to="/software">Software versions</NavLink>
  </nav>;
}
