// UI capabilities mirror existing API permissions; the server remains authoritative.
const everyone = ['manager', 'engineer', 'planner', 'pm'];
export const PAGES = [
  // The sidebar shows every page a person can open, in this order, grouped by
  // section. Home and More have no heading. inMenu:false pages stay reachable
  // (links, Ctrl K) and light up their parent in the menu.
  // Engineers open My Work instead (Dashboard.jsx sends them there), so it is not in their menu.
  { id: 'dashboard', path: '/', label: 'Dashboard', section: 'Home', icon: 'LayoutDashboard', roles: everyone, notInMenuFor: ['engineer'], parent: 'myWork', description: 'Operational overview and work that needs attention' },
  { id: 'myWork', path: '/my-day', label: 'My Work', section: 'Home', icon: 'Zap', roles: ['engineer'], description: 'Your assignments, upcoming work and time tracking' },
  { id: 'calendar', path: '/calendar', label: 'Calendar', section: 'Home', icon: 'CalendarDays', roles: everyone, description: 'Plan project deadlines, tasks and maintenance visits' },
  { id: 'reminders', path: '/reminders', label: 'Reminders', section: 'Home', icon: 'BellRing', roles: everyone, description: 'Your own reminders, and the automatic ones the app sends you' },
  { id: 'projects', path: '/projects', label: 'Projects', section: 'Work', icon: 'FolderOpen', roles: ['manager', 'engineer', 'pm'], permission:'projects.access', description: 'Delivery progress, ownership and project commitments' },
  { id: 'tasks', path: '/tasks', label: 'Tasks', section: 'Work', icon: 'CheckSquare', roles: ['manager', 'engineer'], permission:'tasks.access', badge: 'tasks', description: 'Assigned tasks and operational follow-ups' },
  { id: 'visits', path: '/maintenance-visits', label: 'Maintenance Visits', section: 'Work', icon: 'Wrench', roles: everyone, permission:'visits.access', badge: 'visits', description: 'Customer visits, engineer assignments and reports' },
  { id: 'activities', path: '/activity-log', label: 'Activity Log', section: 'Work', icon: 'ClipboardList', roles: ['manager', 'engineer', 'pm'], permission:'service_activities.access', feature: 'serviceActivity', description: 'Customer service work, evidence and follow-ups' },
  { id: 'approvals', path: '/approvals', label: 'Approvals', section: 'Work', icon: 'CheckCheck', roles: ['manager'], permission: 'managed_reports.review', description: 'Review project closures and managed-service reports' },
  { id: 'customers', path: '/customers', label: 'Customers', section: 'Customers', icon: 'Building2', roles: ['manager', 'engineer'], permission:'customers.access', description: 'Customer profiles, service contracts and team access' },
  { id: 'responses', path: '/customer-responses', label: 'Customer Responses', section: 'Customers', icon: 'MessageSquare', roles: everyone, description: 'Track work waiting on customer responses' },
  { id: 'vulnerabilities', path: '/vulnerabilities', label: 'Vulnerabilities', section: 'Advisories', icon: 'ShieldAlert', roles: everyone, description: 'CVEs for the vendors and products we support, and which customer devices they affect' },
  { id: 'softwareVersions', path: '/software', label: 'Software versions', section: 'Advisories', icon: 'PackageCheck', roles: everyone, description: 'The latest and recommended versions of the products we support (FortiOS, Check Point Jumbo…), and vendor news' },
  { id: 'workload', path: '/workload', label: 'Workload', section: 'Team & performance', icon: 'UsersIcon', roles: ['manager'], description: 'Engineer commitments and upcoming demand' },
  { id: 'skills', path: '/skills', label: 'Skill matrix', section: 'Team & performance', icon: 'GraduationCap', roles: ['manager'], permission:'skills.view', description: 'What the team knows per technology, and where knowledge rests on one person' },
  { id: 'reports', path: '/reports', label: 'Reports', section: 'Team & performance', icon: 'BarChart2', roles: ['manager'], permission:'reports.access', description: 'Operational summaries, delivery trends and reporting' },
  { id: 'kpiManagement', path: '/kpis', label: 'KPI Management', section: 'Team & performance', icon: 'Gauge', roles: ['manager'], permission:'kpis.manage', description: 'Define, test and review management performance indicators' },
  { id: 'scorecards', path: '/scorecards', label: 'Scorecards', section: 'Team & performance', icon: 'Award', roles: ['manager'], description: 'Project delivery evaluations and engineer performance' },
  { id: 'sla', path: '/sla', label: 'SLA', section: 'Team & performance', icon: 'ShieldCheck', roles: ['manager'], description: 'Service commitments and exceptions requiring attention' },
  { id: 'notes', path: '/notes', label: 'My Notes', section: 'More', icon: 'StickyNote', roles: everyone, description: 'Your private scratchpad and personal to-do list' },
  { id: 'settings', path: '/settings', label: 'Settings', section: 'More', icon: 'Settings', roles: ['manager'], description: 'Business configuration, integrations and system settings' },
  { id: 'serviceOperations', path: '/service-operations', label: 'Service Activity Reports', section: 'Team & performance', icon: 'Activity', roles: ['manager'], permission:'reports.access', inMenu: false, parent: 'reports', description: 'Aggregated reporting over logged service activity — see Customer 360 for per-customer detail' },
  { id: 'users', path: '/settings/users', label: 'Users', section: 'More', icon: 'UsersIcon', roles: ['manager'], inMenu: false, parent: 'settings', description: 'User accounts and operational roles' },
  { id: 'templates', path: '/settings/project_templates', label: 'Project templates', section: 'More', icon: 'FileText', roles: ['manager'], inMenu: false, parent: 'settings', description: 'Reusable project structures and default tasks' },
  { id: 'search', path: '/search', label: 'Smart Search', section: 'Home', icon: 'Search', roles: everyone, hidden: true, description: 'Search the work and customers you can access' },
];

