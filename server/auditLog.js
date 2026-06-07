/**
 * Shared audit-logging helper.
 * Call this from any route after a mutating action.
 * Non-fatal — errors are swallowed so they never break the main response.
 */
function logAudit(db, req, entityType, entityId, entityTitle, action, detail) {
  try {
    db.prepare(`
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
  } catch (_) { /* non-fatal */ }
}

module.exports = { logAudit };
