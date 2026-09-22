const router=require('express').Router({ mergeParams:true });
const db=require('../db');
const { requireAuth }=require('../middleware/auth');
const { positiveId,canAccessCustomer }=require('../customerAccess');

router.get('/summary',requireAuth,async (req,res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid customer ID' });
  const customerId=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) return res.status(404).json({ error:'Customer not found' });
  if (!await canAccessCustomer(req.user,customerId)) return res.status(403).json({ error:'You do not have access to this customer' });
  const engineer=req.user.role==='engineer',userId=req.user.id;
  const projectJoin=engineer ? ' JOIN project_assignments pa_scope ON pa_scope.project_id=p.id AND pa_scope.user_id=?' : '';
  const taskScope=engineer ? ' AND t.assigned_to=?' : '';
  const visitJoin=engineer ? ' JOIN maintenance_visit_engineers mve_scope ON mve_scope.visit_id=mv.id AND mve_scope.user_id=?' : '';
  const activityScope=engineer ? ' AND sa.engineer_id=?' : '';
  const activeRecommendations="r.status NOT IN ('implemented','rejected','closed','converted_to_project')";
  const [projects,tasks,recommendations,visits,lastVisit,nextVisit,activities,configuration,assets]=await Promise.all([
    db.prepare(`SELECT COUNT(*) FILTER (WHERE p.status NOT IN ('closed','cancelled')) AS active,
      COUNT(*) FILTER (WHERE p.status NOT IN ('closed','cancelled') AND (p.status='delayed' OR (p.deadline IS NOT NULL AND p.deadline<app_today()))) AS delayed
      FROM projects p${projectJoin} WHERE p.customer_id=?`).get(...(engineer?[userId]:[]),customerId),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('completed','closed','cancelled')) AS open,
      COUNT(*) FILTER (WHERE t.status NOT IN ('completed','closed','cancelled') AND t.deadline IS NOT NULL AND t.deadline<app_today()) AS overdue,
      COUNT(*) FILTER (WHERE t.status='in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE t.status IN ('completed','closed') AND t.updated_at>=app_now()-INTERVAL '30 days') AS recently_completed
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
  ]);
  const numbers=row => Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,Number(value || 0)]));
  let managed={ visible:req.user.role==='manager',state:'unavailable' };
  if (req.user.role==='manager') {
    if (!configuration?.managed_services_enabled) managed={ visible:true,state:'not_enabled' };
    else if (!configuration.ticket_integration_enabled) managed={ visible:true,state:'setup_required',...configuration };
    else if (configuration.last_sync_status && configuration.last_sync_status!=='success') managed={ visible:true,state:'sync_attention',...configuration };
    else managed={ visible:true,state:'active',...configuration };
  }
  res.json({ projects:numbers(projects),tasks:numbers(tasks),recommendations:numbers(recommendations),
    visits:{ ...numbers(visits),last:lastVisit || null,next:nextVisit || null },activities:{ recent:activities },
    assets:Number(assets.total || 0),managed });
});

module.exports=router;
