import { Link } from 'react-router-dom';

/* What a task belongs to: its project or, without one, its customer. A link when
   this person can open that page (the server says, on each task). */
export default function TaskOrigin({ task }) {
  const onProject = !!task.project_id;
  const name = onProject ? task.project_title : task.customer_name;
  if (!name) return null;
  const canOpen = onProject ? task.can_open_project !== false : task.can_open_customer !== false;
  const to = onProject ? `/projects/${task.project_id}` : `/customers/${task.customer_id}/service-profile`;
  return <span className="text-sm">
    <span className="text-muted">{onProject ? 'Project' : 'Customer'}: </span>
    {canOpen ? <Link to={to}>{name}</Link> : name}
  </span>;
}
