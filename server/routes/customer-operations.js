const router=require('express').Router({ mergeParams:true });
const db=require('../db');
const { requireAuth }=require('../middleware/auth');
const { positiveId,canAccessCustomer }=require('../customerAccess');

const parsePage=query => {
  for (const key of ['page','page_size']) if (query[key]!==undefined && (typeof query[key]!=='string' || !positiveId(query[key]))) return null;
  const page=Number(query.page || 1),pageSize=Number(query.page_size || 25);
  if (pageSize>100 || !Number.isSafeInteger((page-1)*pageSize)) return null;
  return { page,pageSize,offset:(page-1)*pageSize };
};
const searchPattern=value => `%${value.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')}%`;
async function authorizedCustomer(req,res) {
  if (!positiveId(req.params.id)) { res.status(400).json({ error:'Invalid customer ID' });return null; }
  const id=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(id)) { res.status(404).json({ error:'Customer not found' });return null; }
  if (!await canAccessCustomer(req.user,id)) { res.status(403).json({ error:'You do not have access to this customer' });return null; }
  return id;
}

function validateListQuery(query,allowedFilters) {
  const pagination=parsePage(query);
  if (!pagination) return { error:'Invalid pagination' };
  for (const key of ['search','filter','status','priority','engineer_id']) if (query[key]!==undefined && typeof query[key]!=='string') return { error:`${key} must be a single value` };
  if ((query.search || '').length>200) return { error:'Search cannot exceed 200 characters' };
  if (query.filter && !allowedFilters.includes(query.filter)) return { error:'Invalid filter' };
  if (query.engineer_id!==undefined && !positiveId(query.engineer_id)) return { error:'engineer_id must be a positive integer' };
  return pagination;
}

