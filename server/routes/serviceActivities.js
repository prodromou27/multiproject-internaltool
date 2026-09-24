/**
 * Service Activity Tracking routes. Validation, status-config lookup and the
 * access-control middleware live in separate modules (serviceActivityValidation.js,
 * serviceActivityStatus.js, serviceActivitiesAccess.js) — this file is routing only.
 */
const router  = require('express').Router();
const ExcelJS = require('exceljs');
const db      = require('../db');
const { requireAuth, requireManager, requireDownloadAuth } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { generateActivityReference, isCustomerAuthorizedForEngineer } = require('../serviceActivities');
const { uploadDir, upload, safeStoredName, safeDownloadName, hasAllowedMagic } = require('../uploadUtils');
const fs = require('fs');
const path = require('path');
const cipher = require('../cipher');
const { decrypt: decryptField, encrypt: encryptField } = require('../fieldCipher');
const { getServiceActivitySettings } = require('./serviceActivitySettings');
const { getStatusConfig, terminalCompletedValue } = require('../serviceActivityStatus');
const { validateActivityPayload, assertCategoryUsableByTeam, assertAttachmentRuleSatisfied } = require('../serviceActivityValidation');
const {
  positiveRouteId, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer,
  resolveActivityTeam, writeBackTicketOnCompletion, categoriesForTeams, activityFilters,
} = require('./serviceActivitiesAccess');

