export const TASK_FILTERS = ['all', 'open', 'done', 'adhoc', 'waiting_customer', 'overdue', 'due_week', 'due_today', 'pending_approval'];
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer', 'waiting_vendor'];
export const DONE_STATUSES = ['completed', 'closed'];

export function taskMatchesFilter(task, filter, today) {
  const terminal = ['completed', 'closed', 'cancelled'].includes(task.status);
  if (filter === 'open') return OPEN_STATUSES.includes(task.status);
  if (filter === 'done') return DONE_STATUSES.includes(task.status);
  if (filter === 'adhoc') return !!task.is_adhoc;
  if (filter === 'waiting_customer') return ['waiting_customer', 'waiting_vendor'].includes(task.status);
  if (filter === 'pending_approval') return task.status === 'pending_approval';
  if (filter === 'overdue') return !terminal && !!task.deadline && task.deadline < today;
  if (filter === 'due_today') return !terminal && task.deadline === today;
  if (filter === 'due_week') {
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    return !terminal && !!task.deadline && task.deadline >= today && task.deadline <= end.toISOString().slice(0, 10);
  }
  return true;
}
