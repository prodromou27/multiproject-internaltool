const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { worksOnTask } = require('../taskAccess');
const { decrypt } = require('../fieldCipher');
const { MAX_PER_TASK, checkNewSubtasks, insertSubtasks } = require('../taskSubtasks');

/* Subtasks of one task (/api/tasks/:id/subtasks): a checklist the task cannot be
   completed without. Managers, and engineers who work on the task (theirs, or
   their team's), list, add, tick, rename and remove them. */

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

router.get('/', async (req, res) => res.json(await list(req.task.id)));

// One subtask ({ title, asset_id? }) or several ({ items: [...] }, e.g. one per asset).
router.post('/', async (req, res) => {
  const given = Array.isArray(req.body.items) ? req.body.items : [{ title: req.body.title, asset_id: req.body.asset_id }];
  const checked = await checkNewSubtasks(given, req.task.task_customer_id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  if (!checked.value.length) return res.status(400).json({ error: 'Add at least one subtask' });
  const existing = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM task_subtasks WHERE task_id = ?').get(req.task.id);
  if (Number(existing.n) + checked.value.length > MAX_PER_TASK) return res.status(400).json({ error: `A task can have at most ${MAX_PER_TASK} subtasks` });
  await db.transaction(tx => insertSubtasks(tx, req.task.id, checked.value, req.user.id, Number(existing.last) + 1));
  changed();
  res.status(201).json(await list(req.task.id));
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
  changed();
  res.json(await list(req.task.id));
});

router.delete('/:subtaskId', async (req, res) => {
  if (!positiveId(req.params.subtaskId)) return res.status(400).json({ error: 'Invalid subtask ID' });
  const removed = await db.prepare('DELETE FROM task_subtasks WHERE id = ? AND task_id = ?').run(Number(req.params.subtaskId), req.task.id);
  if (!removed.changes) return res.status(404).json({ error: 'Subtask not found' });
  changed();
  res.json(await list(req.task.id));
});

module.exports = router;
