/**
 * Which tasks an engineer works on: the ones assigned to them, the ones they were
 * added to as another engineer on the task (task_engineers), and unassigned tasks
 * given to one of their teams (team tasks, e.g. from a recurring task).
 * Whoever starts or completes a team task takes it (routes/tasks.js), which
 * records who did it.
 */
const db = require('./db');

/** SQL condition for "this engineer's tasks"; bind ownTasksParams(userId). */
function ownTasksSql(alias = '') {
  const a = alias ? `${alias}.` : 'tasks.';
  return `(${a}assigned_to = ? OR (${a}assigned_to IS NULL AND ${a}team_id IN (SELECT team_id FROM team_members WHERE user_id = ?))`
    + ` OR ${a}id IN (SELECT task_id FROM task_engineers WHERE user_id = ?))`;
}
const ownTasksParams = userId => [userId, userId, userId];

async function worksOnTask(user, task, store = db) {
  if (!task || !user) return false;
  if (task.assigned_to != null && Number(task.assigned_to) === Number(user.id)) return true;
  if (task.id && await store.prepare('SELECT 1 FROM task_engineers WHERE task_id = ? AND user_id = ?').get(task.id, user.id)) return true;
  if (task.assigned_to != null || !task.team_id) return false;
  return !!await store.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(task.team_id, user.id);
}

/**
 * Whether someone may see a task (read it, its updates and subtasks): managers;
 * engineers who work on it, are on its project, work with its customer, or own
 * one of its subtasks.
 */
async function canReadTask(user, task, store = db) {
  if (!task || !user) return false;
  if (user.role === 'manager') return true;
  if (user.role !== 'engineer') return false;
  if (await worksOnTask(user, task, store)) return true;
  if (task.project_id) { if (await store.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(task.project_id, user.id)) return true; }
  else {
    const customerId = task.customer_id;
    if (customerId && await require('./customerAccess').canAccessCustomer(user, customerId, store)) return true;
  }
  return !!await store.prepare('SELECT 1 FROM task_subtasks WHERE task_id = ? AND assigned_to = ?').get(task.id, user.id);
}

/**
 * The people a message mentions ("@Full Name", "@FullName", or "@First" when only
 * one candidate has that first name), among the candidates given ({ id, name }).
 */
function mentionedUsers(message, candidates) {
  const text = String(message || '').toLowerCase();
  const firstNames = new Map();
  for (const person of candidates) { const first = person.name.split(' ')[0].toLowerCase(); firstNames.set(first, (firstNames.get(first) || 0) + 1); }
  // "@first" followed by the end or a character that cannot continue a name.
  const mentionsWord = word => { for (let at = text.indexOf(`@${word}`); at !== -1; at = text.indexOf(`@${word}`, at + 1)) { const next = text[at + word.length + 1]; if (!next || !/[a-z0-9]/.test(next)) return true; } return false; };
  return candidates.filter(person => {
    const name = person.name.toLowerCase(), first = name.split(' ')[0];
    return text.includes(`@${name}`) || text.includes(`@${name.replace(/\s+/g, '')}`) || (firstNames.get(first) === 1 && mentionsWord(first));
  });
}

module.exports = { ownTasksSql, ownTasksParams, worksOnTask, canReadTask, mentionedUsers };