router.get('/summary',requireAuth,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid customer ID' });
  const customerId=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) return res.status(404).json({ error:'Customer not found' });
  if (!await canAccessCustomer(req.user,customerId)) return res.status(403).json({ error:'You do not have access to this customer' });
  const engineer=req.user.role==='engineer',planner=req.user.role==='planner',userId=req.user.id;
  const projectRestricted=engineer || planner;
  const projectJoin=projectRestricted ? ' JOIN project_assignments pa_scope ON pa_scope.project_id=p.id AND pa_scope.user_id=?' : '';
  const taskScope=engineer ? ' AND t.assigned_to=?' : '';
  const visitJoin=engineer ? ' JOIN maintenance_visit_engineers mve_scope ON mve_scope.visit_id=mv.id AND mve_scope.user_id=?' : '';
  const activityScope=engineer ? ' AND sa.engineer_id=?' : '';
  const activeRecommendations="r.status NOT IN ('implemented','rejected','closed','converted_to_project')";
  const [projects,tasks,recommendations,visits,lastVisit,nextVisit,activities,configuration,assets,tickets_ext]=await Promise.all([
    db.prepare(`SELECT COUNT(*) FILTER (WHERE p.status NOT IN ('closed','cancelled')) AS active,
      COUNT(*) FILTER (WHERE p.status NOT IN ('closed','cancelled') AND (p.status='delayed' OR (p.deadline IS NOT NULL AND p.deadline<app_today()))) AS delayed
      FROM projects p${projectJoin} WHERE p.customer_id=?`).get(...(projectRestricted?[userId]:[]),customerId),
    planner ? Promise.resolve({ open:0,overdue:0,in_progress:0,recently_completed:0 }) : db.prepare(`SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('completed','closed','cancelled')) AS open,
      COUNT(*) FILTER (WHERE t.status NOT IN ('completed','closed','cancelled') AND t.deadline IS NOT NULL AND t.deadline<app_today()) AS overdue,
      COUNT(*) FILTER (WHERE t.status='in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE t.status IN ('completed','closed') AND t.updated_at>=(app_now()::timestamp-INTERVAL '30 days')::text) AS recently_completed
      FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.customer_id=?${taskScope}`).get(customerId,...(engineer?[userId]:[])),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE ${activeRecommendations}) AS open,
      COUNT(*) FILTER (WHERE ${activeRecommendations} AND r.risk_level IN ('high','critical')) AS high_risk,
      COUNT(*) FILTER (WHERE r.status='in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE r.status='implemented') AS implemented
      FROM customer_recommendations r WHERE r.customer_id=?`).get(customerId),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE substr(mv.scheduled_date,1,4)=substr(app_today(),1,4)) AS this_year,
      COUNT(*) FILTER (WHERE mv.report_sent=0 AND mv.status NOT IN ('scheduled','cancelled')) AS reports_pending
      FROM maintenance_visits mv${visitJoin} WHERE mv.customer_id=?`).get(...(engineer?[userId]:[]),customerId),
    db.prepare(`SELECT mv.id,mv.title,mv.scheduled_date,mv.status,mv.report_sent,mv.report_sent_to_customer,mv.report_sent_at
      FROM maintenance_visits mv${visitJoin} WHERE mv.customer_id=? AND mv.scheduled_date<=app_today()
      ORDER BY mv.scheduled_date DESC,mv.id DESC LIMIT 1`).get(...(engineer?[userId]:[]),customerId),
    db.prepare(`SELECT mv.id,mv.title,mv.scheduled_date,mv.status,mv.report_sent,mv.report_sent_to_customer,mv.report_sent_at
      FROM maintenance_visits mv${visitJoin} WHERE mv.customer_id=? AND mv.scheduled_date>=app_today() AND mv.status<>'completed' AND mv.status<>'cancelled'
      ORDER BY mv.scheduled_date,mv.id LIMIT 1`).get(...(engineer?[userId]:[]),customerId),
    db.prepare(`SELECT sa.id,sa.activity_date,sa.title,sa.duration_minutes,sa.status,sa.engineer_id,u.name AS engineer_name,cat.name AS category_name
      FROM service_activities sa JOIN users u ON u.id=sa.engineer_id JOIN activity_categories cat ON cat.id=sa.category_id
      WHERE sa.customer_id=?${activityScope} ORDER BY sa.activity_date DESC,sa.id DESC LIMIT 6`).all(customerId,...(engineer?[userId]:[])),
    req.user.role==='manager' ? db.prepare(`SELECT mc.managed_services_enabled,mc.reporting_frequency,
      tc.enabled AS ticket_integration_enabled,tc.last_successful_sync_at,tc.last_sync_status,
      t.name AS responsible_team,u.name AS service_manager
      FROM managed_customer_configurations mc LEFT JOIN teams t ON t.id=mc.responsible_team_id LEFT JOIN users u ON u.id=mc.service_manager_id
      LEFT JOIN customer_ticketing_configurations tc ON tc.customer_id=mc.customer_id
      WHERE mc.customer_id=?`).get(customerId) : Promise.resolve(null),
    req.user.role==='manager' ? db.prepare('SELECT COUNT(*) AS total FROM customer_assets WHERE customer_id=?').get(customerId) : Promise.resolve({ total:0 }),
    req.user.role==='manager' ? db.prepare(`SELECT COUNT(*) FILTER (WHERE status_group='open') AS open,
      COUNT(*) FILTER (WHERE status_group='closed') AS closed FROM external_tickets WHERE customer_id=?`).get(customerId) : Promise.resolve({ open:0,closed:0 }),
  ]);
  const numbers=row => Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,Number(value || 0)]));
  let managed={ visible:req.user.role==='manager',state:'unavailable' };
  if (req.user.role==='manager') {
    const ticketCounts={ open_tickets:Number(tickets_ext.open || 0),closed_tickets:Number(tickets_ext.closed || 0) };
    if (!configuration?.managed_services_enabled) managed={ visible:true,state:'not_enabled' };
    else if (!configuration.ticket_integration_enabled) managed={ visible:true,state:'setup_required',...configuration };
    else if (configuration.last_sync_status && configuration.last_sync_status!=='success') managed={ visible:true,state:'sync_attention',...configuration,...ticketCounts };
    else managed={ visible:true,state:'active',...configuration,...ticketCounts };
  }
  res.json({ projects:numbers(projects),tasks:{ ...numbers(tasks),visible:!planner },recommendations:numbers(recommendations),
    visits:{ ...numbers(visits),last:lastVisit || null,next:nextVisit || null },activities:{ recent:activities },
    assets:Number(assets.total || 0),managed });
});

