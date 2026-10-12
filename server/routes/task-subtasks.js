const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { worksOnTask } = require('../taskAccess');
const { decrypt } = require('../fieldCipher');
const { MAX_PER_TASK, checkNewSubtasks, insertSubtasks } = require('../taskSubtasks');

/* Subtasks of one task (/api/tasks/:id/subtasks): a checklist the task cannot be
   completed without. Managers, and engineers who work on the task (theirs, or
   their team's), list, add, tick, rename and remove them. When the last open
   subtask is done the task is completed; opening one again (unticking or adding)
   puts a completed task back in progress. Replies: { subtasks, task: { status } }. */

const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

router.use(requireAuth, async (req, res, next) => {
  try {
    if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid task ID' });
    const task = await db.prepare('SELECT t.*, COALESCE(t.customer_id, p.customer_id) AS task_customer_id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?').get(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role !== 'manager' && !(req.user.role === 'engineer' && await worksOnTask(req.user, task))) return res.status(403).json({ error: 'Forbidden' });
    if (['POST', 'PUT'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object is required' });
    req.task = task;
    next();
  } catch (error) { next(error); }
});

async function list(taskId) {
  const rows = await db.prepare(`SELECT s.id, s.title, s.asset_id, s.done, s.done_at, s.position, a.name AS asset_name, a.software_version AS asset_version, u.name AS done_by_name
    FROM task_subtasks s LEFT JOIN customer_assets a ON a.id = s.asset_id LEFT JOIN users u ON u.id = s.done_by
    WHERE s.task_id = ? ORDER BY s.position, s.id`).all(taskId);
  return rows.map(row => ({ ...row, done: !!row.done, asset_name: row.asset_name ? decrypt(row.asset_name) : null, asset_version: row.asset_version ? decrypt(row.asset_version) : null }));
}

const changed = () => require('../liveUpdates').emitChange('tasks');

// Completes the task when every subtask is done, and reopens a completed one when one is open again.
async function settleTask(req) {
  const counts = await db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done FROM task_subtasks WHERE task_id = ?').get(req.task.id);
  const total = Number(counts.total), done = Number(counts.done || 0);
  const task = await db.prepare('SELECT status FROM tasks WHERE id = ?').get(req.task.id);
  let status = task.status;
  if (total > 0 && done === total && ['open', 'in_progress', 'waiting_customer', 'waiting_vendor'].includes(status)) status = 'completed';
  else if (done < total && status === 'completed') status = 'in_progress';
  if (status !== task.status) {
    // A team task becomes the person's who finished it (records who did it), as when they set its status.
    await db.prepare(`UPDATE tasks SET status = ?, pending_from_customer = NULL, assigned_to = COALESCE(assigned_to, ?),
      completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, app_now()) ELSE NULL END, updated_at = app_now() WHERE id = ?`)
      .run(status, req.user.role === 'engineer' ? req.user.id : null, status, req.task.id);
    if (req.task.project_id) await db.prepare('INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)')
      .run(req.task.project_id, req.user.id, 'task_status', `"${req.task.title}" → ${status} (subtasks)`).catch(() => {});
  }
  return { status };
}

async function reply(req, res, code = 200) {
  const task = await settleTask(req);
  changed();
  res.status(code).json({ subtasks: await list(req.task.id), task });
}

router.get('/', async (req, res) => res.json({ subtasks: await list(req.task.id), task: { status: req.task.status } }));

// One subtask ({ title, asset_id? }) or several ({ items: [...] }, e.g. one per asset).
router.post('/', async (req, res) => {
  const given = Array.isArray(req.body.items) ? req.body.items : [{ title: req.body.title, asset_id: req.body.asset_id }];
  const checked = await checkNewSubtasks(given, req.task.task_customer_id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  if (!checked.value.length) return res.status(400).json({ error: 'Add at least one subtask' });
  const existing = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM task_subtasks WHERE task_id = ?').get(req.task.id);
  if (Number(existing.n) + checked.value.length > MAX_PER_TASK) return res.status(400).json({ error: `A task can have at most ${MAX_PER_TASK} subtasks` });
  await db.transaction(tx => insertSubtasks(tx, req.task.id, checked.value, req.user.id, Number(existing.last) + 1));
  await reply(req, res, 201);
});

router.put('/:subtaskId', async (req, res) => {
  if (!positiveId(req.params.subtaskId)) return res.status(400).json({ error: 'Invalid subtask ID' });
  const subtask = await db.prepare('SELECT * FROM task_subtasks WHERE id = ? AND task_id = ?').get(Number(req.params.subtaskId), req.task.id);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });
  const { title, done } = req.body;
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.trim().length > 300)) return res.status(400).json({ error: 'A subtask needs a title of at most 300 characters' });
  if (done !== undefined && typeof done !== 'boolean') return res.status(400).json({ error: 'done must be true or false' });
  const nowDone = done === undefined ? !!subtask.done : done;
  await db.prepare(`UPDATE task_subtasks SET title = ?, done = ?, done_by = ?, done_at = ${nowDone && !subtask.done ? 'app_now()' : nowDone ? 'done_at' : 'NULL'} WHERE id = ?`)
    .run(title !== undefined ? title.trim() : subtask.title, nowDone ? 1 : 0, nowDone ? (subtask.done ? subtask.done_by : req.user.id) : null, subtask.id);
  await reply(req, res);
});

router.delete('/:subtaskId', async (req, res) => {
  if (!positiveId(req.params.subtaskId)) return res.status(400).json({ error: 'Invalid subtask ID' });
  const removed = await db.prepare('DELETE FROM task_subtasks WHERE id = ? AND task_id = ?').run(Number(req.params.subtaskId), req.task.id);
  if (!removed.changes) return res.status(404).json({ error: 'Subtask not found' });
  await reply(req, res);
});

module.exports = router;