export function canAccessPage(page, userOrRole, serviceActivityEnabled = false) {
  const user=typeof userOrRole==='string' ? { role:userOrRole,permissions:{} } : userOrRole;
  const explicitlyConfigured=page?.permission && Object.prototype.hasOwnProperty.call(user?.permissions || {},page.permission);
  const roleOrPermission=explicitlyConfigured ? !!user.permissions[page.permission] : page?.roles.includes(user?.role);
  return !!page && !!user && roleOrPermission &&
    (!page.feature || user.role === 'manager' || serviceActivityEnabled);
}

export function visiblePages(userOrRole, serviceActivityEnabled = false) {
  return PAGES.filter(page => canAccessPage(page, userOrRole, serviceActivityEnabled));
}

export const MENU_SECTIONS = ['Home', 'Work', 'Customers', 'Advisories', 'Team & performance', 'More'];
export const UNTITLED_SECTIONS = new Set(['Home', 'More']);

// The sidebar: every page this person can open, grouped by section, in PAGES order.
export function menuGroups(userOrRole, serviceActivityEnabled = false) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  const pages = visiblePages(userOrRole, serviceActivityEnabled).filter(page => !page.hidden && page.inMenu !== false && !page.notInMenuFor?.includes(role));
  return MENU_SECTIONS.map(section => ({ section, titled: !UNTITLED_SECTIONS.has(section), pages: pages.filter(page => page.section === section) }))
    .filter(group => group.pages.length);
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

export function quickCreateActions(userOrRole, serviceActivityEnabled = false, capabilities = {}) {
  const user=typeof userOrRole==='string' ? { role:userOrRole,permissions:{} } : userOrRole;
  const role=user?.role;
  const managed=capabilities.managedServiceOperations===true;
  const order=role==='engineer' && managed ? ['activity','task','project','visit'] : ['task','project','visit','activity'];
  return QUICK_CREATE.filter(action => action.roles.includes(role))
    .map(action => ({ ...action, destination: PAGES.find(page => page.id === action.page) }))
    .filter(action => canAccessPage(action.destination, user, serviceActivityEnabled))
    .sort((left,right) => order.indexOf(left.id)-order.indexOf(right.id));
}
