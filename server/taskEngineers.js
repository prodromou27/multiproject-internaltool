/**
 * Engineers working on a task besides the one it is assigned to. The assignee stays
 * the lead (who owns the status); the others see the task as theirs (My Work, their
 * calendar, taskAccess.js), may update it, post updates and attach files.
 */
const db = require('./db');

const MAX_ENGINEERS = 20;

/** engineer_ids from a request → { value } (ids, without the lead) or { error }; undefined when not sent. */
async function checkEngineerIds(value, leadId, store = db) {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: [] };
  if (!Array.isArray(value) || !value.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0))
    return { error: 'engineer_ids must be a list of user IDs' };
  const ids = [...new Set(value.map(Number))].filter(id => id !== Number(leadId || 0));
  if (ids.length > MAX_ENGINEERS) return { error: `At most ${MAX_ENGINEERS} engineers can work on a task` };
  if (!ids.length) return { value: [] };
  const found = await store.prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND active = 1 AND role = 'engineer'`).all(...ids);
  if (found.length !== ids.length) return { error: 'Add only active engineers to a task' };
  return { value: ids };
}

/** Replaces a task's other engineers; returns the ones newly added (to be told). */
async function setEngineers(store, taskId, ids) {
  const before = new Set((await store.prepare('SELECT user_id FROM task_engineers WHERE task_id = ?').all(taskId)).map(row => Number(row.user_id)));
  await store.prepare('DELETE FROM task_engineers WHERE task_id = ?').run(taskId);
  for (const id of ids) await store.prepare('INSERT INTO task_engineers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(taskId, id);
  return ids.filter(id => !before.has(id));
}

/** The lead is never also listed as another engineer (after a reassignment). */
async function dropLead(store, taskId, leadId) {
  if (leadId) await store.prepare('DELETE FROM task_engineers WHERE task_id = ? AND user_id = ?').run(taskId, leadId);
}

/** Adds `engineers` ([{ id, name }], the others working on it) to task rows. */
async function withEngineers(rows, store = db) {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map(row => Number(row.id)))];
  const found = await store.prepare(`SELECT te.task_id, u.id, u.name FROM task_engineers te JOIN users u ON u.id = te.user_id
    WHERE te.task_id IN (${ids.map(() => '?').join(',')}) ORDER BY u.name`).all(...ids);
  const byTask = new Map();
  for (const row of found) {
    const list = byTask.get(Number(row.task_id)) || [];
    list.push({ id: Number(row.id), name: row.name });
    byTask.set(Number(row.task_id), list);
  }
  return rows.map(row => ({ ...row, engineers: byTask.get(Number(row.id)) || [] }));
}

module.exports = { checkEngineerIds, setEngineers, dropLead, withEngineers, MAX_ENGINEERS };
