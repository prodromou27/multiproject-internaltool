import { CheckSquare, FolderOpen, Wrench, ClipboardList, FileText } from 'lucide-react';

export const DAYS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// Maintenance visits (and their pending-report reminders) are labelled by customer
// and contract on the calendar grid; the visit's own title/description show only
// once the event is opened (EventPopover), not before.
export function eventLabel(event) {
  if (event.type === 'maintenance' || event.type === 'report') {
    return event.contract_references ? `${event.customer_name} · ${event.contract_references}` : event.customer_name;
  }
  return event.title || event.customer_name;
}

export const TYPE_STYLE = {
  follow_up:   { bg: 'var(--cal-followup-bg)', color: 'var(--cal-followup-fg)', Icon: ClipboardList, label: 'Service Follow-up' },
  report:      { bg: 'var(--cal-report-bg)', color: 'var(--cal-report-fg)', Icon: FileText, label: 'Pending Visit Report' },
  task:        { bg: 'var(--cal-task-bg)', color: 'var(--cal-task-fg)', Icon: CheckSquare, label: 'Task' },
  project:     { bg: 'var(--cal-project-bg)', color: 'var(--cal-project-fg)', Icon: FolderOpen,  label: 'Project Deadline' },
  maintenance: { bg: 'var(--cal-visit-bg)', color: 'var(--cal-visit-fg)', Icon: Wrench,      label: 'Maintenance Visit' },
};