router.get('/meta', requireAuth, requireServiceActivityAccess, async (req, res) => {
  const [categories, subcategories, technologies, statuses, settings] = await Promise.all([
    categoriesForTeams(req.enabledTeamIds),
    db.prepare('SELECT * FROM activity_subcategories WHERE active = 1 ORDER BY sort_order, name').all(),
    db.prepare('SELECT * FROM technologies WHERE active = 1 ORDER BY sort_order, name').all(),
    getStatusConfig(),
    getServiceActivitySettings(),
  ]);

  // customers.name is encrypted at rest (see fieldCipher.js) — decrypt before
  // returning/sorting; sorting in SQL on ciphertext would be meaningless.
  let customers;
  if (req.user.role === 'manager') {
    const rows = await db.prepare(`
      SELECT id, name, require_duration, require_ticket_reference, require_technology,
        require_notes, require_billable_classification FROM customers WHERE active = 1 AND service_activity_enabled = 1
    `).all();
    customers = rows.map(c => ({ ...c, name: decryptField(c.name) })).sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const teamIds = [...req.enabledTeamIds];
    const placeholders = teamIds.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT DISTINCT c.id, c.name, c.require_duration, c.require_ticket_reference, c.require_technology,
        c.require_notes, c.require_billable_classification FROM customers c
      JOIN customer_teams ct ON ct.customer_id = c.id
      WHERE c.active = 1 AND c.service_activity_enabled = 1 AND ct.team_id IN (${placeholders})
    `).all(...teamIds);
    // Filter out customers with explicit engineer restrictions that don't include this engineer
    const restrictedIds = new Set((await db.prepare('SELECT DISTINCT customer_id FROM customer_engineers').all()).map(r => r.customer_id));
    const allowedRestricted = new Set((await db.prepare('SELECT customer_id FROM customer_engineers WHERE user_id = ?').all(req.user.id)).map(r => r.customer_id));
    customers = rows.filter(c => !restrictedIds.has(c.id) || allowedRestricted.has(c.id))
      .map(c => ({ ...c, name: decryptField(c.name) })).sort((a, b) => a.name.localeCompare(b.name));
  }

  res.json({
    categories: categories.map(c => ({ ...c, subcategories: subcategories.filter(s => s.category_id === c.id) })),
    technologies, statuses, customers, settings,
  });
});

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
    if (!asset || decryptField(asset.software_version) === version) continue;
    await tx.prepare('UPDATE customer_assets SET software_version=?,updated_by=?,updated_at=app_now(),version=version+1 WHERE id=? AND customer_id=?')
      .run(encryptField(version), userId, assetId, customerId);
  }
}

/* Scoped asset choices for activity capture. Asset administration remains manager-only. */
router.get('/assets',requireAuth,requireServiceActivityAccess,async (req,res) => {
  const value=req.query.customer_id;
  if (typeof value!=='string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ error:'Invalid customer ID' });
  const customerId=Number(value);
  if (req.user.role!=='manager' && !await isCustomerAuthorizedForEngineer(req.user.id,customerId,req.enabledTeamIds)) return res.status(403).json({ error:'You are not authorized to view assets for this customer' });
  const rows=await db.prepare("SELECT id,name,asset_tag,asset_type,hostname,lifecycle_status FROM customer_assets WHERE customer_id=? AND lifecycle_status IN ('active','spare') ORDER BY id LIMIT 501").all(customerId);
  if (rows.length>500) return res.status(413).json({ error:'This customer has more than 500 active assets; retire unused records before selecting them' });
  res.json(rows.map(row => ({ ...row,name:decryptField(row.name),asset_tag:decryptField(row.asset_tag),hostname:decryptField(row.hostname) })));
});

/* ── List (server-side pagination + filters) ─────────────────────────── */
router.get('/', requireAuth, requireServiceActivityAccess, async (req, res) => {
  let filters;
  try { filters = activityFilters(req.query, req.user); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const { where, params, page, limit, offset } = filters;
  const rows = await db.prepare(`
    SELECT sa.id, sa.version, sa.activity_reference, sa.activity_date, sa.title, sa.status, sa.duration_minutes,
      sa.billable_classification, sa.follow_up_required, sa.follow_up_date, sa.ticket_reference,
      c.name AS customer_name, cat.name AS category_name, u.name AS engineer_name
    FROM service_activities sa
    JOIN customers c ON c.id = sa.customer_id
    JOIN activity_categories cat ON cat.id = sa.category_id
    JOIN users u ON u.id = sa.engineer_id
    ${where}
    ORDER BY sa.activity_date DESC, sa.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = await db.prepare(`SELECT COUNT(*) AS total FROM service_activities sa ${where}`).get(...params);
  res.json({ rows: rows.map(r => ({ ...r, customer_name: decryptField(r.customer_name) })), total, page: Number(page), page_size: limit });
});

/* ── Detail ───────────────────────────────────────────────────────────── */
router.get('/:id(\\d+)', requireAuth, requireServiceActivityAccess, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const activity = await db.prepare(`
    SELECT sa.*, c.name AS customer_name, cat.name AS category_name, sub.name AS subcategory_name,
      u.name AS engineer_name, t.name AS team_name,
      p.title AS related_project_title, tk.title AS related_task_title, mv.title AS related_visit_title,
      ft.title AS follow_up_task_title
    FROM service_activities sa
    JOIN customers c ON c.id = sa.customer_id
    JOIN activity_categories cat ON cat.id = sa.category_id
    LEFT JOIN activity_subcategories sub ON sub.id = sa.subcategory_id
    JOIN users u ON u.id = sa.engineer_id
    JOIN teams t ON t.id = sa.team_id
    LEFT JOIN projects p ON p.id = sa.related_project_id
    LEFT JOIN tasks tk ON tk.id = sa.related_task_id
    LEFT JOIN maintenance_visits mv ON mv.id = sa.related_visit_id
    LEFT JOIN tasks ft ON ft.id = sa.follow_up_task_id
    WHERE sa.id = ?
  `).get(id);
  if (!activity) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && activity.engineer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const technologies = await db.prepare(`
    SELECT tech.id, tech.name FROM service_activity_technologies sat
    JOIN technologies tech ON tech.id = sat.technology_id WHERE sat.service_activity_id = ?
  `).all(id);

  const assets = (await db.prepare(`SELECT a.id,a.name,a.asset_tag,a.asset_type,a.hostname,a.lifecycle_status,saa.version
    FROM service_activity_assets saa JOIN customer_assets a ON a.id=saa.asset_id
    WHERE saa.service_activity_id=? ORDER BY a.id`).all(id)).map(row => ({ ...row,name:decryptField(row.name),asset_tag:decryptField(row.asset_tag),hostname:decryptField(row.hostname) }));

  res.json({ ...activity, customer_name: decryptField(activity.customer_name), technologies,assets });
});

