/**
 * Events that can be posted to the organisation's shared Teams channel and
 * Webex space (Settings → Notifications). Each has a
 * default; the admin's switches override it. People's own channels are set
 * separately, in their Profile.
 */
const SHARED_EVENTS = Object.freeze([
  { key: 'task_assigned', group: 'Projects and tasks', label: 'A task is assigned to an engineer', default: true },
  { key: 'project_assigned', group: 'Projects and tasks', label: 'An engineer is added to a project', default: true },
  { key: 'project_closure_requested', group: 'Projects and tasks', label: 'Closure of a project is requested', default: true },
  { key: 'project_closure_decided', group: 'Projects and tasks', label: 'A project closure is approved or returned', default: true },
  { key: 'activity_logged', group: 'Projects and tasks', label: 'A service activity is logged', default: false },
  { key: 'visit_assigned', group: 'Maintenance visits', label: 'A maintenance visit is assigned to an engineer', default: true },
  { key: 'visit_reminder', group: 'Maintenance visits', label: 'The day before a maintenance visit', default: true },
  { key: 'report_submitted', group: 'Maintenance visits', label: 'A visit report is submitted for review', default: true },
  { key: 'visit_report_approved', group: 'Maintenance visits', label: 'A visit report is approved and sent on', default: true },
  { key: 'recommendation_created', group: 'Customers', label: 'A high or critical recommendation is recorded', default: true },
  { key: 'managed_report_submitted', group: 'Customers', label: 'A customer report is submitted for review', default: true },
  { key: 'managed_report_decided', group: 'Customers', label: 'A customer report is approved, returned, finalized or reopened', default: false },
  { key: 'customer_report_sent', group: 'Customers', label: 'A customer report is marked as sent', default: true },
  { key: 'customer_report_due', group: 'Customers', label: 'A customer report is due within 3 days, or is overdue', default: true },
  { key: 'asset_expiring', group: 'Customers', label: 'A managed customer\'s asset support or warranty expires within 30 days', default: true },
  { key: 'contract_ending', group: 'Customers', label: 'A customer contract ends within 30 days, or has expired without a renewal', default: true },
  { key: 'licence_expiring', group: 'Customers', label: 'A customer licence, subscription or certificate expires within 60, 30 or 7 days, or has expired', default: true },
  { key: 'certificate_expiring', group: 'System', label: 'The HTTPS certificate of the app expires within 30, 14, 7 or 1 days, or has expired', default: true },
  { key: 'backup_failed', group: 'System', label: 'A database backup, or its copy off the server, fails', default: true },
]);

const SHARED_EVENT_KEYS = SHARED_EVENTS.map(event => event.key);

/** Whether an event is switched on, given the stored switches (missing → the event's default). */
function sharedEventEnabled(notifyOn, key) {
  const event = SHARED_EVENTS.find(item => item.key === key);
  if (!event) return false;
  return typeof notifyOn?.[key] === 'boolean' ? notifyOn[key] : event.default;
}

module.exports = { SHARED_EVENTS, SHARED_EVENT_KEYS, sharedEventEnabled };
