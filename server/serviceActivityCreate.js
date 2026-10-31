/**
 * Creating a service activity: authorization, team resolution, validation and the
 * insert. Shared by the form (POST /api/service-activities) and the Excel import,
 * so both enforce exactly the same rules.
 */
const db = require('./db');
const { notifyShared } = require('./notifications');
const { logAudit } = require('./auditLog');
const { generateActivityReference, isCustomerAuthorizedForEngineer } = require('./serviceActivities');
const { decrypt: decryptField, encrypt: encryptField } = require('./fieldCipher');
const { getStatusConfig, terminalCompletedValue } = require('./serviceActivityStatus');
const { validateActivityPayload, assertCategoryUsableByTeam } = require('./serviceActivityValidation');
const { writeBackTicketOnCompletion } = require('./routes/serviceActivitiesAccess');

/* The customers this person can log activity for, in-house infrastructure first
   (the managed-services team's most frequent choice), then A–Z. Managers: every
   tracked customer; others: their teams' customers and those they were added to. */
async function activityCustomersFor(req) {
  const columns = `c.id, c.name, c.require_duration, c.require_ticket_reference, c.require_technology,
      c.require_notes, c.require_billable_classification, c.is_internal`;
  let rows;
  if (req.user.role === 'manager') {
    rows = await db.prepare(`SELECT ${columns} FROM customers c WHERE c.active = 1 AND c.service_activity_enabled = 1`).all();
  } else {
    const teamIds = [...req.enabledTeamIds];
    const placeholders = teamIds.map(() => '?').join(',');
    const byTeam = await db.prepare(`
      SELECT DISTINCT ${columns} FROM customers c
      JOIN customer_teams ct ON ct.customer_id = c.id
      WHERE c.active = 1 AND c.service_activity_enabled = 1 AND ct.team_id IN (${placeholders})
    `).all(...teamIds);
    const byName = await db.prepare(`
      SELECT ${columns} FROM customers c JOIN customer_engineers ce ON ce.customer_id = c.id
      WHERE c.active = 1 AND c.service_activity_enabled = 1 AND ce.user_id = ?
    `).all(req.user.id);
    const seen = new Set();
    rows = [...byTeam, ...byName].filter(c => !seen.has(Number(c.id)) && seen.add(Number(c.id)));
  }
  // customers.name is encrypted at rest: decrypted here, sorted in JS (not on ciphertext).
  return rows.map(c => ({ ...c, name: decryptField(c.name), is_internal: !!c.is_internal }))
    .sort((a, b) => (b.is_internal - a.is_internal) || a.name.localeCompare(b.name));
}