/* ── Create ───────────────────────────────────────────────────────────── */
router.post('/', requireAuth, requireServiceActivityAccess, async (req, res) => {
  const body = req.body || {};
  const customerId = body.customer_id;
  if (!customerId) return res.status(400).json({ error: 'Customer is required' });

  // Server-side authorization: never trust engineer/team from the client.
  let teamId;
  if (req.user.role === 'manager') {
    // Manager may log on behalf of any team assigned to the customer; pick the
    // customer's first assigned team unless a valid one was supplied.
    const assigned = await db.prepare('SELECT team_id FROM customer_teams WHERE customer_id = ?').all(customerId);
    if (!assigned.length) return res.status(400).json({ error: 'Customer has no team assigned' });
    teamId = assigned.some(t => t.team_id === body.team_id) ? body.team_id : assigned[0].team_id;
  } else {
    const authorized = await isCustomerAuthorizedForEngineer(req.user.id, customerId, req.enabledTeamIds);
    if (!authorized) return res.status(403).json({ error: 'You are not authorized to log activity for this customer' });
    // Pick one of the engineer's enabled teams that's actually assigned to this customer.
    const teamIds = [...req.enabledTeamIds];
    const placeholders = teamIds.map(() => '?').join(',');
    const match = await db.prepare(`SELECT team_id FROM customer_teams WHERE customer_id = ? AND team_id IN (${placeholders})`).get(customerId, ...teamIds);
    teamId = match.team_id;
  }

  const validation = await validateActivityPayload(body, { customerId, isCreate: true });
  if (validation.error) return res.status(400).json({ error: validation.error });
  const categoryError = await assertCategoryUsableByTeam(body.category_id, teamId);
  if (categoryError) return res.status(400).json({ error: categoryError });

  const engineerId = req.user.id; // never trust client-supplied engineer_id

  const statuses = await getStatusConfig();
  if (body.status && !statuses.some(s => s.value === body.status)) return res.status(400).json({ error: 'Invalid status' });
  const status = body.status && statuses.some(s => s.value === body.status) ? body.status : (statuses[0]?.value || 'planned');
  const completedValue = await terminalCompletedValue(statuses);

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
      engineerId, engineerId, status === completedValue ? (body.activity_date + ' 00:00:00') : null
    );
    const id = result.lastInsertRowid;

    if (Array.isArray(body.technology_ids)) {
      const insTech = tx.prepare('INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (?, ?)');
      for (const techId of body.technology_ids) {
        if (Number.isInteger(techId) && techId > 0) await insTech.run(id, techId);
      }
    }
    if (Array.isArray(body.asset_ids)) {
      const insAsset=tx.prepare('INSERT INTO service_activity_assets (service_activity_id,asset_id,customer_id,version) VALUES (?,?,?,?)');
      for (const assetId of body.asset_ids) await insAsset.run(id,assetId,Number(customerId),assetVersion(body.asset_versions,assetId));
      if (status === completedValue) await syncAssetVersions(tx, { activityId:id, customerId:Number(customerId), activityDate:body.activity_date, userId:engineerId });
    }
    return { id, reference };
  });

  await logAudit(db, req, 'service_activity', activity.id, body.title.trim(), 'activity_created',
    `customer_id=${customerId}; category_id=${body.category_id}; status=${status}`);

  res.json({ id: activity.id, activity_reference: activity.reference });
});

