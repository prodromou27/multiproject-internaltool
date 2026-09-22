// UI capabilities mirror existing API permissions; the server remains authoritative.
const everyone = ['manager', 'engineer', 'planner', 'pm'];
export const PAGES = [
  { id: 'dashboard', path: '/', label: 'Dashboard', section: 'Workspace', icon: 'LayoutDashboard', roles: everyone, description: 'Operational overview and work that needs attention' },
  { id: 'myWork', path: '/my-day', label: 'My Work', section: 'Workspace', icon: 'Zap', roles: ['engineer'], description: 'Your assignments, upcoming work and time tracking' },
  { id: 'calendar', path: '/calendar', label: 'Calendar', section: 'Workspace', icon: 'CalendarDays', roles: everyone, description: 'Plan project deadlines, tasks and maintenance visits' },
  { id: 'projects', path: '/projects', label: 'Projects', section: 'Operations', icon: 'FolderOpen', roles: ['manager', 'engineer', 'pm'], description: 'Delivery progress, ownership and project commitments' },
  { id: 'tasks', path: '/tasks', label: 'Tasks', section: 'Operations', icon: 'CheckSquare', roles: ['manager', 'engineer'], badge: 'tasks', description: 'Assigned tasks and operational follow-ups' },
  { id: 'visits', path: '/maintenance-visits', label: 'Maintenance Visits', section: 'Operations', icon: 'Wrench', roles: everyone, badge: 'visits', description: 'Customer visits, engineer assignments and reports' },
  { id: 'activities', path: '/activity-log', label: 'Activity Log', section: 'Operations', icon: 'ClipboardList', roles: ['manager', 'engineer', 'pm'], feature: 'serviceActivity', description: 'Customer service work, evidence and follow-ups' },
  { id: 'customers', path: '/customers', label: 'Customers', section: 'Management', icon: 'Building2', roles: ['manager'], description: 'Customer profiles, service contracts and team access' },
  { id: 'managedCustomers', path: '/managed-customers', label: 'Managed Customers', section: 'Management', icon: 'Building2', roles: ['manager'], permission: 'managed_customers.view', description: 'Customer-centric managed-service health, tickets and reporting' },
  { id: 'workload', path: '/workload', label: 'Workload', section: 'Management', icon: 'UsersIcon', roles: ['manager'], description: 'Engineer commitments and upcoming demand' },
  { id: 'reports', path: '/reports', label: 'Reports', section: 'Management', icon: 'BarChart2', roles: ['manager'], description: 'Operational summaries, delivery trends and reporting' },
  { id: 'approvals', path: '/approvals', label: 'Approvals', section: 'Management', icon: 'CheckCheck', roles: ['manager'], permission: 'managed_reports.review', description: 'Review project closures and managed-service reports' },
  { id: 'scorecards', path: '/scorecards', label: 'Scorecards', section: 'Management', icon: 'Award', roles: ['manager'], description: 'Project delivery evaluations and engineer performance' },
  { id: 'serviceOperations', path: '/service-operations', label: 'Service Activity Reports', section: 'Management', icon: 'Activity', roles: ['manager'], description: 'Aggregated reporting over logged service activity — see Managed Customers for per-customer detail' },
  { id: 'sla', path: '/sla', label: 'SLA', section: 'Management', icon: 'ShieldCheck', roles: ['manager'], description: 'Service commitments and exceptions requiring attention' },
  { id: 'templates', path: '/templates', label: 'Templates', section: 'Administration', icon: 'FileText', roles: ['manager'], description: 'Reusable project structures and default tasks' },
  { id: 'users', path: '/users', label: 'Users', section: 'Administration', icon: 'UsersIcon', roles: ['manager'], description: 'User accounts and operational roles' },
  { id: 'settings', path: '/settings', label: 'Settings', section: 'Administration', icon: 'Settings', roles: ['manager'], description: 'Business configuration, integrations and system settings' },
  { id: 'notes', path: '/notes', label: 'My Notes', section: 'Personal', icon: 'StickyNote', roles: everyone, description: 'Your private scratchpad and personal to-do list' },
  // Profile is deliberately not a nav-list entry — it's already one click away
  // via the account avatar in the sidebar and top bar, on both desktop and mobile.
  { id: 'responses', path: '/customer-responses', label: 'Customer Responses', section: 'Personal', icon: 'MessageSquare', roles: everyone, description: 'Track work waiting on customer responses' },
  { id: 'search', path: '/search', label: 'Smart Search', section: 'Workspace', icon: 'Search', roles: everyone, hidden: true, description: 'Search the work and customers you can access' },
];

export function canAccessPage(page, userOrRole, serviceActivityEnabled = false) {
  const user=typeof userOrRole==='string' ? { role:userOrRole,permissions:{} } : userOrRole;
  return !!page && !!user && (page.roles.includes(user.role) || !!user.permissions?.[page.permission]) &&
    (!page.feature || user.role === 'manager' || serviceActivityEnabled);
}

export function visiblePages(userOrRole, serviceActivityEnabled = false) {
  return PAGES.filter(page => canAccessPage(page, userOrRole, serviceActivityEnabled));
}

export function pageForPath(pathname) {
  return PAGES.filter(page => pathname === page.path ||
    (page.path !== '/' && pathname.startsWith(`${page.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export const QUICK_CREATE = [
  { id: 'project', page: 'projects', label: 'New Project', hint: 'Plan a customer delivery', roles: ['manager'] },
  { id: 'task', page: 'tasks', label: 'New Task', hint: 'Create an assigned piece of work', roles: ['manager', 'engineer'] },
  { id: 'visit', page: 'visits', label: 'Schedule Visit', hint: 'Plan customer maintenance', roles: ['manager', 'planner'] },
  { id: 'activity', page: 'activities', label: 'Log Activity', hint: 'Record customer service work', roles: ['manager', 'engineer', 'pm'] },
];

export function quickCreateActions(role, serviceActivityEnabled = false) {
  return QUICK_CREATE.filter(action => action.roles.includes(role))
    .map(action => ({ ...action, destination: PAGES.find(page => page.id === action.page) }))
    .filter(action => canAccessPage(action.destination, role, serviceActivityEnabled));
}
