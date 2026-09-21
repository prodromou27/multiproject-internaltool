const db=require('./db');
const { decryptCustomer,decrypt }=require('./fieldCipher');

const numbers=row => Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,Number(value || 0)]));

async function listManagedCustomers(store=db) {
  const rows=await store.prepare(`SELECT c.id,c.name,mc.reporting_frequency,mc.responsible_team_id,t.name AS responsible_team,
    mc.service_manager_id,u.name AS service_manager,tc.enabled AS ticketing_enabled,tc.last_successful_sync_at,tc.last_sync_status
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
  return rows.map(row => ({ ...row,name:decrypt(row.name),ticketing_enabled:!!row.ticketing_enabled,service_status:row.last_sync_status==='failed'?'attention':row.ticketing_enabled && !row.last_successful_sync_at?'awaiting_sync':row.ticketing_enabled?'healthy':'activity_only',open_tickets:Number(ticketMap.get(row.id)?.open_tickets || 0),pending_tickets:Number(ticketMap.get(row.id)?.pending_tickets || 0),activities_this_month:Number(activityMap.get(row.id)?.activities_this_month || 0),open_tasks:Number(taskMap.get(row.id)?.open_tasks || 0),active_projects:Number(projectMap.get(row.id)?.active_projects || 0),last_maintenance_visit:visitMap.get(row.id)?.last_maintenance_visit || null })).sort((a,b) => a.name.localeCompare(b.name));
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

async function listTickets(customerId,filters,store=db) {
  const managed=await store.prepare(`SELECT 1 FROM managed_customer_configurations mc
    JOIN customers c ON c.id=mc.customer_id WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!managed) return null;
  let where='WHERE customer_id=?';const params=[customerId];
  if (filters.status) { where+=' AND normalized_status=?';params.push(filters.status); }
  if (filters.group) { where+=' AND status_group=?';params.push(filters.group); }
  if (filters.priority) { where+=' AND normalized_priority=?';params.push(filters.priority); }
  if (filters.owner) { where+=' AND owner_name=?';params.push(filters.owner); }
  if (filters.from) { where+=' AND created_at_external>=?';params.push(`${filters.from}T00:00:00.000Z`); }
  if (filters.to) {
    const exclusive=new Date(`${filters.to}T00:00:00.000Z`);exclusive.setUTCDate(exclusive.getUTCDate()+1);
    where+=' AND created_at_external<?';params.push(exclusive.toISOString());
  }
  if (filters.search) {
    const literal=filters.search.replace(/[\\%_]/g,'\\$&').toLowerCase();
    where+=' AND (subject ILIKE ? OR ticket_number ILIKE ?)';
    params.push(`%${literal}%`,`%${literal}%`);
  }
  const [rows,count,statuses,priorities,owners]=await Promise.all([
    store.prepare(`SELECT id,ticket_number,subject,normalized_status,status_group,normalized_priority,owner_name,category,subcategory,
      created_at_external,updated_at_external,resolved_at_external,closed_at_external,sla_due_at,sla_breached,external_url,last_synced_at
      FROM external_tickets ${where} ORDER BY created_at_external DESC,id DESC LIMIT ? OFFSET ?`).all(...params,filters.pageSize,filters.offset),
    store.prepare(`SELECT COUNT(*) AS total FROM external_tickets ${where}`).get(...params),
    store.prepare('SELECT DISTINCT normalized_status AS value FROM external_tickets WHERE customer_id=? AND normalized_status IS NOT NULL ORDER BY normalized_status').all(customerId),
    store.prepare('SELECT DISTINCT normalized_priority AS value FROM external_tickets WHERE customer_id=? AND normalized_priority IS NOT NULL ORDER BY normalized_priority').all(customerId),
    store.prepare("SELECT DISTINCT owner_name AS value FROM external_tickets WHERE customer_id=? AND owner_name IS NOT NULL AND owner_name!='' ORDER BY owner_name").all(customerId),
  ]);
  return { rows,total:Number(count.total),page:filters.page,page_size:filters.pageSize,facets:{ statuses:statuses.map(row => row.value),priorities:priorities.map(row => row.value),owners:owners.map(row => row.value) } };
}