/* ── Update ───────────────────────────────────────────────────────────── */
router.put('/:id', requireAuth, requireServiceActivityAccess, requireOwnedActivity, async (req, res) => {
  const existing = req.activity;
  const id = existing.id;

  const body = req.body || {};
  if (body.version === undefined) return res.status(428).json({ error: 'Reload the activity before editing: version is required' });
  if (!Number.isSafeInteger(body.version) || body.version < 1) return res.status(400).json({ error: 'Invalid activity version' });
  if (body.version !== existing.version) return res.status(409).json({ error: 'Activity changed. Your draft is preserved; reload the latest activity before saving.', code: 'ACTIVITY_CONFLICT' });
  const customerId = body.customer_id || existing.customer_id;

  // Re-check access even if the customer is unchanged: assignments can be revoked.
  if (req.user.role !== 'manager') {
    const authorized = await isCustomerAuthorizedForEngineer(req.user.id, customerId, req.enabledTeamIds);
    if (!authorized) return res.status(403).json({ error: 'You are not authorized to log activity for this customer' });
  }

  const existingTechnologies = body.technology_ids === undefined
    ? await db.prepare('SELECT technology_id FROM service_activity_technologies WHERE service_activity_id = ?').all(id)
    : [];
  const existingAssets = body.asset_ids === undefined
    ? await db.prepare('SELECT asset_id FROM service_activity_assets WHERE service_activity_id=?').all(id)
    : [];
  const effective = { ...existing, ...body, follow_up_task_id: existing.follow_up_task_id,
    technology_ids: body.technology_ids === undefined ? existingTechnologies.map(t => t.technology_id) : body.technology_ids,
    asset_ids: body.asset_ids === undefined ? existingAssets.map(row => row.asset_id) : body.asset_ids };

  const validation = await validateActivityPayload(effective, { customerId, isCreate: false });
  if (validation.error) return res.status(400).json({ error: validation.error });

  let teamId = existing.team_id;
  if (Number(customerId) !== existing.customer_id) {
    teamId = await resolveActivityTeam(req, customerId, existing.team_id);
    if (!teamId) return res.status(400).json({ error: 'Customer has no eligible team assigned' });
  }
  if (effective.category_id) {
    const categoryError = await assertCategoryUsableByTeam(effective.category_id, teamId);
    if (categoryError) return res.status(400).json({ error: categoryError });
  }

  const statuses = await getStatusConfig();
  if (body.status && !statuses.some(s => s.value === body.status)) return res.status(400).json({ error: 'Invalid status' });
  const completedValue = await terminalCompletedValue(statuses);
  const newStatus = body.status || existing.status;

  // Enforce "require attachment" only on the transition INTO Completed (the activity
  // already exists at this point, so attachments could have been uploaded first) —
  // not on historical activities that were already completed, and not on unrelated edits.
  if (newStatus === completedValue && existing.status !== completedValue) {
    const attachmentError = await assertAttachmentRuleSatisfied(id, body.category_id || existing.category_id);
    if (attachmentError) return res.status(400).json({ error: attachmentError });
  }

  const completedAt = newStatus === completedValue
    ? (existing.completed_at || (body.activity_date || existing.activity_date) + ' 00:00:00')
    : (newStatus === existing.status ? existing.completed_at : null);

  const updated = await db.transaction(async (tx) => {
    const result = await tx.prepare(`UPDATE service_activities SET
        customer_id=?, team_id=?, activity_date=COALESCE(?,activity_date), start_time=?, end_time=?,
        duration_minutes=?, category_id=COALESCE(?,category_id), subcategory_id=?,
        title=COALESCE(?,title), description=?, status=COALESCE(?,status), priority=?,
        work_location=?, customer_impact=?, ticket_reference=?, external_case_reference=?,
        billable_classification=?, billable_minutes=?, follow_up_required=COALESCE(?,follow_up_required), follow_up_date=?,
        related_project_id=?, related_task_id=?, related_visit_id=?,
        change_type=?, change_reason=?, previous_state=?, new_state=?, change_risk=?, rollback_available=?,
        customer_approval_reference=?, verified_by=?, verification_notes=?,
        updated_by=?, updated_at=app_now(), completed_at=?, version=version+1
      WHERE id=? AND version=?`)
      .run(
        customerId, teamId, body.activity_date || null, body.start_time !== undefined ? (body.start_time || null) : existing.start_time,
        body.end_time !== undefined ? (body.end_time || null) : existing.end_time,
        body.duration_minutes !== undefined ? (body.duration_minutes || null) : existing.duration_minutes,
        body.category_id || null, body.subcategory_id !== undefined ? (body.subcategory_id || null) : existing.subcategory_id,
        body.title?.trim() || null, body.description !== undefined ? (body.description || null) : existing.description,
        body.status || null, body.priority !== undefined ? (body.priority || null) : existing.priority,
        body.work_location !== undefined ? (body.work_location || null) : existing.work_location,
        body.customer_impact !== undefined ? (body.customer_impact || null) : existing.customer_impact,
        body.ticket_reference !== undefined ? (body.ticket_reference || null) : existing.ticket_reference,
        body.external_case_reference !== undefined ? (body.external_case_reference || null) : existing.external_case_reference,
        body.billable_classification !== undefined ? (body.billable_classification || null) : existing.billable_classification,
        body.billable_minutes !== undefined ? (body.billable_minutes || null) : existing.billable_minutes,
        body.follow_up_required != null ? (body.follow_up_required ? 1 : 0) : null,
        body.follow_up_date !== undefined ? (body.follow_up_date || null) : existing.follow_up_date,
        body.related_project_id !== undefined ? (body.related_project_id || null) : existing.related_project_id,
        body.related_task_id !== undefined ? (body.related_task_id || null) : existing.related_task_id,
        body.related_visit_id !== undefined ? (body.related_visit_id || null) : existing.related_visit_id,
        body.change_type !== undefined ? (body.change_type || null) : existing.change_type,
        body.change_reason !== undefined ? (body.change_reason || null) : existing.change_reason,
        body.previous_state !== undefined ? (body.previous_state || null) : existing.previous_state,
        body.new_state !== undefined ? (body.new_state || null) : existing.new_state,
        body.change_risk !== undefined ? (body.change_risk || null) : existing.change_risk,
        body.rollback_available != null ? (body.rollback_available ? 1 : 0) : existing.rollback_available,
        body.customer_approval_reference !== undefined ? (body.customer_approval_reference || null) : existing.customer_approval_reference,
        body.verified_by !== undefined ? (body.verified_by || null) : existing.verified_by,
        body.verification_notes !== undefined ? (body.verification_notes || null) : existing.verification_notes,
        req.user.id, completedAt, id, body.version
      );

    if (!result.changes) return false;
    if (Array.isArray(body.technology_ids)) {
      await tx.prepare('DELETE FROM service_activity_technologies WHERE service_activity_id = ?').run(id);
      const insTech = tx.prepare('INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (?, ?)');
      for (const techId of body.technology_ids) await insTech.run(id, techId);
    }
    if (Array.isArray(body.asset_ids)) {
      // Keep a recorded version for assets that stay selected unless a new one is sent.
      const previous=new Map((await tx.prepare('SELECT asset_id,version FROM service_activity_assets WHERE service_activity_id=?').all(id)).map(row => [row.asset_id,row.version]));
      await tx.prepare('DELETE FROM service_activity_assets WHERE service_activity_id=?').run(id);
      const insAsset=tx.prepare('INSERT INTO service_activity_assets (service_activity_id,asset_id,customer_id,version) VALUES (?,?,?,?)');
      for (const assetId of body.asset_ids) {
        const sent=body.asset_versions && Object.prototype.hasOwnProperty.call(body.asset_versions,String(assetId));
        await insAsset.run(id,assetId,Number(customerId),sent ? assetVersion(body.asset_versions,assetId) : previous.get(assetId) ?? null);
      }
      if (newStatus === completedValue) await syncAssetVersions(tx, { activityId:id, customerId:Number(customerId), activityDate:body.activity_date || existing.activity_date, userId:req.user.id });
    }
    return true;
  });
  if (!updated) return res.status(409).json({ error: 'Activity changed. Your draft is preserved; reload the latest activity before saving.', code: 'ACTIVITY_CONFLICT' });

  if (newStatus === completedValue && existing.status !== completedValue) {
    const effectiveTicketReference = body.ticket_reference !== undefined ? body.ticket_reference : existing.ticket_reference;
    await writeBackTicketOnCompletion(req, { id, title: body.title?.trim() || existing.title, customerId, ticketReference: effectiveTicketReference });
  }

  if (body.status && body.status !== existing.status) {
    await logAudit(db, req, 'service_activity', id, body.title?.trim() || existing.title, 'activity_status_changed', `status ${existing.status}->${body.status}`);
  }
  if (body.customer_id && body.customer_id !== existing.customer_id) {
    await logAudit(db, req, 'service_activity', id, body.title?.trim() || existing.title, 'activity_customer_changed', `customer_id ${existing.customer_id}->${body.customer_id}`);
  }
  if (body.billable_classification !== undefined && body.billable_classification !== existing.billable_classification) {
    await logAudit(db, req, 'service_activity', id, body.title?.trim() || existing.title, 'activity_billable_changed', `billable_classification ${existing.billable_classification}->${body.billable_classification}`);
  }
  await logAudit(db, req, 'service_activity', id, body.title?.trim() || existing.title, 'activity_updated', null);

  res.json({ ok: true, version: body.version + 1 });
});