// Optional version recorded against one asset on an activity (e.g. what it was upgraded to).
const assetVersion = (versions, assetId) => {
  const value = versions && versions[String(assetId)];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/* A completed activity that records a version for an asset keeps the inventory
   current: the asset's software_version follows it. Skipped when a later-dated
   activity already recorded a version for that asset, so back-filling an old
   upgrade never rolls the inventory backwards. */
async function syncAssetVersions(tx, { activityId, customerId, activityDate, userId }) {
  const recorded = await tx.prepare('SELECT asset_id,version FROM service_activity_assets WHERE service_activity_id=? AND version IS NOT NULL').all(activityId);
  for (const { asset_id: assetId, version } of recorded) {
    const later = await tx.prepare(`SELECT 1 FROM service_activity_assets saa JOIN service_activities sa ON sa.id=saa.service_activity_id
      WHERE saa.asset_id=? AND saa.version IS NOT NULL AND sa.id!=? AND sa.activity_date>?`).get(assetId, activityId, activityDate);
    if (later) continue;
    const asset = await tx.prepare('SELECT software_version FROM customer_assets WHERE id=? AND customer_id=?').get(assetId, customerId);
    const replaced = asset ? decryptField(asset.software_version) : null;
    if (!asset || replaced === version) continue;
    // Keep what the inventory said before, so the customer's change log reads "from -> to".
    if (replaced) await tx.prepare('UPDATE service_activity_assets SET previous_version=? WHERE service_activity_id=? AND asset_id=? AND previous_version IS NULL').run(replaced, activityId, assetId);
    await tx.prepare('UPDATE customer_assets SET software_version=?,updated_by=?,updated_at=app_now(),version=version+1 WHERE id=? AND customer_id=?')
      .run(encryptField(version), userId, assetId, customerId);
  }
}

// The title is optional: left blank, the activity is named after its category,
// subcategory and the assets worked on, e.g. "Upgrade – Firmware: FW-01".
const blankTitle = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
async function defaultActivityTitle({ categoryId, subcategoryId, assetIds, customerId }) {
  const id = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const category = id(categoryId) ? await db.prepare('SELECT name FROM activity_categories WHERE id = ?').get(id(categoryId)) : null;
  const subcategory = id(subcategoryId) ? await db.prepare('SELECT name FROM activity_subcategories WHERE id = ?').get(id(subcategoryId)) : null;
  const ids = Array.isArray(assetIds) ? assetIds.map(id).filter(Boolean).slice(0, 50) : [];
  const assets = ids.length && id(customerId)
    ? (await db.prepare(`SELECT name FROM customer_assets WHERE customer_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(id(customerId), ...ids)).map(row => decryptField(row.name))
    : [];
  const what = [category?.name, subcategory?.name].filter(Boolean).join(' – ') || 'Service activity';
  const on = assets.length ? `: ${assets.slice(0, 2).join(', ')}${assets.length > 2 ? ` +${assets.length - 2}` : ''}` : '';
  return `${what}${on}`.slice(0, 300);
}

/**
 * Everything checked before an activity is created. Returns { status, error } or
 * { body, customerId, teamId } ready for createActivity. The body's title is filled
 * in when left blank. Engineer and team are never taken from the client.
 */
async function prepareActivityCreate(req, body) {
  const customerId = body.customer_id;
  if (blankTitle(body.title)) body.title = await defaultActivityTitle({ categoryId: body.category_id, subcategoryId: body.subcategory_id, assetIds: body.asset_ids, customerId });
  if (!customerId) return { status: 400, error: 'Customer is required' };

  let teamId;
  if (req.user.role === 'manager') {
    // A manager may log on behalf of any team assigned to the customer; the
    // customer's first assigned team unless a valid one was supplied.
    const assigned = await db.prepare('SELECT team_id FROM customer_teams WHERE customer_id = ?').all(customerId);
    if (!assigned.length) return { status: 400, error: 'Customer has no team assigned' };
    teamId = assigned.some(t => t.team_id === body.team_id) ? body.team_id : assigned[0].team_id;
  } else {
    const authorized = await isCustomerAuthorizedForEngineer(req.user.id, customerId, req.enabledTeamIds);
    if (!authorized) return { status: 403, error: 'You are not authorized to log activity for this customer' };
    // One of the engineer's enabled teams that is actually assigned to this customer.
    const teamIds = [...req.enabledTeamIds];
    const placeholders = teamIds.map(() => '?').join(',');
    const match = await db.prepare(`SELECT team_id FROM customer_teams WHERE customer_id = ? AND team_id IN (${placeholders})`).get(customerId, ...teamIds);
    // An engineer added to the customer individually logs it under a team of their own.
    teamId = match?.team_id ?? Math.min(...teamIds);
  }

  const validation = await validateActivityPayload(body, { customerId, isCreate: true });
  if (validation.error) return { status: 400, error: validation.error };
  const categoryError = await assertCategoryUsableByTeam(body.category_id, teamId);
  if (categoryError) return { status: 400, error: categoryError };
  return { body, customerId, teamId };
}

/**
 * Saves a prepared activity. An activity records work already done, so it is
 * always completed. `announce` posts it to the shared channels (when an admin has
 * switched that on); a bulk import leaves it off rather than posting every row.
 */
async function createActivity(req, { body, customerId, teamId }, { announce = true, auditAction = 'activity_created' } = {}) {
  const engineerId = req.user.id;
  const status = await terminalCompletedValue(await getStatusConfig());

  const activity = await db.transaction(async (tx) => {
    const reference = await generateActivityReference(tx);
    const result = await tx.prepare(`
      INSERT INTO service_activities (
        activity_reference, customer_id, team_id, engineer_id, activity_date, start_time, end_time,
        duration_minutes, category_id, subcategory_id, title, description, status, priority,
        work_location, customer_impact, ticket_reference, external_case_reference,
        billable_classification, billable_minutes, follow_up_required, follow_up_date,
        related_project_id, related_task_id, related_visit_id,
        change_type, change_reason, previous_state, new_state, change_risk, rollback_available,
        customer_approval_reference, verified_by, verification_notes,
        created_by, updated_by, completed_at
      ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?)
    `).run(
      reference, customerId, teamId, engineerId, body.activity_date, body.start_time || null, body.end_time || null,
      body.duration_minutes || null, body.category_id, body.subcategory_id || null, body.title.trim(), body.description || null,
      status, body.priority || null,
      body.work_location || null, body.customer_impact || null, body.ticket_reference || null, body.external_case_reference || null,
      body.billable_classification || null, body.billable_minutes || null, body.follow_up_required ? 1 : 0, body.follow_up_date || null,
      body.related_project_id || null, body.related_task_id || null, body.related_visit_id || null,
      body.change_type || null, body.change_reason || null, body.previous_state || null, body.new_state || null,
      body.change_risk || null, body.rollback_available ? 1 : null,
      body.customer_approval_reference || null, body.verified_by || null, body.verification_notes || null,
      engineerId, engineerId, body.activity_date + ' 00:00:00'
    );
    const id = result.lastInsertRowid;

    if (Array.isArray(body.technology_ids)) {
      const insTech = tx.prepare('INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (?, ?)');
      for (const techId of body.technology_ids) {
        if (Number.isInteger(techId) && techId > 0) await insTech.run(id, techId);
      }
    }
    if (Array.isArray(body.asset_ids)) {
      const insAsset = tx.prepare('INSERT INTO service_activity_assets (service_activity_id,asset_id,customer_id,version) VALUES (?,?,?,?)');
      for (const assetId of body.asset_ids) await insAsset.run(id, assetId, Number(customerId), assetVersion(body.asset_versions, assetId));
      await syncAssetVersions(tx, { activityId: id, customerId: Number(customerId), activityDate: body.activity_date, userId: engineerId });
    }
    return { id, reference };
  });

  await logAudit(db, req, 'service_activity', activity.id, body.title.trim(), auditAction,
    `customer_id=${customerId}; category_id=${body.category_id}; status=${status}`);

  // Logged as completed (the after-the-fact case), so the referenced RT ticket is
  // updated the same as on a later completion.
  await writeBackTicketOnCompletion(req, { id: activity.id, title: body.title.trim(), customerId, ticketReference: body.ticket_reference });

  if (announce) {
    const logged = await db.prepare('SELECT c.name AS customer, cat.name AS category FROM customers c, activity_categories cat WHERE c.id = ? AND cat.id = ?').get(customerId, body.category_id);
    notifyShared('activity_logged', { title: '🛠️ Service activity logged', body: `**${req.user.name}** logged **${body.title.trim()}**.`,
      facts: [{ name: 'Customer', value: decryptField(logged?.customer) || '—' }, { name: 'Category', value: logged?.category || '—' },
        ...(body.duration_minutes ? [{ name: 'Time', value: `${body.duration_minutes} min` }] : []), { name: 'Reference', value: activity.reference }] });
  }
  return activity;
}

module.exports = { activityCustomersFor, assetVersion, syncAssetVersions, blankTitle, defaultActivityTitle, prepareActivityCreate, createActivity };
