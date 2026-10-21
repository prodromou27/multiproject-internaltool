/*
 * The in-app help (Help page, and the ? button for the page you are on). One topic per
 * area of the app: what it is for and how to do the common things. `roles` limits a
 * topic to those roles (all when absent); `paths` are the pages it explains, so the ?
 * button can open it. Text may use **bold**. Keep names exactly as the screens show them.
 */
export const HELP_TOPICS = [
  {
    id: 'getting-started', title: 'Getting started', group: 'Basics', paths: ['/'],
    summary: 'Find your way around: the menu, search, creating work and your own settings.',
    sections: [
      { heading: 'Finding things', items: [
        'The menu on the left shows every page you can open. What you see depends on your role and team.',
        'Press **Ctrl K** (or the search box at the top) to find a page, customer, asset (by serial or host name), task or project.',
        'The **?** button at the top opens help for the page you are on.',
      ] },
      { heading: 'Creating work', items: [
        '**New** at the top creates a task, project, maintenance visit or activity from anywhere. Managed-services team members get **Log Activity** first.',
        'Forms keep an unsaved draft: if you close one by mistake, it offers to restore what you typed.',
      ] },
      { heading: 'Your own settings', items: [
        'Click your name at the top right → **Profile**: password, two-factor authentication, display size and where your notifications go.',
        '**Display size** (Profile) makes the whole app smaller or larger: 80%, 90% (the default), 100% or 110%.',
      ] },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard and My Work', group: 'Basics', paths: ['/', '/my-day', '/my-time'],
    summary: 'What needs attention today, your assignments, and the hours you logged.',
    sections: [
      { heading: 'Dashboard', items: [
        'Shows the work that needs attention: overdue and due tasks, upcoming visits, reports to review and, for managers, the whole operation with charts.',
        'Every figure links to the list behind it.',
      ] },
      { heading: 'My Work (engineers)', items: [
        'Your tasks, subtasks, visits and follow-ups in one place, soonest first, with a timer for the work you are doing.',
      ] },
      { heading: 'My time', items: [
        'The hours you logged, day by day, to fill in the company timesheet. Meetings and other work can be added too.',
      ] },
    ],
  },
  {
    id: 'customers', title: 'Customers and Customer 360', group: 'Customers', paths: ['/customers'],
    summary: 'Customer records, and everything about one customer on its Customer 360 page.',
    sections: [
      { heading: 'The customer list', items: [
        'In-house infrastructure (your own organisation\'s systems) is listed first, then customers by name.',
        'A customer may have a **Project name** (a nickname) shown beside its name and found by search.',
        'Several contracts show as the current one and "+N more".',
        'Managers create, edit, archive and import customers. **Archive** keeps the history and can be undone.',
        'Mark a customer as **in-house infrastructure** to track work on your own systems; several entries can be in-house.',
        'A customer is served by its **Assigned Team(s)** (add whole teams), and by **Engineers from other teams** added one by one in the customer form. They see the customer, its tasks and assets, and log its activities under their own team.',
        '**Export customers** (in the **More actions** menu at the top right of Customers; managers and planners): Excel or CSV, with the primary contact (one row per customer) or every contact (one row per contact), and archived customers if you choose.',
      ] },
      { heading: 'Contacts', items: [
        'A customer can have any number of contacts: open it, and on **Overview** use **Contacts → Add contact** (name, role, email, phone, notes).',
        'One contact is the **primary** one: it is the contact on the customer record, in reports and in search. **Make primary** changes it; the contact fields in the customer form edit the primary contact.',
        'Everyone who can open the customer sees its contacts; managers and planners add, change and remove them.',
      ] },
      { heading: 'Customer 360', items: [
        'Open a customer to see its tabs: **Overview, Service Activities, Tasks, Tickets, Projects, Recommendations, Assets, Contracts & licences, Vendor cases, Maintenance Visits, Reports, Timeline** and **Service Configuration**. Which ones you see depends on your role and the customer.',
        '**Add** (top right) creates a task, visit, activity, reminder or recommendation for this customer.',
        'Managers: **Service Configuration** sets the responsible team and its members, **engineers from other teams**, and **which tabs the customer page shows** (Overview and Service Configuration always stay). Hiding a tab tidies the page; it does not change who may see what.',
      ] },
      { heading: 'Assets', items: [
        'Add devices and services (firewalls, Microsoft 365, access points…). Only a name and type are required; **More details** has the rest.',
        '**Count** adds several identical assets at once (e.g. 5 access points), each with its own serial number if you have them.',
        'Assets covered by a contract show it automatically; files (diagrams, configuration exports) can be attached to each asset.',
      ] },
      { heading: 'Contracts, licences and vendor cases', items: [
        'Contracts hold the reference, dates, type and covered assets. A manager marks a contract **renewed** when it is.',
        'Licences, subscriptions and certificates with an expiry date remind the right people before they expire.',
        'Vendor cases track a case opened with a vendor (e.g. a TAC case) until it is closed.',
      ] },
    ],
  },
  {
    id: 'activity-log', title: 'Logging service activities', group: 'Work', paths: ['/activity-log'], roles: ['manager', 'engineer', 'pm'],
    summary: 'Record the customer service work you do, as it happens.',
    sections: [
      { heading: 'Log an activity', items: [
        '**New → Log Activity**, or **Log activity** on the Activity Log page: choose the customer, category, date and time spent, and describe the work.',
        'Link the assets you worked on, a ticket number and the technology. Your team\'s settings decide which fields are required.',
        'Files (screenshots, exports) can be attached when an administrator allows it.',
        'You can also log an activity by chatting with the bot in Webex or Teams: see **Chat bot (Webex and Teams)**.',
      ] },
      { heading: 'Finding and reporting', items: [
        'Filter by customer, category, dates or status, and export to Excel.',
        'Managers see everyone\'s activities; **Reports → Service Activity Reports** totals them across customers.',
      ] },
    ],
  },
  {
    id: 'tasks', title: 'Tasks', group: 'Work', paths: ['/tasks'], roles: ['manager', 'engineer'],
    summary: 'Create tasks, share them, follow them up with updates, subtasks and files.',
    sections: [
      { heading: 'Creating a task', items: [
        '**New → New Task**, or **Add task** on a customer\'s Tasks tab. Engineers choose the customer or project it is for.',
        'Give it to one engineer, or to a **team**: everyone in the team sees it, and whoever starts or completes it takes it.',
        '**Also working on it** adds other engineers: they see the task as theirs and can update it, post updates and attach files. The assignee stays the lead.',
      ] },
      { heading: 'Following it up', items: [
        'Open a task to change its status, due date and people, tick its **subtasks**, post **updates** and attach **files**.',
        'Each subtask can be given to an engineer (**Assign an engineer…** beside it) with its own due date; they see it in My Work and can tick it off. This works in every task window, including a project\'s tasks.',
        'A task with open subtasks cannot be completed; completing the last subtask completes the task.',
        '**Waiting for the customer / vendor** asks what you are waiting for, and shows it on the task.',
        'In an update, type **@** and a name to tag a colleague; they are told.',
        'Posting an update or attaching a file in **Edit Task** also saves your other changes, so closing the window loses nothing.',
        '**Take** an unassigned task, or take one over from a colleague (who is told): engineers for their customers, managers for any task. Managers can also choose **Me** under **Assigned to**.',
      ] },
      { heading: 'Recurring tasks', items: [
        'On a customer\'s Tasks tab, managers set up tasks that repeat (weekly, monthly, quarterly…) for an engineer or a team.',
      ] },
    ],
  },
  {
    id: 'projects', title: 'Projects', group: 'Work', paths: ['/projects'], roles: ['manager', 'engineer', 'pm'],
    summary: 'Customer deliveries: their tasks, progress, milestones and closure.',
    sections: [
      { heading: 'Creating a project (managers)', items: [
        '**New → New Project**. Required: **Project ID** (your own reference, unique), **Project name**, **Description**, **Start date** and at least one engineer. The deadline is optional.',
        'Project templates (Settings → Templates) create a project with its usual tasks.',
      ] },
      { heading: 'Running it', items: [
        'The project page has its tasks (list, board or Gantt), milestones, files, updates and KPIs.',
        'When the work is done, **Submit for Closure**: a manager approves or returns it under **Approvals**.',
        'Managers edit the project from **Edit**, where **Delete project** removes it for good (type its Project ID to confirm).',
      ] },
    ],
  },
  {
    id: 'visits', title: 'Maintenance visits', group: 'Work', paths: ['/maintenance-visits'],
    summary: 'Plan customer visits, assign engineers and send the visit report.',
    sections: [
      { heading: 'Planning', items: [
        'Managers and planners schedule visits (**New → Schedule Visit**) with the engineers, assets and checklist.',
        'Engineers are told, and reminded the day before.',
      ] },
      { heading: 'After the visit', items: [
        'The engineer completes the checklist and submits the report; a manager reviews it and sends it on.',
        'Recommendations found on a visit are recorded on the customer\'s Recommendations tab.',
      ] },
    ],
  },
  {
    id: 'calendar', title: 'Calendar, reminders and holidays', group: 'Work', paths: ['/calendar', '/reminders'],
    summary: 'Deadlines, visits and public holidays in one calendar; your reminders.',
    sections: [
      { heading: 'Calendar', items: [
        'Shows project deadlines, tasks, maintenance visits and public holidays.',
        '**Generate subscription URL** gives an address to add your calendar to Outlook or your phone.',
      ] },
      { heading: 'Reminders', items: [
        'Set your own reminders, or a **team reminder** that everyone in the team receives until someone marks it done.',
        'Automatic reminders (tasks due, contracts and licences ending…) are switched on and off under **Reminders → Automatic reminders**.',
      ] },
    ],
  },
  {
    id: 'renewals', title: 'Renewals & cases', group: 'Customers', paths: ['/renewals'], roles: ['manager', 'planner', 'engineer'],
    summary: 'What expires soon across all customers, and open vendor cases.',
    sections: [
      { heading: 'What it shows', items: [
        'Licences, certificates, contracts and device support expiring soon, soonest first, and vendor cases that are still open.',
        'Each line opens the customer\'s record where it is kept.',
      ] },
    ],
  },
  {
    id: 'reports', title: 'Reports and customer reports', group: 'Customers', paths: ['/reports', '/service-operations', '/approvals'], roles: ['manager'],
    summary: 'Operational reports, and the managed-service reports for customers.',
    sections: [
      { heading: 'Reports', items: [
        '**Reports** has the operational summaries, delivery trends and the weekly report.',
        '**Service Activity Reports** totals logged service work across customers, by category, engineer and billing.',
      ] },
      { heading: 'Customer reports', items: [
        'Managed customers have a **Reports** tab in Customer 360: generate a report for a period, review it under **Approvals**, then send it.',
        'Nothing is emailed to customers automatically: sending a report or response is always a deliberate action.',
      ] },
    ],
  },
  {
    id: 'bot', title: 'Chat bot (Webex and Teams)', group: 'Chat bot',
    summary: 'Log activities and manage your tasks by chatting with the bot, one-to-one.',
    sections: [
      { heading: 'Log an activity', items: [
        'Write what you did, e.g. *1h on Northwind, upgraded NW-FW-01 to 7.6.0, ticket 4521*. The bot shows a draft; reply **yes** to save, tell it what to change, or **cancel**.',
      ] },
      { heading: 'Your work', items: [
        '**tasks**: your open tasks · **overdue** · **today**: your day at a glance',
        '**logged**: what you logged today · **week**: this week\'s activities and hours',
        '**visits**: your next maintenance visits',
      ] },
      { heading: 'A task (by its number, e.g. 123)', items: [
        '**task 123**: its details · **start 123** · **done 123**',
        '**waiting 123 the customer sends the licence key**',
        '**update 123 firmware uploaded, rebooting tonight** (@Name tags a colleague)',
        '**new task Renew the SSL certificate for Northwind due Friday**. Due dates understand today, tomorrow, Friday, in 3 days, next week and 31/10. The customer is the one after the last "for".',
      ] },
      { heading: 'Good to know', items: [
        'The bot answers one-to-one chats only, not group spaces. **help** lists everything.',
        'It acts as you: you can only change tasks you work on, and the app\'s usual rules apply.',
      ] },
    ],
  },
  {
    id: 'notifications', title: 'Notifications', group: 'Basics',
    summary: 'The bell, your own channels, the shared and team spaces.',
    sections: [
      { heading: 'Your notifications', items: [
        'The bell at the top shows what concerns you. In **Profile** choose which events also reach you by email, Teams or a Webex message.',
      ] },
      { heading: 'Shared and team spaces (managers)', items: [
        '**Settings → Email & notifications → Notifications** sets the shared Teams channel and Webex space and which events they receive.',
        'A team can have its own Webex space (**Settings → Users & teams → Teams → Webex space**): its unassigned tasks, recurring tasks and team reminders go there. Add the bot to the space.',
        '**Pause notifications** stops Webex, Teams and notification emails (e.g. while creating many projects) until you resume them; nothing is sent later. The bell keeps working.',
      ] },
    ],
  },
  {
    id: 'advisories', title: 'Vulnerabilities and software versions', group: 'Customers', paths: ['/vulnerabilities', '/software'],
    summary: 'Security advisories and the recommended versions for the products you support.',
    sections: [
      { heading: 'What they show', items: [
        '**Vulnerabilities** lists CVEs for your vendors and products, and which customer devices they affect.',
        '**Software versions** shows the latest and recommended versions (checked every few hours) and vendor news.',
      ] },
    ],
  },
  {
    id: 'team', title: 'Workload, skills, KPIs and SLAs', group: 'Managers', roles: ['manager'],
    paths: ['/workload', '/skills', '/kpis', '/scorecards', '/sla', '/data-quality'],
    summary: 'Plan capacity and follow the team\'s performance.',
    sections: [
      { heading: 'Pages', items: [
        '**Workload**: each engineer\'s commitments and upcoming demand; try leave or new work without changing the live plan.',
        '**Skill matrix**: what the team knows per technology, and where knowledge rests on one person.',
        '**KPI Management** and **Scorecards**: define indicators and evaluate project delivery.',
        '**SLA**: response and resolution commitments and their exceptions.',
        '**Data quality**: missing contacts, owners and contracts, with where to fix each.',
      ] },
    ],
  },
  {
    id: 'settings', title: 'Settings (managers)', group: 'Managers', paths: ['/settings'], roles: ['manager'],
    summary: 'Where each setting is, and what to set up first.',
    sections: [
      { heading: 'First-time setup', items: [
        'Create teams and add their members (**Users & teams**), and switch on activity tracking for service teams.',
        'Add customers and assign each to a team (**Customers**).',
        'Set the mail server and the shared Teams/Webex channels (**Email & notifications**).',
        'Connect Request Tracker, Grafana and the chat bot if you use them (**Integrations**).',
        'Check the time zone, NTP server and public holidays (**Time & region**).',
      ] },
      { heading: 'Where things are', items: [
        '**Users & teams**: accounts, roles, teams and their Webex space · **Access & sign-in**: permissions, Microsoft 365 sign-in, password rules',
        '**Lists**: activity categories, project statuses, contract types, SLAs · **Templates**: project templates, visit checklists, the customer report template',
        '**Email & notifications**: SMTP, the shared channels, which events they receive, pausing notifications',
        '**Integrations**: Request Tracker (tickets), Grafana devices, the activity bot',
        '**Time & region**: time zone, NTP server (**Save and check** saves and tests it), public holidays and working days',
        '**Backups & health**: backups, storage, system health (including the HTTPS certificate) and the audit log',
      ] },
    ],
  },
  {
    id: 'deleting', title: 'Archiving and deleting', group: 'Managers', roles: ['manager'],
    summary: 'What archiving keeps, and what deleting for good removes.',
    sections: [
      { heading: 'Archive first', items: [
        'Archiving a customer keeps all its history and can be undone. Prefer it.',
      ] },
      { heading: 'Deleting for good (managers)', items: [
        '**Projects** (Edit → Delete project): with their tasks, updates, files, milestones, KPIs and logged time. Type the Project ID to confirm.',
        '**Customers** (archive first, then delete): with all their history: activities, assets, contracts, licences, visits, recommendations, tasks, KPIs and customer reports. Their projects are kept without the customer. Type the name to confirm.',
        '**Tasks** (Edit Task → Delete task), **visits** and **activities**: with their files.',
        'Deleting cannot be undone. The audit log keeps a record that it happened and who did it.',
      ] },
    ],
  },
  {
    id: 'account', title: 'Your account and security', group: 'Basics',
    summary: 'Signing in, two-factor authentication and passwords.',
    sections: [
      { heading: 'Signing in', items: [
        'Sign in with your Microsoft 365 account when your organisation has set it up, or with your email and password.',
        'Turn on two-factor authentication in **Profile** for an extra code at sign-in.',
        'Forgot your password? Use the link on the sign-in page, or ask a manager to reset it.',
      ] },
    ],
  },
];

/** The topics a role may see. */
export const topicsFor = role => HELP_TOPICS.filter(topic => !topic.roles || topic.roles.includes(role));

/** The topic that explains a page (most specific path first), for the ? button. */
export function topicForPath(pathname, role) {
  const matches = topicsFor(role).flatMap(topic => (topic.paths || []).map(path => ({ topic, path })))
    .filter(({ path }) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.topic || null;
}

/** Topics matching a search, in their order. */
export function searchTopics(topics, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  return topics.filter(topic => {
    const text = [topic.title, topic.summary, ...topic.sections.flatMap(section => [section.heading, ...section.items])].join(' ').toLowerCase();
    return words.every(word => text.includes(word));
  });
}