/* ── Complete ─────────────────────────────────────────────────────────── */
router.post('/:id/complete', requireAuth, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer, async (req, res) => {
  const activity = req.activity;
  const id = activity.id;

  const completedValue = await terminalCompletedValue();
  if (activity.status === completedValue) return res.json({ ok: true });

  const technologyIds = (await db.prepare('SELECT technology_id FROM service_activity_technologies WHERE service_activity_id = ?').all(id)).map(t => t.technology_id);
  const validation = await validateActivityPayload({ ...activity, technology_ids: technologyIds }, { customerId: activity.customer_id, isCreate: false });
  if (validation.error) return res.status(400).json({ error: validation.error });
  const categoryError = await assertCategoryUsableByTeam(activity.category_id, activity.team_id);
  if (categoryError) return res.status(400).json({ error: categoryError });

  const attachmentError = await assertAttachmentRuleSatisfied(id, activity.category_id);
  if (attachmentError) return res.status(400).json({ error: attachmentError });

  const updated = await db.prepare(`UPDATE service_activities SET status=?, completed_at=app_now(), updated_by=?, updated_at=app_now(), version=version+1 WHERE id=? AND version=?`)
    .run(completedValue, req.user.id, id, activity.version);
  if (!updated.changes) return res.status(409).json({ error: 'Activity changed; reload before completing', code: 'ACTIVITY_CONFLICT' });
  await logAudit(db, req, 'service_activity', id, activity.title, 'activity_completed', null);
  await writeBackTicketOnCompletion(req, { id, title: activity.title, customerId: activity.customer_id, ticketReference: activity.ticket_reference });
  res.json({ ok: true });
});