async function getTicketAnalytics(customerId,from,to,store=db,now=new Date()) {
  const managed=await store.prepare(`SELECT 1 FROM managed_customer_configurations mc
    JOIN customers c ON c.id=mc.customer_id WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!managed) return null;
  const start=`${from}T00:00:00.000Z`,endDate=new Date(`${to}T00:00:00.000Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const end=endDate.toISOString();
  const [periodRows,statuses,priorities,owners,agingRows]=await Promise.all([
    store.prepare(`SELECT normalized_status,created_at_external,resolved_at_external,closed_at_external,updated_at_external,sla_breached
      FROM external_tickets WHERE customer_id=? AND (created_at_external BETWEEN ? AND ? OR resolved_at_external BETWEEN ? AND ?
      OR closed_at_external BETWEEN ? AND ? OR (normalized_status IN ('Closed','Rejected') AND updated_at_external BETWEEN ? AND ?))`).all(customerId,start,end,start,end,start,end,start,end),
    store.prepare("SELECT normalized_status AS name,COUNT(*) AS count FROM external_tickets WHERE customer_id=? AND status_group='open' GROUP BY normalized_status ORDER BY count DESC,normalized_status").all(customerId),
    store.prepare("SELECT COALESCE(normalized_priority,'Unspecified') AS name,COUNT(*) AS count FROM external_tickets WHERE customer_id=? AND status_group='open' GROUP BY normalized_priority ORDER BY count DESC,name").all(customerId),
    store.prepare("SELECT owner_name AS name,COUNT(*) AS count FROM external_tickets WHERE customer_id=? AND status_group='open' GROUP BY owner_name ORDER BY count DESC,owner_name").all(customerId),
    store.prepare("SELECT created_at_external FROM external_tickets WHERE customer_id=? AND status_group='open' AND created_at_external IS NOT NULL").all(customerId),
  ]);
  const inPeriod=value => !!value && value>=start && value<end;
  const period={ created:0,resolved:0,closed:0,rejected:0,sla_breaches:0 };
  for (const ticket of periodRows) {
    if (inPeriod(ticket.created_at_external)) { period.created++;if (ticket.sla_breached) period.sla_breaches++; }
    if (inPeriod(ticket.resolved_at_external)) period.resolved++;
    const terminal=ticket.closed_at_external || ticket.resolved_at_external || ticket.updated_at_external;
    if (ticket.normalized_status==='Closed' && inPeriod(terminal)) period.closed++;
    if (ticket.normalized_status==='Rejected' && inPeriod(ticket.resolved_at_external || ticket.updated_at_external)) period.rejected++;
  }
  const aging=[{ name:'0–2 days',count:0 },{ name:'3–7 days',count:0 },{ name:'8–14 days',count:0 },{ name:'15–30 days',count:0 },{ name:'30+ days',count:0 }];
  for (const ticket of agingRows) {
    const days=Math.max(0,Math.floor((now-new Date(ticket.created_at_external))/86400000));
    aging[days<=2?0:days<=7?1:days<=14?2:days<=30?3:4].count++;
  }
  const firstDay=new Date(`${from}T00:00:00.000Z`),lastDay=new Date(`${to}T00:00:00.000Z`),dayCount=Math.floor((lastDay-firstDay)/86400000)+1;
  const bucketDays=dayCount<=45?1:dayCount<=366?7:Math.max(7,Math.ceil(dayCount/52));
  const points=Array.from({ length:Math.ceil(dayCount/bucketDays) },(_,index) => {
    const date=new Date(firstDay);date.setUTCDate(date.getUTCDate()+index*bucketDays);
    return { date:date.toISOString().slice(0,10),created:0,resolved:0 };
  });
  const addTrend=(value,key) => {
    if (!inPeriod(value)) return;
    const index=Math.floor((new Date(value)-firstDay)/86400000/bucketDays);
    if (points[index]) points[index][key]++;
  };
  periodRows.forEach(ticket => { addTrend(ticket.created_at_external,'created');addTrend(ticket.resolved_at_external,'resolved'); });
  const rows=(values,fallback) => [...values.reduce((result,row) => { const name=row.name || fallback;result.set(name,(result.get(name) || 0)+Number(row.count));return result; },new Map())].map(([name,count]) => ({ name,count })).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  return { period:{ from,to,...period },trend:{ bucket_days:bucketDays,points },current:{ total_open:rows(statuses).reduce((sum,row) => sum+row.count,0),statuses:rows(statuses),priorities:rows(priorities),owners:rows(owners,'Unassigned'),aging } };
}

async function getActivities(customerId,from,to,{ page=1,pageSize=25,offset=0 }={},store=db) {
  const managed=await store.prepare(`SELECT c.service_activity_enabled AS enabled FROM managed_customer_configurations mc
    JOIN customers c ON c.id=mc.customer_id WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!managed) return null;
  const empty={ enabled:false,summary:{ activities:0,minutes:0,hours:0 },breakdowns:{ categories:[],technologies:[],engineers:[],locations:[],billing:[] },rows:[],total:0,page,page_size:pageSize };
  if (!managed.enabled) return empty;
  const range=[customerId,from,to];
  const [summary,categories,technologies,engineers,locations,billing,rows,count]=await Promise.all([
    store.prepare('SELECT COUNT(*) AS activities,COALESCE(SUM(duration_minutes),0) AS minutes FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ?').get(...range),
    store.prepare(`SELECT cat.name,COUNT(*) AS count,COALESCE(SUM(sa.duration_minutes),0) AS minutes FROM service_activities sa
      JOIN activity_categories cat ON cat.id=sa.category_id WHERE sa.customer_id=? AND sa.activity_date BETWEEN ? AND ? GROUP BY cat.name ORDER BY minutes DESC,cat.name`).all(...range),
    store.prepare(`SELECT tech.name,COUNT(*) AS count FROM service_activities sa JOIN service_activity_technologies sat ON sat.service_activity_id=sa.id
      JOIN technologies tech ON tech.id=sat.technology_id WHERE sa.customer_id=? AND sa.activity_date BETWEEN ? AND ? GROUP BY tech.name ORDER BY count DESC,tech.name`).all(...range),
    store.prepare(`SELECT u.name,COUNT(*) AS count,COALESCE(SUM(sa.duration_minutes),0) AS minutes FROM service_activities sa JOIN users u ON u.id=sa.engineer_id
      WHERE sa.customer_id=? AND sa.activity_date BETWEEN ? AND ? GROUP BY u.name ORDER BY minutes DESC,u.name`).all(...range),
    store.prepare("SELECT COALESCE(work_location,'Not set') AS name,COUNT(*) AS count FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ? GROUP BY work_location ORDER BY count DESC,name").all(...range),
    store.prepare("SELECT COALESCE(billable_classification,'Not set') AS name,COUNT(*) AS count,COALESCE(SUM(duration_minutes),0) AS minutes FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ? GROUP BY billable_classification ORDER BY minutes DESC,name").all(...range),
    store.prepare(`SELECT sa.id,sa.activity_reference,sa.activity_date,sa.title,sa.status,sa.duration_minutes,sa.work_location,sa.billable_classification,
      sa.ticket_reference,cat.name AS category_name,u.name AS engineer_name FROM service_activities sa JOIN activity_categories cat ON cat.id=sa.category_id
      JOIN users u ON u.id=sa.engineer_id WHERE sa.customer_id=? AND sa.activity_date BETWEEN ? AND ? ORDER BY sa.activity_date DESC,sa.id DESC LIMIT ? OFFSET ?`).all(...range,pageSize,offset),
    store.prepare('SELECT COUNT(*) AS total FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ?').get(...range),
  ]);
  const mapped=values => values.map(row => ({ ...row,count:Number(row.count),minutes:row.minutes===undefined?undefined:Number(row.minutes),hours:row.minutes===undefined?undefined:Math.round(Number(row.minutes)/6)/10 }));
  return { enabled:true,summary:{ activities:Number(summary.activities),minutes:Number(summary.minutes),hours:Math.round(Number(summary.minutes)/6)/10 },breakdowns:{ categories:mapped(categories),technologies:mapped(technologies),engineers:mapped(engineers),locations:mapped(locations),billing:mapped(billing) },rows,total:Number(count.total),page,page_size:pageSize };
}

async function getWork(customerId,from,to,store=db) {
  const config=await store.prepare(`SELECT mc.task_reporting_enabled,mc.project_reporting_enabled FROM managed_customer_configurations mc
    JOIN customers c ON c.id=mc.customer_id WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!config) return null;
  const start=`${from}T00:00:00.000Z`,endDate=new Date(`${to}T00:00:00.000Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const end=endDate.toISOString();
  const taskTerminal="('completed','closed','cancelled')",projectTerminal="('completed','closed','cancelled')";
  const tasks={ enabled:!!config.task_reporting_enabled,summary:{},rows:[] },projects={ enabled:!!config.project_reporting_enabled,summary:{},rows:[] };
  if (tasks.enabled) {
    const [summary,rows]=await Promise.all([
      store.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN tk.status NOT IN ${taskTerminal} THEN 1 ELSE 0 END) AS open_now,
        SUM(CASE WHEN tk.status='in_progress' THEN 1 ELSE 0 END) AS in_progress_now,
        SUM(CASE WHEN tk.status NOT IN ${taskTerminal} AND tk.deadline<app_today() THEN 1 ELSE 0 END) AS overdue_now,
        SUM(CASE WHEN tk.created_at>=? AND tk.created_at<? THEN 1 ELSE 0 END) AS created_period,
        SUM(CASE WHEN tk.status IN ${taskTerminal} AND tk.updated_at>=? AND tk.updated_at<? THEN 1 ELSE 0 END) AS completed_period
        FROM tasks tk JOIN projects p ON p.id=tk.project_id WHERE p.customer_id=?`).get(start,end,start,end,customerId),
      store.prepare(`SELECT tk.id,tk.title,tk.status,tk.priority,tk.deadline,tk.created_at,tk.updated_at,tk.is_adhoc,
        u.name AS assigned_to_name,p.id AS project_id,p.title AS project_title FROM tasks tk JOIN projects p ON p.id=tk.project_id
        LEFT JOIN users u ON u.id=tk.assigned_to WHERE p.customer_id=? AND (tk.status NOT IN ${taskTerminal} OR (tk.created_at>=? AND tk.created_at<?) OR (tk.updated_at>=? AND tk.updated_at<?))
        ORDER BY CASE WHEN tk.status NOT IN ${taskTerminal} THEN 0 ELSE 1 END,tk.deadline ASC NULLS LAST,tk.id DESC LIMIT 100`).all(customerId,start,end,start,end),
    ]);
    tasks.summary=numbers(summary);tasks.rows=rows;
  }
  if (projects.enabled) {
    const upcomingDate=new Date();upcomingDate.setUTCDate(upcomingDate.getUTCDate()+30);const upcoming=upcomingDate.toISOString().slice(0,10);
    const [summary,rows]=await Promise.all([
      store.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status NOT IN ${projectTerminal} THEN 1 ELSE 0 END) AS active_now,
        SUM(CASE WHEN (status='delayed' OR (status NOT IN ${projectTerminal} AND deadline<app_today())) THEN 1 ELSE 0 END) AS delayed_now,
        SUM(CASE WHEN created_at>=? AND created_at<? THEN 1 ELSE 0 END) AS created_period,
        SUM(CASE WHEN status IN ${projectTerminal} AND closed_at>=? AND closed_at<? THEN 1 ELSE 0 END) AS completed_period,
        SUM(CASE WHEN status NOT IN ${projectTerminal} AND deadline BETWEEN app_today() AND ? THEN 1 ELSE 0 END) AS upcoming_deadlines
        FROM projects WHERE customer_id=?`).get(start,end,start,end,upcoming,customerId),
      store.prepare(`SELECT p.id,p.title,p.status,p.priority,p.deadline,p.created_at,p.closed_at,p.completion_pct,
        COUNT(tk.id) AS task_count,SUM(CASE WHEN tk.status IN ${taskTerminal} THEN 1 ELSE 0 END) AS done_count
        FROM projects p LEFT JOIN tasks tk ON tk.project_id=p.id WHERE p.customer_id=?
        GROUP BY p.id,p.title,p.status,p.priority,p.deadline,p.created_at,p.closed_at,p.completion_pct
        ORDER BY CASE WHEN p.status NOT IN ${projectTerminal} THEN 0 ELSE 1 END,p.deadline ASC NULLS LAST,p.id DESC LIMIT 100`).all(customerId),
    ]);
    projects.summary=numbers(summary);projects.rows=rows.map(row => ({ ...row,task_count:Number(row.task_count),done_count:Number(row.done_count || 0),completion_pct:row.completion_pct==null ? (Number(row.task_count)?Math.round(Number(row.done_count || 0)/Number(row.task_count)*100):0) : Number(row.completion_pct) }));
  }
  return { period:{ from,to },tasks,projects };
}

async function getServiceReview(customerId,from,to,store=db) {
  const config=await store.prepare(`SELECT mc.maintenance_visit_reporting_enabled,mc.recommendation_tracking_enabled FROM managed_customer_configurations mc
    JOIN customers c ON c.id=mc.customer_id WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!config) return null;
  const start=`${from}T00:00:00.000Z`,endDate=new Date(`${to}T00:00:00.000Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const end=endDate.toISOString();
  const visits={ enabled:!!config.maintenance_visit_reporting_enabled,summary:{},rows:[] },recommendations={ enabled:!!config.recommendation_tracking_enabled,summary:{},statuses:[],rows:[] };
  if (visits.enabled) {
    const [summary,last,next,rows]=await Promise.all([
      store.prepare(`SELECT
        SUM(CASE WHEN scheduled_date BETWEEN ? AND ? AND status!='cancelled' THEN 1 ELSE 0 END) AS visits_period,
        SUM(CASE WHEN report_sent_at>=? AND report_sent_at<? THEN 1 ELSE 0 END) AS reports_prepared_period,
        SUM(CASE WHEN report_sent_to_customer_at>=? AND report_sent_to_customer_at<? THEN 1 ELSE 0 END) AS reports_sent_period,
        SUM(CASE WHEN status='completed' AND report_sent_to_customer=0 THEN 1 ELSE 0 END) AS reports_pending,
        SUM(CASE WHEN status NOT IN ('completed','cancelled') AND scheduled_date<app_today() THEN 1 ELSE 0 END) AS overdue_visits
        FROM maintenance_visits WHERE customer_id=?`).get(from,to,start,end,start,end,customerId),
      store.prepare("SELECT scheduled_date FROM maintenance_visits WHERE customer_id=? AND status='completed' AND scheduled_date<=app_today() ORDER BY scheduled_date DESC,id DESC LIMIT 1").get(customerId),
      store.prepare("SELECT scheduled_date FROM maintenance_visits WHERE customer_id=? AND status NOT IN ('completed','cancelled') AND scheduled_date>=app_today() ORDER BY scheduled_date,id LIMIT 1").get(customerId),
      store.prepare(`SELECT mv.id,mv.title,mv.scheduled_date,mv.status,mv.report_sent,mv.report_sent_at,mv.report_sent_to_customer,mv.report_sent_to_customer_at,
        u.name AS engineer_name,COUNT(r.id) AS recommendation_count FROM maintenance_visits mv LEFT JOIN users u ON u.id=mv.engineer_id
        LEFT JOIN customer_recommendations r ON r.source_visit_id=mv.id WHERE mv.customer_id=? AND mv.status!='cancelled' AND mv.scheduled_date BETWEEN ? AND ?
        GROUP BY mv.id,mv.title,mv.scheduled_date,mv.status,mv.report_sent,mv.report_sent_at,mv.report_sent_to_customer,mv.report_sent_to_customer_at,u.name
        ORDER BY mv.scheduled_date DESC,mv.id DESC LIMIT 100`).all(customerId,from,to),
    ]);
    visits.summary={ ...numbers(summary),last_visit:last?.scheduled_date || null,next_visit:next?.scheduled_date || null };visits.rows=rows.map(row => ({ ...row,recommendation_count:Number(row.recommendation_count) }));
  }
  if (recommendations.enabled) {
    const [summary,statuses,rows]=await Promise.all([
      store.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status NOT IN ('implemented','converted_to_project','closed','rejected') THEN 1 ELSE 0 END) AS open_now,
        SUM(CASE WHEN created_at>=? AND created_at<? THEN 1 ELSE 0 END) AS created_period,
        SUM(CASE WHEN status IN ('implemented','converted_to_project','closed') AND updated_at>=? AND updated_at<? THEN 1 ELSE 0 END) AS completed_period,
        SUM(CASE WHEN status NOT IN ('implemented','converted_to_project','closed','rejected') AND due_date<app_today() THEN 1 ELSE 0 END) AS overdue_now
        FROM customer_recommendations WHERE customer_id=?`).get(start,end,start,end,customerId),
      store.prepare('SELECT status AS name,COUNT(*) AS count FROM customer_recommendations WHERE customer_id=? GROUP BY status ORDER BY count DESC,status').all(customerId),
      store.prepare(`SELECT r.id,r.finding,r.recommendation,r.risk_level,r.status,r.due_date,r.created_at,r.updated_at,u.name AS owner_name,
        mv.title AS source_visit_title,r.related_project_id,r.related_task_id FROM customer_recommendations r LEFT JOIN users u ON u.id=r.owner_id
        LEFT JOIN maintenance_visits mv ON mv.id=r.source_visit_id WHERE r.customer_id=? ORDER BY CASE WHEN r.status NOT IN ('implemented','converted_to_project','closed','rejected') THEN 0 ELSE 1 END,r.due_date ASC NULLS LAST,r.id DESC LIMIT 100`).all(customerId),
    ]);
    recommendations.summary=numbers(summary);recommendations.statuses=statuses.map(row => ({ name:row.name,count:Number(row.count) }));recommendations.rows=rows;
  }
  return { period:{ from,to },visits,recommendations };
}