router.get('/projects',requireAuth,async (req,res) => {
  const customerId=await authorizedCustomer(req,res);if (!customerId) return;
  const paging=validateListQuery(req.query,['all','active','delayed','completed']);if (paging.error) return res.status(400).json({ error:paging.error });
  const clauses=['p.customer_id=?'],params=[customerId],filter=req.query.filter || 'all';
  const restricted=req.user.role!=='manager';
  const join=restricted ? ' JOIN project_assignments pa_scope ON pa_scope.project_id=p.id AND pa_scope.user_id=?' : '';
  if (restricted) params.unshift(req.user.id);
  if (filter==='active') clauses.push("p.status NOT IN ('completed','closed','cancelled')");
  if (filter==='completed') clauses.push("p.status IN ('completed','closed')");
  if (filter==='delayed') clauses.push("p.status NOT IN ('completed','closed','cancelled') AND (p.status='delayed' OR (p.deadline IS NOT NULL AND p.deadline<app_today()))");
  if (req.query.search?.trim()) { clauses.push('LOWER(p.title) ILIKE ?');params.push(searchPattern(req.query.search)); }
  const where=clauses.join(' AND ');
  const rows=await db.prepare(`SELECT p.id,p.customer_id,p.title,p.status,p.priority,p.created_at AS start_date,p.deadline,p.completion_pct,p.created_by,u.name AS owner_name,
    SUM(CASE WHEN t.id IS NOT NULL AND t.status<>'cancelled' THEN 1 ELSE 0 END) AS task_count,
    SUM(CASE WHEN t.status IN ('completed','closed') THEN 1 ELSE 0 END) AS done_count
    FROM projects p${join} JOIN users u ON u.id=p.created_by LEFT JOIN tasks t ON t.project_id=p.id WHERE ${where}
    GROUP BY p.id,p.customer_id,p.title,p.status,p.priority,p.created_at,p.deadline,p.completion_pct,p.created_by,u.name
    ORDER BY CASE WHEN p.deadline IS NULL THEN 1 ELSE 0 END,p.deadline,p.id LIMIT ? OFFSET ?`).all(...params,paging.pageSize,paging.offset);
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM projects p${join} WHERE ${where}`).get(...params);
  const members=rows.length ? await db.prepare(`SELECT pa.project_id,u.id,u.name FROM project_assignments pa JOIN users u ON u.id=pa.user_id
    WHERE pa.project_id IN (${rows.map(() => '?').join(',')}) ORDER BY u.name,u.id`).all(...rows.map(row => row.id)) : [];
  const byProject=new Map();for(const member of members) { if(!byProject.has(member.project_id)) byProject.set(member.project_id,[]);byProject.get(member.project_id).push({ id:member.id,name:member.name }); }
  res.json({ rows:rows.map(row => ({ ...row,completion_pct:row.completion_pct==null ? (Number(row.task_count)?Math.round(Number(row.done_count)*100/Number(row.task_count)):0) : Number(row.completion_pct),members:byProject.get(row.id) || [] })),total:Number(count.total),page:paging.page,page_size:paging.pageSize });
});

router.get('/tasks',requireAuth,async (req,res) => {
  if (!['manager','engineer'].includes(req.user.role)) return res.status(403).json({ error:'Forbidden' });
  const customerId=await authorizedCustomer(req,res);if (!customerId) return;
  const paging=validateListQuery(req.query,['all','open','in_progress','overdue','recently_completed']);if (paging.error) return res.status(400).json({ error:paging.error });
  if (req.query.priority && !['low','medium','high','critical'].includes(req.query.priority)) return res.status(400).json({ error:'Invalid priority' });
  if (req.query.status && !['open','in_progress','waiting_customer','waiting_vendor','completed','pending_approval','cancelled','closed'].includes(req.query.status)) return res.status(400).json({ error:'Invalid status' });
  const clauses=['p.customer_id=?'],params=[customerId],filter=req.query.filter || 'all';
  if (req.user.role==='engineer') { clauses.push('t.assigned_to=?');params.push(req.user.id); }
  else if (req.query.engineer_id) { clauses.push('t.assigned_to=?');params.push(Number(req.query.engineer_id)); }
  if (filter==='open') clauses.push("t.status NOT IN ('completed','closed','cancelled')");
  if (filter==='in_progress') clauses.push("t.status='in_progress'");
  if (filter==='overdue') clauses.push("t.status NOT IN ('completed','closed','cancelled') AND t.deadline IS NOT NULL AND t.deadline<app_today()");
  if (filter==='recently_completed') clauses.push("t.status IN ('completed','closed') AND t.updated_at>=app_now()-INTERVAL '30 days'");
  if (req.query.status) { clauses.push('t.status=?');params.push(req.query.status); }
  if (req.query.priority) { clauses.push('t.priority=?');params.push(req.query.priority); }
  if (req.query.search?.trim()) { const pattern=searchPattern(req.query.search);clauses.push('(LOWER(t.title) ILIKE ? OR LOWER(p.title) ILIKE ? OR LOWER(COALESCE(u.name,\'\')) ILIKE ?)');params.push(pattern,pattern,pattern); }
  const where=clauses.join(' AND ');
  const rows=await db.prepare(`SELECT t.id,t.project_id,t.title,t.status,t.priority,t.deadline,t.updated_at,t.assigned_to,u.name AS assigned_to_name,p.title AS project_title,p.customer_id
    FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assigned_to WHERE ${where}
    ORDER BY CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END,t.deadline,t.id LIMIT ? OFFSET ?`).all(...params,paging.pageSize,paging.offset);
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assigned_to WHERE ${where}`).get(...params);
  res.json({ rows,total:Number(count.total),page:paging.page,page_size:paging.pageSize });
});

