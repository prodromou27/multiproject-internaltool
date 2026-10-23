/**
 * Asset coverage follows the contracts. An asset in a contract whose period
 * includes today is covered: 'managed' for a managed customer, 'support' for any
 * other. When no contract covers it any more, an asset the contracts had set goes
 * back to 'neither'; one a person set by hand (coverage_source NULL) is left alone.
 * Retired and decommissioned assets are not changed.
 *
 * Run after contracts change (routes/customer-contracts.js, the customer import),
 * when managed services are switched on or off, and each morning (reminders.js)
 * for contracts that start or end that day. Each change is a new asset version
 * with a history entry.
 */
const db = require('./db');
const appTime = require('./appTime');

const inList = ids => ids.map(() => '?').join(',');

async function syncCoverage({ customerIds = null, store = db, today = appTime.today(), userId = null } = {}) {
  if (Array.isArray(customerIds) && !customerIds.length) return { changed: 0 };
  const scope = customerIds ? ` AND a.customer_id IN (${inList(customerIds)})` : '';
  const assets = await store.prepare(`SELECT a.id, a.customer_id, a.coverage_type, a.coverage_source, a.version FROM customer_assets a
    WHERE a.lifecycle_status NOT IN ('retired','decommissioned')${scope}`).all(...(customerIds || []));
  if (!assets.length) return { changed: 0 };
  const covered = new Set((await store.prepare(`SELECT DISTINCT ca.asset_id FROM customer_contract_assets ca
    JOIN customer_contracts c ON c.id = ca.contract_id WHERE c.start_date <= ? AND c.end_date >= ?`).all(today, today)).map(r => Number(r.asset_id)));
  const managed = new Set((await store.prepare('SELECT customer_id FROM managed_customer_configurations WHERE managed_services_enabled = 1').all()).map(r => Number(r.customer_id)));

  let changed = 0;
  for (const asset of assets) {
    const inContract = covered.has(Number(asset.id));
    const wanted = inContract ? (managed.has(Number(asset.customer_id)) ? 'managed' : 'support') : asset.coverage_source === 'contract' ? 'neither' : null;
    if (!wanted) continue;
    const source = inContract ? 'contract' : null;
    if (wanted === asset.coverage_type) {
      // Already right: only note who decides it now (no new version).
      if ((asset.coverage_source || null) !== source) await store.prepare('UPDATE customer_assets SET coverage_source = ? WHERE id = ?').run(source, asset.id);
      continue;
    }
    await store.transaction(async tx => {
      const updated = (await tx.prepare(`UPDATE customer_assets SET coverage_type = ?, coverage_source = ?, updated_by = COALESCE(?, updated_by), updated_at = app_now(), version = version + 1
        WHERE id = ? AND version = ? RETURNING id, customer_id, lifecycle_status, coverage_type, version`).all(wanted, source, userId, asset.id, asset.version))[0];
      if (!updated) return; // saved by someone meanwhile: the next run looks again
      await tx.prepare('INSERT INTO customer_asset_history (asset_id, customer_id, user_id, action, lifecycle_status, coverage_type, version) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(updated.id, updated.customer_id, userId, 'updated', updated.lifecycle_status, updated.coverage_type, updated.version);
      changed++;
    });
  }
  return { changed };
}

module.exports = { syncCoverage };
