// Remediation campaigns (enhancement E01): managers turn a CVE or an outdated product
// into one upgrade task per customer and follow each device to a verified fix.
const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const remediation = require('../remediation');

router.use(requireManager);

const positiveId = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const summary = items => Object.fromEntries(['planned', 'upgraded', 'verified', 'exception'].map(s => [s, items.filter(i => i.status === s).length]));

router.get('/', async (req, res) => {
  const campaigns = await db.prepare(`SELECT c.*, u.name AS created_by_name FROM remediation_campaigns c LEFT JOIN users u ON u.id = c.created_by
    ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, c.target_date, c.id DESC LIMIT 100`).all();
  const rows = [];
  for (const campaign of campaigns) rows.push({ ...campaign, counts: summary(await remediation.progress(campaign)) });
  res.json({ rows });
});

router.post('/preview', async (req, res) => {
  const source = remediation.checkSource(req.body?.source_type, req.body?.source_ref);
  if (source.error) return res.status(400).json({ error: source.error });
  res.json(await remediation.preview(source.value));
});

router.post('/', async (req, res) => {
  const source = remediation.checkSource(req.body?.source_type, req.body?.source_ref);
  if (source.error) return res.status(400).json({ error: source.error });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 200) return res.status(400).json({ error: 'The campaign needs a name of up to 200 characters' });
  if (!realDay(req.body.target_date)) return res.status(400).json({ error: 'Target date must be a date (YYYY-MM-DD)' });
  if (!Array.isArray(req.body.customers) || !req.body.customers.length || req.body.customers.length > 200) return res.status(400).json({ error: 'Choose at least one customer' });

  // Only devices that are affected now, not already in an active campaign for this source.
  const plan = await remediation.preview(source.value);
  const available = new Map(plan.customers.map(c => [c.customer_id, new Map(c.devices.filter(d => !d.in_campaign).map(d => [d.asset_id, d]))]));
  const chosen = [];
  for (const entry of req.body.customers) {
    const customerId = positiveId(entry?.customer_id), owner = entry?.assigned_to == null ? null : positiveId(entry.assigned_to);
    const devices = available.get(customerId);
    if (!devices) return res.status(400).json({ error: 'A chosen customer has no devices to remediate' });
    if (entry?.assigned_to != null && (!owner || !await db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('engineer','manager')").get(owner)))
      return res.status(400).json({ error: 'The owner must be an active engineer or manager' });
    const assetIds = Array.isArray(entry.asset_ids) ? [...new Set(entry.asset_ids.map(positiveId))] : [...devices.keys()];
    if (!assetIds.length || assetIds.some(id => !devices.has(id))) return res.status(400).json({ error: 'Only devices affected now and not already in a campaign can be chosen' });
    chosen.push({ customerId, owner, devices: assetIds.map(id => devices.get(id)) });
  }

  const id = await db.transaction(async tx => {
    const campaign = await tx.prepare('INSERT INTO remediation_campaigns (name, source_type, source_ref, target_date, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(name, source.value.type, source.value.ref, req.body.target_date, req.user.id);
    for (const { customerId, owner, devices } of chosen) {
      const task = await tx.prepare(`INSERT INTO tasks (customer_id, title, description, priority, deadline, assigned_to, created_by) VALUES (?, ?, ?, 'high', ?, ?, ?) RETURNING id`)
        .get(customerId, `${name}: upgrade ${devices.length} device${devices.length === 1 ? '' : 's'}`.slice(0, 500),
          `Remediation campaign for ${plan.title}. Tick each device when it is upgraded, then review the device so the fix is confirmed.`, req.body.target_date, owner, req.user.id);
      for (const [position, device] of devices.entries()) {
        const subtask = await tx.prepare('INSERT INTO task_subtasks (task_id, title, asset_id, position, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
          .get(task.id, `Upgrade ${device.asset_name}${device.version ? ` (now ${device.version})` : ''}`.slice(0, 500), device.asset_id, position, req.user.id);
        await tx.prepare('INSERT INTO remediation_campaign_items (campaign_id, asset_id, customer_id, task_id, subtask_id) VALUES (?, ?, ?, ?, ?)')
          .run(campaign.id, device.asset_id, customerId, task.id, subtask.id);
      }
    }
    return campaign.id;
  });
  const devices = chosen.reduce((n, c) => n + c.devices.length, 0);
  await logAudit(db, req, 'remediation_campaign', id, name, 'created', `${plan.title}: ${devices} devices at ${chosen.length} customers, target ${req.body.target_date}`);
  const { notifyUser } = require('../notifications');
  for (const { owner, devices: list } of chosen) if (owner && owner !== req.user.id)
    notifyUser(owner, 'task_assigned', { title: `Upgrade task: ${name}`, body: `${list.length} device(s) by ${req.body.target_date}.` }, { title: `Upgrade task: ${name}`, body: `${list.length} device(s) by ${req.body.target_date}`, link: '/tasks' });
  res.status(201).json({ id });
});

async function loadCampaign(req, res) {
  const id = positiveId(req.params.id);
  const campaign = id && await db.prepare('SELECT c.*, u.name AS created_by_name FROM remediation_campaigns c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?').get(id);
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return null; }
  return campaign;
}

router.get('/:id', async (req, res) => {
  const campaign = await loadCampaign(req, res);
  if (!campaign) return;
  const items = await remediation.progress(campaign);
  res.json({ ...campaign, source_title: await remediation.sourceTitle({ type: campaign.source_type, ref: campaign.source_ref }), counts: summary(items), items });
});

// An exception: the device will not be fixed in this campaign, and why (null clears it).
router.put('/:id/items/:assetId', async (req, res) => {
  const campaign = await loadCampaign(req, res);
  if (!campaign) return;
  const reason = req.body?.exception_reason;
  if (reason !== null && (typeof reason !== 'string' || !reason.trim() || reason.length > 500)) return res.status(400).json({ error: 'Say why this device is an exception (up to 500 characters), or clear it' });
  const changed = await db.prepare('UPDATE remediation_campaign_items SET exception_reason = ? WHERE campaign_id = ? AND asset_id = ?').run(reason === null ? null : reason.trim(), campaign.id, positiveId(req.params.assetId));
  if (!changed.changes) return res.status(404).json({ error: 'That device is not in this campaign' });
  await logAudit(db, req, 'remediation_campaign', campaign.id, campaign.name, reason === null ? 'exception_cleared' : 'exception_recorded', `asset ${req.params.assetId}${reason ? `: ${reason.trim()}` : ''}`);
  res.json({ ok: true });
});

router.put('/:id', async (req, res) => {
  const campaign = await loadCampaign(req, res);
  if (!campaign) return;
  if (!['active', 'closed'].includes(req.body?.status)) return res.status(400).json({ error: 'Status must be active or closed' });
  await db.prepare('UPDATE remediation_campaigns SET status = ?, closed_at = ? WHERE id = ?').run(req.body.status, req.body.status === 'closed' ? new Date().toISOString() : null, campaign.id);
  await logAudit(db, req, 'remediation_campaign', campaign.id, campaign.name, req.body.status === 'closed' ? 'closed' : 'reopened', null);
  res.json({ ok: true });
});

module.exports = router;
