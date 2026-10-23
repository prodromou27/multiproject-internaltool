const fail = message => { throw Object.assign(new Error(message),{ status: 400 }); };
const ACCESS_SQL = `(r.owner_id=? OR r.visibility='management' OR (r.visibility='shared' AND (r.id IN (SELECT report_id FROM saved_custom_report_users WHERE user_id=?) OR r.id IN (SELECT srt.report_id FROM saved_custom_report_teams srt JOIN team_members tm ON tm.team_id=srt.team_id WHERE tm.user_id=?))))`;

function parseIds(value,label) {
  if (!Array.isArray(value) || value.length>100 || value.some(id => !Number.isSafeInteger(id) || id<1) || new Set(value).size!==value.length) fail(`${label} must contain at most 100 distinct IDs`);
  return value;
}

async function validateShares(store,visibility,userIds = [],teamIds = []) {
  userIds=parseIds(userIds,'Shared users');
  teamIds=parseIds(teamIds,'Shared teams');
  if (visibility!=='shared' && (userIds.length || teamIds.length)) fail('Specific shares require shared visibility');
  if (visibility==='shared' && !userIds.length && !teamIds.length) fail('Select at least one manager or team for a shared report');
  if (userIds.length) {
    const rows=await store.prepare(`SELECT id FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) AND role='manager' AND active=1 AND must_change_password=0`).all(...userIds);
    if (rows.length!==userIds.length) fail('Shared users must be active managers with current access');
  }
  if (teamIds.length) {
    const rows=await store.prepare(`SELECT id FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`).all(...teamIds);
    if (rows.length!==teamIds.length) fail('One or more shared teams no longer exist');
  }
  return { userIds,teamIds };
}

async function replaceShares(store,reportId,{ userIds,teamIds }) {
  await store.prepare('DELETE FROM saved_custom_report_users WHERE report_id=?').run(reportId);
  await store.prepare('DELETE FROM saved_custom_report_teams WHERE report_id=?').run(reportId);
  for (const userId of userIds) await store.prepare('INSERT INTO saved_custom_report_users (report_id,user_id) VALUES (?,?)').run(reportId,userId);
  for (const teamId of teamIds) await store.prepare('INSERT INTO saved_custom_report_teams (report_id,team_id) VALUES (?,?)').run(reportId,teamId);
}

async function reportShares(store,reportId) {
  const [users,teams]=await Promise.all([
    store.prepare('SELECT user_id FROM saved_custom_report_users WHERE report_id=? ORDER BY user_id').all(reportId),
    store.prepare('SELECT team_id FROM saved_custom_report_teams WHERE report_id=? ORDER BY team_id').all(reportId),
  ]);
  return { shared_user_ids: users.map(row => row.user_id),shared_team_ids: teams.map(row => row.team_id) };
}

async function canAccessReport(store,report,userId) {
  if (report.owner_id===userId || report.visibility==='management') return true;
  if (report.visibility!=='shared') return false;
  return !!await store.prepare('SELECT 1 AS allowed WHERE EXISTS (SELECT 1 FROM saved_custom_report_users WHERE report_id=? AND user_id=?) OR EXISTS (SELECT 1 FROM saved_custom_report_teams srt JOIN team_members tm ON tm.team_id=srt.team_id WHERE srt.report_id=? AND tm.user_id=?)').get(report.id,userId,report.id,userId);
}

module.exports = { ACCESS_SQL,validateShares,replaceShares,reportShares,canAccessReport };