async function getTimeline(customerId,from,to,{ page=1,pageSize=25,offset=0 }={},store=db) {
  const managed=await store.prepare(`SELECT 1 FROM managed_customer_configurations mc JOIN customers c ON c.id=mc.customer_id
    WHERE mc.customer_id=? AND mc.managed_services_enabled=1 AND c.active=1`).get(customerId);
  if (!managed) return null;
  const start=`${from}T00:00:00.000Z`,endDate=new Date(`${to}T00:00:00.000Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const end=endDate.toISOString();
  const sql=`SELECT 'ticket_created' AS kind,id AS source_id,created_at_external AS occurred_at,subject AS title,ticket_number AS reference,external_url AS link
      FROM external_tickets WHERE customer_id=? AND created_at_external>=? AND created_at_external<?
    UNION ALL SELECT 'ticket_resolved',id,resolved_at_external,subject,ticket_number,external_url FROM external_tickets WHERE customer_id=? AND resolved_at_external>=? AND resolved_at_external<?
    UNION ALL SELECT 'activity_logged',id,activity_date||'T00:00:00.000Z',title,activity_reference,NULL FROM service_activities WHERE customer_id=? AND activity_date BETWEEN ? AND ?
    UNION ALL SELECT 'task_completed',tk.id,tk.updated_at,tk.title,p.title,NULL FROM tasks tk JOIN projects p ON p.id=tk.project_id
      WHERE p.customer_id=? AND tk.status IN ('completed','closed') AND tk.updated_at>=? AND tk.updated_at<?
    UNION ALL SELECT 'visit_completed',id,scheduled_date||'T00:00:00.000Z',title,NULL,NULL FROM maintenance_visits WHERE customer_id=? AND status='completed' AND scheduled_date BETWEEN ? AND ?
    UNION ALL SELECT 'visit_report_sent',id,report_sent_to_customer_at,title,NULL,NULL FROM maintenance_visits WHERE customer_id=? AND report_sent_to_customer_at>=? AND report_sent_to_customer_at<?
    UNION ALL SELECT 'project_closed',id,closed_at,title,NULL,NULL FROM projects WHERE customer_id=? AND closed_at>=? AND closed_at<?
    UNION ALL SELECT 'recommendation_created',id,created_at,finding,NULL,NULL FROM customer_recommendations WHERE customer_id=? AND created_at>=? AND created_at<?
    UNION ALL SELECT 'recommendation_completed',id,updated_at,recommendation,NULL,NULL
      FROM customer_recommendations WHERE customer_id=? AND status IN ('implemented','converted_to_project','closed') AND updated_at>=? AND updated_at<?`;
  const params=[customerId,start,end,customerId,start,end,customerId,from,to,customerId,start,end,customerId,from,to,customerId,start,end,customerId,start,end,customerId,start,end,customerId,start,end];
  const [rows,count]=await Promise.all([
    store.prepare(`SELECT * FROM (${sql}) events ORDER BY occurred_at DESC,kind,title,source_id DESC LIMIT ? OFFSET ?`).all(...params,pageSize,offset),
    store.prepare(`SELECT COUNT(*) AS total FROM (${sql}) events`).get(...params),
  ]);
  return { rows,total:Number(count.total),page,page_size:pageSize,period:{ from,to } };
}

module.exports={ listManagedCustomers,getOverview,listTickets,getTicketAnalytics,getActivities,getWork,getServiceReview,getTimeline };
