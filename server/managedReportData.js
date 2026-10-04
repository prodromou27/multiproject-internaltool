/**
 * Extra data for customer reports: the change log (what was changed or upgraded,
 * on which device, to which version), tickets resolved in the period, and the
 * asset inventory with support/warranty status.
 */
const db = require('./db');
const { decrypt } = require('./fieldCipher');

const dayAfter = to => { const date = new Date(`${to}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString(); };

/**
 * Activities in the period that changed something: they touched an asset, used a
 * change/upgrade/patch category, or recorded a change type. One row per activity
 * and asset, with the version recorded and the version that asset had before.
 */
async function getChanges(customerId, from, to, store = db) {
  const rows = await store.prepare(`SELECT sa.id, sa.activity_reference, sa.activity_date, sa.title, sa.status,
      sa.change_type, sa.change_risk, sa.change_reason, sa.previous_state, sa.new_state, sa.customer_approval_reference,
      cat.name AS category_name, u.name AS engineer_name,
      a.id AS asset_id, a.name AS asset_name, a.asset_type, saa.version, saa.previous_version AS replaced_version
    FROM service_activities sa
    JOIN activity_categories cat ON cat.id = sa.category_id
    JOIN users u ON u.id = sa.engineer_id
    LEFT JOIN service_activity_assets saa ON saa.service_activity_id = sa.id
    LEFT JOIN customer_assets a ON a.id = saa.asset_id
    WHERE sa.customer_id = ? AND sa.activity_date BETWEEN ? AND ?
      AND (saa.asset_id IS NOT NULL OR sa.change_type IS NOT NULL
        OR LOWER(cat.name) LIKE '%change%' OR LOWER(cat.name) LIKE '%upgrade%' OR LOWER(cat.name) LIKE '%patch%')
    ORDER BY sa.activity_date, sa.id, a.id`).all(customerId, from, to);
  if (!rows.length) return [];

  // Earlier recorded versions per asset, to show "from -> to".
  const assetIds = [...new Set(rows.map(row => row.asset_id).filter(Boolean))];
  const history = assetIds.length ? await store.prepare(`SELECT saa.asset_id, saa.version, sa.activity_date, sa.id
    FROM service_activity_assets saa JOIN service_activities sa ON sa.id = saa.service_activity_id
    WHERE saa.asset_id IN (${assetIds.map(() => '?').join(',')}) AND saa.version IS NOT NULL
    ORDER BY sa.activity_date, sa.id`).all(...assetIds) : [];
  const previousVersion = row => {
    let previous = null;
    for (const entry of history) {
      if (Number(entry.asset_id) !== Number(row.asset_id)) continue;
      if (entry.activity_date < row.activity_date || (entry.activity_date === row.activity_date && Number(entry.id) < Number(row.id))) previous = entry.version;
    }
    return previous;
  };

  return rows.map(row => ({
    activity_id: Number(row.id),
    reference: row.activity_reference,
    date: row.activity_date,
    title: row.title,
    status: row.status,
    category: row.category_name,
    engineer: row.engineer_name,
    asset: row.asset_id ? decrypt(row.asset_name) : null,
    asset_type: row.asset_type || null,
    // What the inventory said before this upgrade, else the last version recorded earlier.
    previous_version: row.asset_id && row.version ? (row.replaced_version || previousVersion(row)) : null,
    new_version: row.version || null,
    change_type: row.change_type || null,
    risk: row.change_risk || null,
    reason: row.change_reason || null,
    previous_state: row.previous_state || null,
    new_state: row.new_state || null,
    approval_reference: row.customer_approval_reference || null,
  }));
}

/** Tickets resolved (or closed, when no resolution time is recorded) in the period. */
async function getResolvedTickets(customerId, from, to, store = db) {
  return store.prepare(`SELECT ticket_number, subject, normalized_priority, owner_name, created_at_external,
      COALESCE(resolved_at_external, closed_at_external) AS resolved_at
    FROM external_tickets
    WHERE customer_id = ? AND COALESCE(resolved_at_external, closed_at_external) >= ? AND COALESCE(resolved_at_external, closed_at_external) < ?
    ORDER BY COALESCE(resolved_at_external, closed_at_external), id`).all(customerId, `${from}T00:00:00.000Z`, dayAfter(to));
}

/**
 * Assets in service at the end of the period, with support and warranty status
 * relative to that date: expired, expiring within 90 days, or covered.
 */
async function getAssets(customerId, asOf, store = db) {
  const rows = await store.prepare(`SELECT a.id, a.name, a.asset_type, a.vendor, a.model, a.software_version, a.environment, a.criticality,
      a.lifecycle_status, a.coverage_type, a.support_provider, a.support_end_date, a.warranty_expiry_date
    FROM customer_assets a WHERE a.customer_id = ? AND a.lifecycle_status NOT IN ('retired', 'decommissioned')
    ORDER BY a.id`).all(customerId);
  const reference = new Date(`${asOf}T00:00:00.000Z`);
  const soon = new Date(reference); soon.setUTCDate(soon.getUTCDate() + 90);
  const status = date => {
    if (!date) return null;
    const value = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(value.getTime())) return null;
    return value < reference ? 'Expired' : value <= soon ? 'Expires within 90 days' : 'Covered';
  };
  return rows.map(row => {
    const support = status(row.support_end_date), warranty = status(row.warranty_expiry_date);
    return {
      id: Number(row.id),
      name: decrypt(row.name),
      type: row.asset_type,
      vendor: decrypt(row.vendor) || null,
      model: decrypt(row.model) || null,
      version: decrypt(row.software_version) || null,
      environment: row.environment,
      criticality: row.criticality,
      lifecycle: row.lifecycle_status,
      coverage: row.coverage_type,
      support_provider: decrypt(row.support_provider) || null,
      support_end: row.support_end_date || null,
      support_status: support,
      warranty_end: row.warranty_expiry_date || null,
      warranty_status: warranty,
      needs_attention: support === 'Expired' || support === 'Expires within 90 days' || warranty === 'Expired' || warranty === 'Expires within 90 days',
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

module.exports = { getChanges, getResolvedTickets, getAssets };
