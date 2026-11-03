/**
 * Customer data quality (enhancement E06): one work queue of things that are wrong
 * or missing on customer records, each with who owns the customer and where to fix
 * it. Only fixable rules; a manager may dismiss an item with a reason (kept, and
 * undoable). Asset rules are counted per customer, so one customer with many old
 * devices is one item, not dozens.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');
const { productFor, assessVersion, loadProducts } = require('./softwareCompliance');

const REVIEW_DAYS = 90;
const RULES = {
  no_contact: 'No contact email or primary contact',
  no_owner: 'Managed customer without a responsible team or service manager',
  no_current_contract: 'Managed customer without a contract covering today',
  untracked_versions: 'Device software that cannot be checked against Software versions',
  review_due: `Devices not reviewed in ${REVIEW_DAYS} days`,
};

const dayOffset = (today, days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every open item (dismissed ones flagged), for active customers. */
async function dataQualityItems({ store = db, today = appTime.today() } = {}) {
  const customers = await store.prepare(`SELECT c.id, c.name, c.contact_email, c.primary_contact,
      m.managed_services_enabled, m.responsible_team_id, m.service_manager_id, t.name AS team_name, u.name AS manager_name
    FROM customers c
    LEFT JOIN managed_customer_configurations m ON m.customer_id = c.id
    LEFT JOIN teams t ON t.id = m.responsible_team_id
    LEFT JOIN users u ON u.id = m.service_manager_id
    WHERE c.active = 1`).all();
  const current = new Set((await store.prepare('SELECT DISTINCT customer_id FROM customer_contracts WHERE start_date <= ? AND end_date >= ?').all(today, today)).map(r => Number(r.customer_id)));
  const assets = await store.prepare("SELECT id, customer_id, vendor, model, software_version, reviewed_at FROM customer_assets WHERE lifecycle_status = 'active'").all();
  const products = await loadProducts(store);
  const dismissed = new Map((await store.prepare(`SELECT d.customer_id, d.rule, d.reason, d.dismissed_at, u.name AS dismissed_by_name
    FROM customer_quality_dismissals d LEFT JOIN users u ON u.id = d.dismissed_by`).all()).map(r => [`${r.customer_id}:${r.rule}`, r]));

  const reviewCutoff = dayOffset(today, -REVIEW_DAYS);
  const perCustomer = new Map();
  for (const a of assets) {
    const counts = perCustomer.get(Number(a.customer_id)) || { untracked: 0, review: 0 };
    if (!a.reviewed_at || a.reviewed_at.slice(0, 10) < reviewCutoff) counts.review++;
    const version = decrypt(a.software_version);
    if (version && products.length) {
      const asset = { vendor: decrypt(a.vendor), model: decrypt(a.model) };
      const product = productFor(asset, products);
      const status = product ? assessVersion(version, product, today).status : 'no_product';
      if (['no_product', 'unreadable', 'unknown_line'].includes(status)) counts.untracked++;
    }
    perCustomer.set(Number(a.customer_id), counts);
  }

  const items = [];
  for (const c of customers) {
    const id = Number(c.id), name = decrypt(c.name), managed = !!c.managed_services_enabled;
    const owner = c.manager_name || c.team_name || null;
    const add = (rule, detail, fix) => {
      const d = dismissed.get(`${id}:${rule}`);
      items.push({ customer_id: id, customer_name: name, rule, title: RULES[rule], detail, fix, owner,
        dismissed: d ? { reason: d.reason, at: d.dismissed_at, by: d.dismissed_by_name } : null });
    };
    if (!decrypt(c.contact_email) && !decrypt(c.primary_contact)) add('no_contact', 'Add who to contact at the customer.', `/customers/${id}`);
    if (managed && (!c.responsible_team_id || !c.service_manager_id))
      add('no_owner', [!c.responsible_team_id && 'no responsible team', !c.service_manager_id && 'no service manager'].filter(Boolean).join(' and ').replace(/^./, s => s.toUpperCase()) + '.', `/customers/${id}?section=service-configuration`);
    if (managed && !current.has(id)) add('no_current_contract', 'Add the contract, or renew the one that ended.', `/customers/${id}?section=contracts`);
    const counts = perCustomer.get(id);
    if (counts?.untracked) add('untracked_versions', `${plural(counts.untracked, 'device')}: vendor not followed, or version not understood.`, `/customers/${id}?section=assets`);
    if (counts?.review) add('review_due', `${plural(counts.review, 'device')} to review.`, `/customers/${id}?section=assets&view=review`);
  }
  return items.sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.rule.localeCompare(b.rule));
}

module.exports = { RULES, REVIEW_DAYS, dataQualityItems };
