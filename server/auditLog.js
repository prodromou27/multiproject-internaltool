/**
 * Shared audit-logging helper.
 * Call this from any route after a mutating action.
 * Non-fatal — errors are swallowed so they never break the main response.
 */
async function logAudit(db, req, entityType, entityId, entityTitle, action, detail) {
  // entity_id is a number. Some callers name a thing instead ('database_backup',
  // 'sla_policy'): that goes into the detail, so the row is still written (an
  // INSERT with text there used to fail and be swallowed, losing the entry).
  const numeric = entityId != null && entityId !== '' && Number.isSafeInteger(Number(entityId));
  if (entityId != null && entityId !== '' && !numeric) detail = `${entityId}${detail ? `: ${detail}` : ''}`;
  entityId = numeric ? Number(entityId) : null;
  try {
    await db.prepare(`
      INSERT INTO audit_log
        (user_id, user_name, user_role, entity_type, entity_id, entity_title, action, detail, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id    ?? null,
      req.user?.name  ?? 'Unknown',
      req.user?.role  ?? null,
      entityType,
      entityId        ?? null,
      entityTitle     ?? null,
      action,
      detail          ?? null,
      req.ip          ?? null,
    );
  } catch (error) { console.error('[audit] could not record', action, error.message); /* non-fatal */ }
}

module.exports = { logAudit };
