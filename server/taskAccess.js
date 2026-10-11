/**
 * Which tasks an engineer works on: the ones assigned to them, and unassigned
 * tasks given to one of their teams (team tasks, e.g. from a recurring task).
 * Whoever starts or completes a team task takes it (routes/tasks.js), which
 * records who did it.
 */
const db = require('./db');

/** SQL condition for "this engineer's tasks"; bind ownTasksParams(userId). */
function ownTasksSql(alias = '') {
  const a = alias ? `${alias}.` : '';
  return `(${a}assigned_to = ? OR (${a}assigned_to IS NULL AND ${a}team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)))`;
}
const ownTasksParams = userId => [userId, userId];

async function worksOnTask(user, task, store = db) {
  if (!task || !user) return false;
  if (task.assigned_to != null) return Number(task.assigned_to) === Number(user.id);
  if (!task.team_id) return false;
  return !!await store.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(task.team_id, user.id);
}

module.exports = { ownTasksSql, ownTasksParams, worksOnTask };