/* ── Duplicate ────────────────────────────────────────────────────────── */
router.post('/:id/duplicate', requireAuth, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer, async (req, res) => {
  const activity = req.activity;
  const id = activity.id;

  const statuses = await getStatusConfig();
  const defaultStatus = statuses[0]?.value || 'planned';
  const today = new Date().toISOString().slice(0, 10);
  const teamId = await resolveActivityTeam(req, activity.customer_id, activity.team_id);
  if (!teamId) return res.status(400).json({ error: 'Customer has no eligible team assigned' });

  const result = await db.transaction(async (tx) => {
    const reference = await generateActivityReference(tx);
    const insertResult = await tx.prepare(`
      INSERT INTO service_activities (
        activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, subcategory_id,
        title, status, work_location, billable_classification, created_by, updated_by
      ) VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?)
    `).run(
      reference, activity.customer_id, teamId, req.user.id, today, activity.category_id, activity.subcategory_id,
      activity.title, defaultStatus, activity.work_location, activity.billable_classification, req.user.id, req.user.id
    );
    const newId = insertResult.lastInsertRowid;
    const techs = await tx.prepare('SELECT technology_id FROM service_activity_technologies WHERE service_activity_id = ?').all(id);
    const insTech = tx.prepare('INSERT INTO service_activity_technologies (service_activity_id, technology_id) VALUES (?, ?)');
    for (const t of techs) await insTech.run(newId, t.technology_id);
    const assets=await tx.prepare('SELECT asset_id,customer_id,version FROM service_activity_assets WHERE service_activity_id=?').all(id);
    const insAsset=tx.prepare('INSERT INTO service_activity_assets (service_activity_id,asset_id,customer_id,version) VALUES (?,?,?,?)');
    for (const asset of assets) await insAsset.run(newId,asset.asset_id,asset.customer_id,asset.version ?? null);
    return { id: newId, reference };
  });

  await logAudit(db, req, 'service_activity', result.id, activity.title, 'activity_created', `duplicated_from=${id}`);
  res.json({ id: result.id, activity_reference: result.reference });
});

