/**
 * Remediation campaigns (enhancement E01): from a CVE or a product whose devices run
 * old software, the affected devices become one task per customer (one subtask per
 * device), with an owner and a target date. Progress is tracked per device:
 *   planned   – in the campaign, not yet done;
 *   upgraded  – its subtask is ticked;
 *   verified  – a device review since the campaign started shows it fixed
 *               (no longer affected by the CVE, or on the current version);
 *   exception – a manager recorded why it is not being fixed.
 * A device is only ever in one active campaign per advisory or product, and devices
 * that already have an open task about them are shown, not given a second one.
 */
const db = require('./db');
const { decrypt } = require('./fieldCipher');
const { analyse } = require('./cve/analysis');
const { assetSoftwareStatus } = require('./softwareCompliance');

const SOURCES = ['cve', 'software'];
const OPEN_TASK = "status NOT IN ('completed','closed','cancelled')";

function checkSource(type, ref) {
  if (!SOURCES.includes(type)) return { error: 'The source must be a CVE or a software product' };
  if (type === 'cve') {
    const id = String(ref || '').toUpperCase();
    return /^CVE-\d{4}-\d{4,}$/.test(id) ? { value: { type, ref: id } } : { error: 'Invalid CVE ID' };
  }
  const id = Number(ref);
  return Number.isSafeInteger(id) && id > 0 ? { value: { type, ref: String(id) } } : { error: 'Invalid product' };
}

/** The affected active devices now: [{ asset_id, customer_id, asset_name, version, detail }]. */
async function affected(source, store = db) {
  if (source.type === 'cve') {
    const data = await analyse(store);
    const cve = data.cves.find(item => item.id === source.ref);
    const assets = new Map(data.assets.map(asset => [asset.id, asset]));
    return (cve?.affected || []).filter(hit => hit.verdict === 'yes').map(hit => {
      const asset = assets.get(hit.asset_id) || {};
      return { asset_id: Number(hit.asset_id), customer_id: Number(hit.customer_id), asset_name: asset.name || `Device #${hit.asset_id}`, version: asset.version || null, detail: 'Affected' };
    });
  }
  const { assets } = await assetSoftwareStatus({ store });
  return assets.filter(a => a.product_id === Number(source.ref) && ['behind', 'end_of_life'].includes(a.status)).map(a => ({
    asset_id: a.id, customer_id: a.customer_id, asset_name: a.name, version: a.software_version,
    detail: a.status === 'end_of_life' ? `End of life; latest ${a.latest || 'unknown'}` : `Behind; latest ${a.latest}`,
  }));
}

async function sourceTitle(source, store = db) {
  if (source.type === 'cve') return source.ref;
  return (await store.prepare('SELECT name FROM software_products WHERE id = ?').get(Number(source.ref)))?.name || `Product #${source.ref}`;
}

/** What a campaign would create: per customer, its affected devices and what already covers them. */
async function preview(source, store = db) {
  const devices = await affected(source, store);
  if (!devices.length) return { title: await sourceTitle(source, store), customers: [] };
  const ids = devices.map(d => d.asset_id), marks = ids.map(() => '?').join(',');
  const [tasks, subtasks, inCampaign, customers] = await Promise.all([
    store.prepare(`SELECT id, title, asset_id FROM tasks WHERE asset_id IN (${marks}) AND ${OPEN_TASK}`).all(...ids),
    store.prepare(`SELECT t.id, t.title, s.asset_id FROM task_subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.asset_id IN (${marks}) AND s.done = 0 AND t.${OPEN_TASK}`).all(...ids),
    store.prepare(`SELECT i.asset_id, c.id AS campaign_id, c.name FROM remediation_campaign_items i JOIN remediation_campaigns c ON c.id = i.campaign_id
      WHERE c.status = 'active' AND c.source_type = ? AND c.source_ref = ? AND i.asset_id IN (${marks})`).all(source.type, source.ref, ...ids),
    store.prepare(`SELECT id, name FROM customers WHERE id IN (${[...new Set(devices.map(d => d.customer_id))].map(() => '?').join(',')})`).all(...new Set(devices.map(d => d.customer_id))),
  ]);
  const openTask = new Map([...tasks, ...subtasks].map(t => [Number(t.asset_id), { id: Number(t.id), title: t.title }]));
  const campaign = new Map(inCampaign.map(c => [Number(c.asset_id), { id: Number(c.campaign_id), name: c.name }]));
  const names = new Map(customers.map(c => [Number(c.id), decrypt(c.name)]));
  const grouped = new Map();
  for (const d of devices) {
    const group = grouped.get(d.customer_id) || { customer_id: d.customer_id, customer_name: names.get(d.customer_id) || '', devices: [] };
    group.devices.push({ ...d, open_task: openTask.get(d.asset_id) || null, in_campaign: campaign.get(d.asset_id) || null });
    grouped.set(d.customer_id, group);
  }
  return { title: await sourceTitle(source, store), customers: [...grouped.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name)) };
}

/** Per-device progress of a campaign (see the statuses above). */
async function progress(campaign, store = db) {
  const items = await store.prepare(`SELECT i.*, s.done AS subtask_done, a.reviewed_at, a.name AS asset_name, c.name AS customer_name, t.title AS task_title, t.status AS task_status, u.name AS owner_name
    FROM remediation_campaign_items i JOIN customer_assets a ON a.id = i.asset_id JOIN customers c ON c.id = i.customer_id
    LEFT JOIN task_subtasks s ON s.id = i.subtask_id LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN users u ON u.id = t.assigned_to
    WHERE i.campaign_id = ? ORDER BY c.name, a.id`).all(campaign.id);
  const stillAffected = new Set((await affected({ type: campaign.source_type, ref: campaign.source_ref }, store)).map(d => d.asset_id));
  const started = String(campaign.created_at);
  return items.map(item => {
    const reviewedSince = !!item.reviewed_at && String(item.reviewed_at) >= started.slice(0, 10);
    const status = item.exception_reason ? 'exception'
      : !stillAffected.has(Number(item.asset_id)) && reviewedSince ? 'verified'
        : item.subtask_done ? 'upgraded' : 'planned';
    return { asset_id: Number(item.asset_id), asset_name: decrypt(item.asset_name), customer_id: Number(item.customer_id), customer_name: decrypt(item.customer_name),
      task_id: item.task_id ? Number(item.task_id) : null, task_title: item.task_title, owner_name: item.owner_name || null,
      status, exception_reason: item.exception_reason || null, reviewed_at: item.reviewed_at || null,
      // Upgraded but not yet shown fixed by a review: the next step is a device review.
      needs_review: status === 'upgraded' || (!stillAffected.has(Number(item.asset_id)) && !reviewedSince && !item.exception_reason) };
  });
}

module.exports = { SOURCES, OPEN_TASK, checkSource, affected, sourceTitle, preview, progress };
