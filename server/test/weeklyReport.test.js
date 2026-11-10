const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReportHtml } = require('../weeklyReport');
test('weekly HTML previews escape stored titles, names, contacts and status labels', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const row = { title: attack,name: attack,customer_name: attack,project_title: attack,assigned_to: attack,assigned_to_name: attack,engineer_names: attack,contact_name: attack,contact_email: attack,status: attack,priority: 'high',open_tasks: 0,high_tasks: 0,done_this_week: 0,overdue_tasks: 0,project_count: 0 };
  const html = buildReportHtml({
    generatedAt: new Date('2026-09-18T09:00:00Z'),period: { from: '2026-09-11',to: '2026-09-25' },
    stats: { activeProjects: 0,openTasks: 0,overdueProjects: 0,pendingClosure: 0 },
    projectsOpened: [row],upcomingDeadlines: [row],highPriorityTasks: [row],maintenanceVisits: [row],reportsPending: [row],engineerWorkload: [row],closurePending: [row],newCustomers: [row],
    slaSnapshot: { mvReportBreaches: 0,closureBreaches: 0,highTaskBreaches: 0 },
  });
  assert.equal(html.includes(attack),false);
  assert.equal(html.includes('<img'),false);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});
