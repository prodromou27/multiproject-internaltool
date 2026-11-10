/* Customer Responses: ready-to-use email texts everyone can copy. Managers add,
   change and remove them. Stored as one list in settings; until a manager changes
   it, the built-in texts are shown. */
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { customerEmailEnabled } = require('../customerEmail');
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

/* ── Contextual responses (E07): fill a text from a customer, task or visit ── */
const composer = require('../responseComposer');
const email = require('../email');

// The context and the response, checked: { response, context } or a reply already sent.
async function composeTarget(req, res) {
  const response = (await list()).find(row => row.id === req.params.id);
  if (!response) { res.status(404).json({ error: 'Response not found' }); return null; }
  const type = req.body?.context?.type, id = Number(req.body?.context?.id);
  const context = await composer.contextValues(req.user, type, id);
  // The same answer for "no such record" and "not yours to see".
  if (!context) { res.status(404).json({ error: 'That record was not found' }); return null; }
  return { response, context };
}

router.post('/:id/compose', requireAuth, async (req, res) => {
  const target = await composeTarget(req, res);
  if (!target) return;
  const { response, context } = target;
  const subject = composer.fill(response.title, context.values), body = composer.fill(response.body, context.values);
  const smtp = await email.getSmtpSettings();
  const allowed = await customerEmailEnabled();
  res.json({ subject: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])].map(name => ({ name, label: composer.PLACEHOLDERS[name] })),
    recipients: context.contactEmail ? [context.contactEmail] : [], email_available: !!smtp?.host && allowed, customer_email_off: !allowed });
});

// Sent only when asked, only to the customer's contact on record, and recorded.
router.post('/:id/send', requireAuth, async (req, res) => {
  const target = await composeTarget(req, res);
  if (!target) return;
  const { response, context } = target;
  // Settings → Email & notifications → Emails to customers (off unless turned on).
  if (!await customerEmailEnabled()) return res.status(403).json({ error: 'Emails to customers are switched off (Settings → Email & notifications). Copy the text instead.', code: 'CUSTOMER_EMAIL_OFF' });
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
  const body = typeof req.body.body === 'string' ? req.body.body.replace(/\r\n/g, '\n') : '';
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) return res.status(400).json({ error: 'The subject must be one line of up to 200 characters' });
  if (!body.trim() || body.length > 20000) return res.status(400).json({ error: 'The text must have 1 to 20,000 characters' });
  if (!context.contactEmail || req.body.to !== context.contactEmail) return res.status(400).json({ error: "Emails go only to the customer's contact email on record" });
  if (/\{\{\s*[a-z_]+\s*\}\}/.test(subject + body)) return res.status(400).json({ error: 'Fill in or remove the {{placeholders}} before sending' });
  try { await email.sendEmail({ to: context.contactEmail, subject, text: body }); }
  catch (error) { return res.status(502).json({ error: `The email was not sent: ${error.message}` }); }
  await logAudit(db, req, 'customer_response', context.customerId, response.title, 'sent', `${req.body.context.type} ${req.body.context.id} to ${context.contactEmail}`);
  res.json({ ok: true, to: context.contactEmail });
});

router.get('/placeholders', requireAuth, (req, res) => res.json(composer.PLACEHOLDERS));

module.exports = router;
module.exports.DEFAULTS = DEFAULTS;
