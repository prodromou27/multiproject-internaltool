const db=require('./db');
const { decryptCustomer,decrypt }=require('./fieldCipher');

const numbers=row => Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,Number(value || 0)]));

async function listManagedCustomers(store=db) {
  const rows=await store.prepare(`SELECT c.id,c.name,mc.reporting_frequency,mc.responsible_team_id,t.name AS responsible_team,
    mc.service_manager_id,u.name AS service_manager,tc.last_successful_sync_at,tc.last_sync_status
    FROM managed_customer_configurations mc JOIN customers c ON c.id=mc.customer_id
    LEFT JOIN teams t ON t.id=mc.responsible_team_id LEFT JOIN users u ON u.id=mc.service_manager_id
    LEFT JOIN customer_ticketing_configurations tc ON tc.customer_id=c.id AND tc.provider_type='request_tracker'
    WHERE mc.managed_services_enabled=1 AND c.active=1 ORDER BY c.name`).all();
  const [tickets,activities,tasks,projects,visits]=await Promise.all([
    store.prepare("SELECT customer_id,COUNT(*) FILTER (WHERE status_group='open') AS open_tickets,COUNT(*) FILTER (WHERE normalized_status='Pending') AS pending_tickets FROM external_tickets GROUP BY customer_id").all(),
    store.prepare("SELECT customer_id,COUNT(*) AS activities_this_month FROM service_activities WHERE activity_date>=substr(app_today(),1,7)||'-01' GROUP BY customer_id").all(),
    store.prepare("SELECT p.customer_id,COUNT(*) AS open_tasks FROM tasks tk JOIN projects p ON p.id=tk.project_id WHERE tk.status!='completed' AND tk.status!='closed' AND tk.status!='cancelled' GROUP BY p.customer_id").all(),
    store.prepare("SELECT customer_id,COUNT(*) AS active_projects FROM projects WHERE status!='closed' AND status!='cancelled' GROUP BY customer_id").all(),
    store.prepare("SELECT customer_id,MAX(scheduled_date) AS last_maintenance_visit FROM maintenance_visits WHERE status='completed' GROUP BY customer_id").all(),
  ]);
  const map=values => new Map(values.map(value => [Number(value.customer_id),value]));
  const ticketMap=map(tickets),activityMap=map(activities),taskMap=map(tasks),projectMap=map(projects),visitMap=map(visits);
  return rows.map(row => ({ ...row,name:decrypt(row.name),open_tickets:Number(ticketMap.get(row.id)?.open_tickets || 0),pending_tickets:Number(ticketMap.get(row.id)?.pending_tickets || 0),activities_this_month:Number(activityMap.get(row.id)?.activities_this_month || 0),open_tasks:Number(taskMap.get(row.id)?.open_tasks || 0),active_projects:Number(projectMap.get(row.id)?.active_projects || 0),last_maintenance_visit:visitMap.get(row.id)?.last_maintenance_visit || null })).sort((a,b) => a.name.localeCompare(b.name));
}

async function getOverview(customerId,from,to,store=db) {
  const row=await store.prepare(`SELECT c.*,mc.*,t.name AS responsible_team,u.name AS service_manager,tc.last_successful_sync_at,tc.last_sync_status
    FROM managed_customer_configurations mc JOIN customers c ON c.id=mc.customer_id
    LEFT JOIN teams t ON t.id=mc.responsible_team_id LEFT JOIN users u ON u.id=mc.service_manager_id
    LEFT JOIN customer_ticketing_configurations tc ON tc.customer_id=c.id AND tc.provider_type='request_tracker'
    WHERE c.id=? AND mc.managed_services_enabled=1`).get(customerId);
  if (!row) return null;
  const [tickets,activities,tasks,projects,visits,recommendations]=await Promise.all([
    store.prepare(`SELECT COUNT(*) FILTER (WHERE status_group='open') AS open_now,
      COUNT(*) FILTER (WHERE normalized_status='Pending') AS pending_now,
      COUNT(*) FILTER (WHERE status_group='open' AND normalized_priority IN ('High','Critical')) AS high_priority_open,
      COUNT(*) FILTER (WHERE created_at_external>=? AND created_at_external<?) AS created_period,
      COUNT(*) FILTER (WHERE resolved_at_external>=? AND resolved_at_external<?) AS resolved_period,
      COUNT(*) FILTER (WHERE sla_breached=1 AND status_group='open') AS sla_breached_open
      FROM external_tickets WHERE customer_id=?`).get(`${from}T00:00:00.000Z`,`${to}T23:59:59.999Z`,`${from}T00:00:00.000Z`,`${to}T23:59:59.999Z`,customerId),
    store.prepare('SELECT COUNT(*) AS activities,SUM(COALESCE(duration_minutes,0)) AS minutes FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ?').get(customerId,from,to),
    store.prepare(`SELECT COUNT(*) FILTER (WHERE tk.status NOT IN ('completed','closed','cancelled')) AS open_now,
      COUNT(*) FILTER (WHERE tk.status NOT IN ('completed','closed','cancelled') AND tk.deadline<app_today()) AS overdue_now
      FROM tasks tk JOIN projects p ON p.id=tk.project_id WHERE p.customer_id=?`).get(customerId),
    store.prepare("SELECT COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled')) AS active_now FROM projects WHERE customer_id=?").get(customerId),
    store.prepare("SELECT COUNT(*) FILTER (WHERE scheduled_date BETWEEN ? AND ? AND status!='cancelled') AS visits_period,MAX(scheduled_date) FILTER (WHERE status='completed') AS last_visit FROM maintenance_visits WHERE customer_id=?").get(from,to,customerId),
    store.prepare("SELECT COUNT(*) FILTER (WHERE status NOT IN ('implemented','converted_to_project','closed','rejected')) AS open_now FROM customer_recommendations WHERE customer_id=?").get(customerId),
  ]);
  const customer=decryptCustomer(row);customer.responsible_team=row.responsible_team;customer.service_manager=row.service_manager;
  return { customer,period:{ from,to },tickets:numbers(tickets),activities:{ ...numbers(activities),hours:Math.round(Number(activities.minutes || 0)/6)/10 },tasks:numbers(tasks),projects:numbers(projects),visits:{ ...numbers(visits),last_visit:visits.last_visit || null },recommendations:numbers(recommendations) };
}

module.exports={ listManagedCustomers,getOverview };
