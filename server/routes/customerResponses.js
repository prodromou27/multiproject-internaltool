/* Customer Responses: ready-to-use email texts everyone can copy. Managers add,
   change and remove them. Stored as one list in settings; until a manager changes
   it, the built-in texts are shown. */
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');

const KEY = 'customer_responses';
const TONES = ['success', 'warning', 'indigo', 'danger', 'info', 'neutral'];
const DEFAULTS = [
  { id: 'closing', title: 'Closing Ticket', tone: 'success', body: `As no further actions are required, we will proceed with closing this ticket.
In case you need any further assistance, you can always reopen this ticket by replying to this email.` },
  { id: 'chargeable', title: 'Chargeable Task', tone: 'warning', body: `We would like to inform you that the requested service is out of the scope of our contract, thus please approve X hour in order to schedule this task.



Task Description:
Responsible engineer:
Estimated required hours:
Requested by:



Service hours will be billed on actual time spent on service and our mutually agreed rates.` },
  { id: 'crm', title: 'CRM - Chargeable', tone: 'indigo', body: `Ticket #
Requester:
Product:` },
  { id: 'late', title: 'Late Response', tone: 'danger', body: 'I hope my email finds you well. We received no response from you since our last update. We will proceed with closing this ticket per company policy. You can always reply to this email to re-open the ticket to further assist you.' },
  { id: 'upgrade', title: 'Notification of Asset Upgrade', tone: 'info', body: `Subject: Notification of Asset Upgrade

Dear Team,

I am writing to inform you of an upcoming asset upgrade for the below customer, [Customer Name]. The details of the upgrade are as follows:

Project Name:\t
Asset:\t
Responsible Engineer:\t
Date:\t
Time:\t

If you have any questions or need further information, please do not hesitate to contact me.

Kind regards,` },
];
const MAX = 100;

async function list() {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  if (!row) return DEFAULTS;
  try { const value = JSON.parse(row.value); return Array.isArray(value) ? value : DEFAULTS; } catch { return DEFAULTS; }
}
const save = rows => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(rows));

function input(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = typeof body?.body === 'string' ? body.body.replace(/\r\n/g, '\n') : '';
  if (!title || title.length > 120) return { error: 'The title must have 1 to 120 characters' };
  if (!text.trim() || text.length > 10000) return { error: 'The text must have 1 to 10,000 characters' };
  const tone = body.tone === undefined ? 'neutral' : body.tone;
  if (!TONES.includes(tone)) return { error: `The colour must be one of ${TONES.join(', ')}` };
  return { value: { title, body: text, tone } };
}

router.get('/', requireAuth, async (req, res) => res.json({ rows: await list(), tones: TONES, can_edit: req.user.role === 'manager' }));

router.post('/', requireManager, async (req, res) => {
  const checked = input(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const rows = await list();
  if (rows.length >= MAX) return res.status(400).json({ error: `At most ${MAX} responses` });
  const row = { id: crypto.randomUUID(), ...checked.value };
  await save([...rows, row]);
  await logAudit(db, req, 'customer_response', null, row.title, 'created', null);
  res.status(201).json(row);
});

router.put('/:id', requireManager, async (req, res) => {
  const checked = input(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const rows = await list();
  const index = rows.findIndex(row => row.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Response not found' });
  rows[index] = { id: rows[index].id, ...checked.value };
  await save(rows);
  await logAudit(db, req, 'customer_response', null, rows[index].title, 'updated', null);
  res.json(rows[index]);
});

router.delete('/:id', requireManager, async (req, res) => {
  const rows = await list();
  const gone = rows.find(row => row.id === req.params.id);
  if (!gone) return res.status(404).json({ error: 'Response not found' });
  await save(rows.filter(row => row.id !== req.params.id));
  await logAudit(db, req, 'customer_response', null, gone.title, 'deleted', null);
  res.json({ ok: true });
});

module.exports = router;
module.exports.DEFAULTS = DEFAULTS;