router.get('/visits',requireAuth,async (req,res) => {
  const customerId=await authorizedCustomer(req,res);if (!customerId) return;
  const paging=validateListQuery(req.query,['all','upcoming','past','report_pending','awaiting_review','cancelled']);if (paging.error) return res.status(400).json({ error:paging.error });
  const clauses=['mv.customer_id=?'],params=[customerId],filter=req.query.filter || 'all';
  const join=req.user.role==='engineer' ? ' JOIN maintenance_visit_engineers mve_scope ON mve_scope.visit_id=mv.id AND mve_scope.user_id=?' : '';
  if (req.user.role==='engineer') params.unshift(req.user.id);
  if (filter==='upcoming') clauses.push("mv.status='scheduled' AND mv.scheduled_date>=app_today()");
  if (filter==='past') clauses.push("(mv.scheduled_date<app_today() OR mv.status='completed')");
  if (filter==='report_pending') clauses.push("mv.report_sent=0 AND mv.status<>'scheduled' AND mv.status<>'cancelled'");
  if (filter==='awaiting_review') clauses.push('mv.report_sent=1 AND mv.report_sent_to_customer=0');
  if (filter==='cancelled') clauses.push("mv.status='cancelled'");
  if (req.query.search?.trim()) { clauses.push('LOWER(mv.title) ILIKE ?');params.push(searchPattern(req.query.search)); }
  const where=clauses.join(' AND ');
  const rows=await db.prepare(`SELECT mv.id,mv.customer_id,mv.title,mv.scheduled_date,mv.status,mv.report_sent,mv.report_sent_at,mv.report_sent_to_customer,mv.report_sent_to_customer_at
    FROM maintenance_visits mv${join} WHERE ${where} ORDER BY mv.scheduled_date DESC,mv.id DESC LIMIT ? OFFSET ?`).all(...params,paging.pageSize,paging.offset);
  const count=await db.prepare(`SELECT COUNT(*) AS total FROM maintenance_visits mv${join} WHERE ${where}`).get(...params);
  const engineers=rows.length ? await db.prepare(`SELECT mve.visit_id,u.id,u.name FROM maintenance_visit_engineers mve JOIN users u ON u.id=mve.user_id
    WHERE mve.visit_id IN (${rows.map(() => '?').join(',')}) ORDER BY u.name,u.id`).all(...rows.map(row => row.id)) : [];
  const byVisit=new Map();for(const engineer of engineers) { if(!byVisit.has(engineer.visit_id)) byVisit.set(engineer.visit_id,[]);byVisit.get(engineer.visit_id).push({ id:engineer.id,name:engineer.name }); }
  res.json({ rows:rows.map(row => ({ ...row,engineers:byVisit.get(row.id) || [] })),total:Number(count.total),page:paging.page,page_size:paging.pageSize });
});

