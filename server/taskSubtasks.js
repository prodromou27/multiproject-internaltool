/**
 * Subtasks: a checklist on a task (as in Planner). A task cannot be completed,
 * closed or sent for approval while any of its subtasks is open (routes/tasks.js).
 * A subtask may name one of the task's customer's assets. Routes: routes/task-subtasks.js.
 */
const db = require('./db');

const CLOSING = new Set(['completed', 'closed', 'pending_approval']);
const MAX_PER_TASK = 200;

/** { total, done } per task id, for the ids given. */
async function subtaskCounts(taskIds, store = db) {
  const ids = [...new Set(taskIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await store.prepare(`SELECT task_id, COUNT(*) AS total, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done
    FROM task_subtasks WHERE task_id IN (${ids.map(() => '?').join(',')}) GROUP BY task_id`).all(...ids);
  return new Map(rows.map(row => [Number(row.task_id), { total: Number(row.total), done: Number(row.done || 0) }]));
}

/** Adds subtasks_total / subtasks_done to task rows. */
async function withSubtaskCounts(rows, store = db) {
  const counts = await subtaskCounts(rows.map(row => row.id), store);
  return rows.map(row => { const c = counts.get(Number(row.id)) || { total: 0, done: 0 }; return { ...row, subtasks_total: c.total, subtasks_done: c.done }; });
}

/** Ids among those given that still have open subtasks. */
async function withOpenSubtasks(taskIds, store = db) {
  const counts = await subtaskCounts(taskIds, store);
  return new Map([...counts].filter(([, c]) => c.done < c.total).map(([id, c]) => [id, c.total - c.done]));
}

const closingBlocked = open => `Finish the ${open} open subtask${open === 1 ? '' : 's'} first`;

/**
 * Checks subtasks given when a task is created: [{ title, asset_id? }] or titles.
 * Assets must belong to the task's customer.
 */
async function checkNewSubtasks(list, customerId, store = db) {
  if (list == null) return { value: [] };
  if (!Array.isArray(list) || list.length > MAX_PER_TASK) return { error: `Subtasks must be a list of at most ${MAX_PER_TASK}` };
  const items = [];
  for (const raw of list) {
    const item = typeof raw === 'string' ? { title: raw } : raw;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!title || title.length > 300) return { error: 'Each subtask needs a title of at most 300 characters' };
    const assetId = item.asset_id == null || item.asset_id === '' ? null : Number(item.asset_id);
    if (assetId !== null && (!Number.isSafeInteger(assetId) || assetId < 1)) return { error: 'Invalid subtask asset' };
    items.push({ title, asset_id: assetId });
  }
  const assetIds = [...new Set(items.map(item => item.asset_id).filter(Boolean))];
  if (assetIds.length) {
    if (!customerId) return { error: 'Only a customer task can have subtasks about assets' };
    const found = await store.prepare(`SELECT id FROM customer_assets WHERE customer_id = ? AND id IN (${assetIds.map(() => '?').join(',')})`).all(customerId, ...assetIds);
    if (found.length !== assetIds.length) return { error: 'Every subtask asset must belong to this customer' };
  }
  return { value: items };
}

async function insertSubtasks(store, taskId, items, userId, startAt = 0) {
  let position = startAt;
  for (const item of items) {
    await store.prepare('INSERT INTO task_subtasks (task_id, title, asset_id, position, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, item.title, item.asset_id || null, position++, userId || null);
  }
}

/** Adds last_update ({ message, user_name, created_at }) to task rows: the newest status comment. */
async function withLastUpdates(rows, store = db) {
  const ids = [...new Set(rows.map(row => Number(row.id)).filter(Boolean))];
  if (!ids.length) return rows;
  const comments = await store.prepare(`SELECT tc.id, tc.task_id, tc.message, tc.created_at, u.name AS user_name FROM task_comments tc JOIN users u ON u.id = tc.user_id
    WHERE tc.task_id IN (${ids.map(() => '?').join(',')}) ORDER BY tc.id DESC`).all(...ids);
  const latest = new Map();
  for (const comment of comments) if (!latest.has(Number(comment.task_id))) latest.set(Number(comment.task_id), { message: comment.message, user_name: comment.user_name, created_at: comment.created_at });
  return rows.map(row => ({ ...row, last_update: latest.get(Number(row.id)) || null }));
}

module.exports = { withLastUpdates, CLOSING, MAX_PER_TASK, subtaskCounts, withSubtaskCounts, withOpenSubtasks, closingBlocked, checkNewSubtasks, insertSubtasks };
