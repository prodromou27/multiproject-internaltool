// Answers the app's /api calls from fixtures, so browser tests need no backend.
// Every call is recorded in `calls` so tests can check what the app sent.
//
//   const api = await mockApi(page, { role: 'engineer' });
//   api.override('GET /api/tasks', () => ({ status: 500, body: { error: 'boom' } }));
//   expect(api.calls.filter(c => c.method === 'POST')).toHaveLength(1);

const ALEX = { id: 1, name: 'Alex Mercer', email: 'alex@example.com' };

const statuses = [
  { value: 'planned', label: 'Planned', bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', is_terminal: false },
  { value: 'in_progress', label: 'In Progress', bg: '#fef9c3', text: '#854d0e', dot: '#eab308', is_terminal: false },
  { value: 'completed', label: 'Completed', bg: '#dcfce7', text: '#166534', dot: '#22c55e', is_terminal: true },
];

const meta = {
  categories: [{ id: 1, name: 'Support', subcategories: [] }, { id: 2, name: 'Troubleshooting', subcategories: [] }],
  technologies: [{ id: 1, name: 'Firewall' }],
  statuses,
  customers: [{ id: 1, name: 'Northwind Logistics' }, { id: 2, name: 'Contoso Retail' }],
  settings: { allow_attachments: true, allow_follow_up_task_creation: true },
};

const tasks = [
  { id: 1, project_id: 1, title: 'Renew firewall support contract', status: 'in_progress', priority: 'high', deadline: '2026-09-25', assigned_to: 1, assigned_to_name: 'Alex Mercer', is_adhoc: 0, logged_hours: 3.5 },
  { id: 2, project_id: null, title: 'Update VPN runbook', status: 'planned', priority: 'low', deadline: null, assigned_to: 1, assigned_to_name: 'Alex Mercer', is_adhoc: 1, logged_hours: 0 },
];

// report_sent and report_sent_to_customer are 0/1 integers, as the database returns them.
const visits = [
  { id: 1, title: 'Quarterly firewall check', customer_id: 1, customer_name: 'Northwind Logistics', engineer_ids: [1], engineer_names: 'Alex Mercer', scheduled_date: '2026-09-24', status: 'scheduled', report_sent: 0, report_sent_to_customer: 0 },
  { id: 2, title: 'Switch stack upgrade', customer_id: 2, customer_name: 'Contoso Retail', engineer_ids: [1], engineer_names: 'Alex Mercer', scheduled_date: '2026-10-02', status: 'scheduled', report_sent: 0, report_sent_to_customer: 0 },
];

const calendar = {
  tasks: [{ id: 1, type: 'task', title: 'Renew firewall support contract with a deliberately long title', date: '2026-09-25', status: 'in_progress', priority: 'high' }],
  projects: [], visits: [],
};

export async function mockApi(page, { role = 'engineer', signedIn = true, teams = [{ id: 1, name: 'Security Team', service_activity_enabled: 1 }], permissions } = {}) {
  const calls = [];
  const overrides = new Map();
  const user = { ...ALEX, role, ...(permissions ? { permissions } : {}) };

  const routes = {
    'GET /api/auth/me': () => signedIn ? { body: user } : { status: 401, body: { error: 'Not signed in' } },
    'POST /api/auth/login': () => ({ body: { user } }),
    'POST /api/auth/logout': () => ({ body: {} }),
    'GET /api/notifications': () => ({ body: { notifications: [], unread: 0 } }),
    'GET /api/tasks/overdue-counts': () => ({ body: { tasks: 0, visits: 0 } }),
    'GET /api/teams/mine': () => ({ body: { service_activity_enabled: teams.length > 0, teams } }),
    'GET /api/statuses': () => ({ body: { project: [], task: [], visit: [], service_activity: statuses } }),
    // The server pages tasks only when asked to (page or page_size in the query).
    'GET /api/tasks': ({ request }) => {
      const params = new URL(request.url()).searchParams;
      return { body: params.has('page') || params.has('page_size') ? { total: tasks.length, counts: { all: tasks.length, mine: tasks.length }, rows: tasks } : tasks };
    },
    'GET /api/operations/overview': () => ({ body: {
      scope: role === 'manager' ? 'management' : 'personal', as_of: '2026-09-21',
      tasks: { overdue: 0, due_today: 0, attention: [] },
      projects: { overdue: 0, awaiting_approval: 0, commitments: [] },
      visits: { reports_pending: 0, upcoming: 0, reports: [], upcoming_items: [] },
      service: { enabled: false, due: 0, follow_ups: [] },
    } }),
    'GET /api/reports/summary': () => ({ body: { total: 0, overdue: 0, byStatus: [], engineerLoad: [], pendingClosure: [], kpiHealth: [], taskStats: {} } }),
    'GET /api/projects': () => ({ body: [] }),
    'GET /api/users': () => ({ body: [] }),
    'GET /api/customers': () => ({ body: [] }),
    'GET /api/maintenance-visits': () => ({ body: visits }),
    'GET /api/calendar': () => ({ body: calendar }),
    'GET /api/service-activities/meta': () => ({ body: meta }),
    'GET /api/service-activities': () => ({ body: { rows: [], total: 0, page: 1, page_size: 25 } }),
    'POST /api/service-activities': () => ({ status: 201, body: { id: 100 } }),
  };

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    let body;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    calls.push({ method: request.method(), path: url.pathname, query: url.search, body });

    const handler = overrides.get(key) || routes[key];
    const result = handler ? handler({ request, body }) : { body: [] };
    await route.fulfill({
      status: result.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(result.body ?? {}),
    });
  });

  return {
    calls,
    user,
    override: (key, handler) => overrides.set(key, handler),
  };
}
