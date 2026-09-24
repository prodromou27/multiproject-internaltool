const db=require('./db');

const positiveId=value => (typeof value==='number' || typeof value==='string') && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

async function canAccessCustomer(user,customerId,store=db) {
  if (!positiveId(customerId) || !user) return false;
  if (['manager','planner'].includes(user.role)) return true;
  if (user.role!=='engineer') return false;
  return !!await store.prepare(`SELECT 1 FROM (
    SELECT p.customer_id FROM projects p JOIN project_assignments pa ON pa.project_id=p.id WHERE pa.user_id=? AND p.customer_id=?
    UNION SELECT mv.customer_id FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id=mv.id WHERE mve.user_id=? AND mv.customer_id=?
    UNION SELECT ce.customer_id FROM customer_engineers ce WHERE ce.user_id=? AND ce.customer_id=?
    UNION SELECT ct.customer_id FROM customer_teams ct JOIN team_members tm ON tm.team_id=ct.team_id WHERE tm.user_id=? AND ct.customer_id=?
  ) allowed LIMIT 1`).get(user.id,customerId,user.id,customerId,user.id,customerId,user.id,customerId);
}

/* Engineers on a managed-services team (the teams.managed_service_operations
   capability) work the estates of the customers their team is assigned to, so
   they may see those customers' assets and add new ones — nothing more:
   editing, deleting, importing and files stay with assets.access. Checked live
   against team membership, the team's capability and the customer assignment,
   so it follows those as they change. */
async function isManagedServicesEngineer(user,customerId,store=db) {
  if (!positiveId(customerId) || user?.role!=='engineer') return false;
  return !!await store.prepare(`SELECT 1 FROM team_members tm
    JOIN teams t ON t.id=tm.team_id AND t.managed_service_operations=1
    JOIN customer_teams ct ON ct.team_id=t.id
    WHERE tm.user_id=? AND ct.customer_id=?`).get(user.id,customerId);
}

module.exports={ positiveId,canAccessCustomer,isManagedServicesEngineer };