router.get('/timeline',requireAuth,async (req,res) => {
  const customerId=await authorizedCustomer(req,res);if (!customerId) return;
  const paging=parsePage(req.query);if (!paging) return res.status(400).json({ error:'Invalid pagination' });
  const events=[],params=[],role=req.user.role;
  const add=(sql,...values) => { events.push(sql);params.push(...values); };
  const projectJoin=role==='manager' ? '' : ' JOIN project_assignments pa_scope ON pa_scope.project_id=p.id AND pa_scope.user_id=?';
  const projectParams=role==='manager' ? [customerId] : [req.user.id,customerId];
  add(`SELECT p.id AS event_id,'project' AS kind,p.id AS entity_id,p.title,p.created_at AS event_at,'Project created' AS action,u.name AS actor_name FROM projects p${projectJoin} LEFT JOIN users u ON u.id=p.created_by WHERE p.customer_id=?`,...projectParams);
  if (role!=='planner') add(`SELECT t.id,'task',t.id,t.title,t.created_at,'Task created',u.name FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.created_by WHERE p.customer_id=?${role==='engineer'?' AND t.assigned_to=?':''}`,customerId,...(role==='engineer'?[req.user.id]:[]));
  const visitJoin=role==='engineer' ? ' JOIN maintenance_visit_engineers mve_scope ON mve_scope.visit_id=mv.id AND mve_scope.user_id=?' : '';
  const visitParams=role==='engineer' ? [req.user.id,customerId] : [customerId];
  add(`SELECT mv.id,'visit',mv.id,mv.title,mv.created_at,'Visit scheduled',u.name FROM maintenance_visits mv${visitJoin} LEFT JOIN users u ON u.id=mv.created_by WHERE mv.customer_id=?`,...visitParams);
  add(`SELECT mv.id,'visit_report',mv.id,mv.title,mv.report_sent_at,'Report submitted',u.name FROM maintenance_visits mv${visitJoin} LEFT JOIN users u ON u.id=mv.report_sent_by WHERE mv.customer_id=? AND mv.report_sent=1 AND mv.report_sent_at IS NOT NULL`,...visitParams);
  add(`SELECT sa.id,'activity',sa.id,sa.title,sa.created_at,'Service activity logged',u.name FROM service_activities sa LEFT JOIN users u ON u.id=sa.engineer_id WHERE sa.customer_id=?${role==='engineer'?' AND sa.engineer_id=?':''}`,customerId,...(role==='engineer'?[req.user.id]:[]));
  add(`SELECT h.id,'recommendation',r.id,substr(r.finding,1,300),h.created_at,h.action,u.name FROM recommendation_history h JOIN customer_recommendations r ON r.id=h.recommendation_id LEFT JOIN users u ON u.id=h.user_id WHERE r.customer_id=?`,customerId);
  if (role==='manager') add(`SELECT h.id,'asset',h.asset_id,'Customer asset',h.created_at,h.action,u.name FROM customer_asset_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.customer_id=?`,customerId);
  const union=events.join(' UNION ALL '),offset=paging.offset;
  const [rows,count]=await Promise.all([
    db.prepare(`SELECT * FROM (${union}) events ORDER BY event_at DESC,kind,event_id DESC LIMIT ? OFFSET ?`).all(...params,paging.pageSize,offset),
    db.prepare(`SELECT COUNT(*) AS total FROM (${union}) events`).get(...params),
  ]);
  res.json({ rows,total:Number(count.total),page:paging.page,page_size:paging.pageSize });
});

module.exports=router;