/* ── Create Follow-Up Task ────────────────────────────────────────────── */
router.post('/:id/follow-up-task', requireAuth, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer, async (req, res) => {
  if (!['manager', 'engineer'].includes(req.user.role)) return res.status(403).json({ error: 'Your role cannot create tasks' });
  const activity = req.activity;
  const id = activity.id;

  const settings = await getServiceActivitySettings();
  if (!settings.allow_follow_up_task_creation) return res.status(403).json({ error: 'Follow-up task creation is disabled by an administrator' });

  // Find (or leave null) a project for this customer so the task links somewhere sensible.
  const project = activity.related_project_id
    ? await db.prepare('SELECT id FROM projects WHERE id = ?').get(activity.related_project_id)
    : null;
  if (project && req.user.role !== 'manager'
    && !await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(project.id, req.user.id))
    return res.status(403).json({ error: 'You can only create follow-up tasks in projects you are assigned to' });

  const result = await db.transaction(async (tx) => {
    const current = await tx.prepare('SELECT follow_up_task_id FROM service_activities WHERE id = ? FOR UPDATE').get(id);
    if (current.follow_up_task_id) return { id: current.follow_up_task_id, created: false };
    const inserted = await tx.prepare(`
      INSERT INTO tasks (project_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      project?.id || null,
      `Follow-up: ${activity.title}`,
      `Follow-up task for service activity ${activity.activity_reference}.\n\n${activity.description || ''}`.trim(),
      'medium', activity.follow_up_date || null, activity.engineer_id, req.user.id
    );
    const taskId = inserted.lastInsertRowid;
    await tx.prepare('UPDATE service_activities SET follow_up_task_id = ?, version=version+1, updated_by = ?, updated_at=app_now() WHERE id = ?')
      .run(taskId, req.user.id, id);
    return { id: taskId, created: true };
  });
  if (result.created) await logAudit(db, req, 'service_activity', id, activity.title, 'follow_up_task_created', `task_id=${result.id}`);
  res.json(result);
});

/* ── Export to Excel ──────────────────────────────────────────────────── */
router.get('/export', requireDownloadAuth, requireServiceActivityAccess, async (req, res) => {
  let filters;
  try { filters = activityFilters(req.query, req.user); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const { where, params } = filters;
  const rows = await db.prepare(`
    SELECT sa.activity_reference, sa.activity_date, c.name AS customer, cat.name AS category,
      sa.title, sa.duration_minutes, sa.status, sa.billable_classification, sa.ticket_reference, u.name AS engineer
    FROM service_activities sa
    JOIN customers c ON c.id = sa.customer_id
    JOIN activity_categories cat ON cat.id = sa.category_id
    JOIN users u ON u.id = sa.engineer_id
    ${where} ORDER BY sa.activity_date DESC, sa.id DESC
  `).all(...params);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Service Activities');
  worksheet.addRow(['Reference', 'Date', 'Customer', 'Category', 'Title', 'Duration (min)', 'Status', 'Billable', 'Ticket', 'Engineer']);
  rows.forEach(r => worksheet.addRow([r.activity_reference, r.activity_date, decryptField(r.customer), r.category, r.title, r.duration_minutes, r.status, r.billable_classification, r.ticket_reference, r.engineer]));
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="service_activities.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const activity = await db.prepare('SELECT * FROM service_activities WHERE id = ?').get(id);
  if (activity) await logAudit(db, req, 'service_activity', id, activity.title, 'activity_deleted', null);
  await db.prepare('DELETE FROM service_activities WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ── Attachments (reuses the same upload/magic-byte/encryption logic as project attachments) ── */
router.get('/:id/attachments', requireAuth, requireServiceActivityAccess, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const activity = await db.prepare('SELECT engineer_id FROM service_activities WHERE id = ?').get(id);
  if (!activity) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && activity.engineer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const rows = await db.prepare('SELECT a.id,a.original_name,a.mime_type,a.size,a.uploaded_by,a.created_at,u.name AS uploaded_by_name FROM attachments a JOIN users u ON a.uploaded_by = u.id WHERE a.service_activity_id = ? ORDER BY a.created_at DESC,a.id DESC').all(id);
  res.json(rows);
});

router.post('/:id/attachments', requireAuth, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer, async (req, res) => {
  const activity = req.activity;
  const id = activity.id;

  const settings = await getServiceActivitySettings();
  if (!settings.allow_attachments) return res.status(403).json({ error: 'Attachments are disabled by an administrator' });

  try {
    await new Promise((resolve, reject) => upload.single('file')(req, res, error => error ? reject(error) : resolve()));
  } catch (error) { return res.status(400).json({ error: error.message }); }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    if (!hasAllowedMagic(req.file.path, req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Uploaded file content does not match the declared file type' });
    }
    let encIv = null, encTag = null;
    if (cipher.isConfigured()) {
      const raw = await fs.promises.readFile(req.file.path);
      const { data, iv, tag } = cipher.encrypt(raw);
      await fs.promises.writeFile(req.file.path, data);
      encIv = iv; encTag = tag;
    }
    const result = await db.prepare(
      'INSERT INTO attachments (service_activity_id, original_name, stored_name, mime_type, size, uploaded_by, enc_iv, enc_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, safeDownloadName(req.file.originalname), req.file.filename, req.file.mimetype, req.file.size, req.user.id, encIv, encTag);
    await logAudit(db, req, 'attachment', result.lastInsertRowid, safeDownloadName(req.file.originalname), 'attachment_uploaded', `service_activity_id=${id}`);
    res.json({ id: result.lastInsertRowid, original_name: safeDownloadName(req.file.originalname), encrypted: !!encIv });
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(cleanupError => {
      if (cleanupError.code !== 'ENOENT') console.error('[service-activities] upload cleanup failed:', cleanupError);
    });
    throw error;
  }
});

router.get('/:id/attachments/:attId/download', requireDownloadAuth, requireServiceActivityAccess, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!positiveRouteId(req.params.attId)) return res.status(400).json({ error: 'Invalid attachment ID' });
  const att = await db.prepare('SELECT * FROM attachments WHERE id = ? AND service_activity_id = ?').get(Number(req.params.attId), id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  const activity = await db.prepare('SELECT engineer_id FROM service_activities WHERE id = ?').get(id);
  if (req.user.role !== 'manager' && activity.engineer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const safeName = safeStoredName(att.stored_name);
  if (!safeName) return res.status(400).json({ error: 'Invalid file reference' });
  const filePath = path.join(uploadDir, safeName);
  const downloadName = safeDownloadName(att.original_name);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (att.enc_iv && att.enc_tag) {
    try {
      const raw = await fs.promises.readFile(filePath);
      const plaintext = cipher.decrypt(raw, att.enc_iv, att.enc_tag);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', plaintext.length);
      return res.send(plaintext);
    } catch (e) {
      console.error('[service-activities] decrypt error:', e.message);
      return res.status(500).json({ error: 'Failed to decrypt file' });
    }
  }
  res.download(filePath, downloadName);
});

router.delete('/:id/attachments/:attId', requireAuth, requireServiceActivityAccess, requireOwnedActivity, requireAuthorizedActivityCustomer, async (req, res) => {
  const id = req.activity.id;
  if (!positiveRouteId(req.params.attId)) return res.status(400).json({ error: 'Invalid attachment ID' });
  const att = await db.prepare('SELECT * FROM attachments WHERE id = ? AND service_activity_id = ?').get(Number(req.params.attId), id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && att.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const safeName = safeStoredName(att.stored_name);
  await db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id);
  if (safeName) await fs.promises.unlink(path.join(uploadDir, safeName)).catch(error => {
    if (error.code !== 'ENOENT') console.error('[service-activities] attachment cleanup failed:', error);
  });
  await logAudit(db, req, 'attachment', att.id, att.original_name, 'attachment_deleted', `service_activity_id=${id}`);
  res.json({ ok: true });
});

router.use((error,req,res,next) => {
  if (error.code==='23503') return res.status(409).json({ error:'A selected customer asset or related record changed. Reload the activity before saving.' });
  next(error);
});

module.exports = router;
