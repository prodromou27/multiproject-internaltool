// Dates are resolved when a template is loaded. Saved definitions retain those dates.
function reportTemplates(now = new Date(), config = {}) {
  const today = now.toISOString().slice(0,10);
  const monthStart = today.slice(0,7)+'-01';
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const range = field => [{ field,operator: 'gte',value: monthStart },{ field,operator: 'lte',value: monthEnd }];
  const count = { field: '*',operation: 'count' };
  const minutes = { field: 'duration_minutes',operation: 'sum' };
  const group = (source,fields,filters,aggregations = [count]) => ({ source,fields,group_by: fields,aggregations,filters });
  const terminal = [...new Set(['closed','cancelled',...(Array.isArray(config.project) ? config.project.filter(row => row.is_terminal && typeof row.value==='string').map(row => row.value) : [])])];
  const rows = [
    { key: 'monthly_customer_activity',label: 'Monthly customer activity',description: 'Current UTC month; add a customer ID filter for a single customer.',definition: { source: 'activities',fields: ['id','reference','customer_id','engineer_id','activity_date','title','status','duration_minutes','classification'],filters: range('activity_date') } },
    { key: 'engineer_activity',label: 'Engineer activity',description: 'Current UTC month: activity counts and recorded minutes by engineer.',definition: group('activities',['engineer_id'],range('activity_date'),[count,minutes]) },
    { key: 'team_activity',label: 'Team activity',description: 'Current UTC month: activity counts and recorded minutes by team.',definition: group('activities',['team_id'],range('activity_date'),[count,minutes]) },
    { key: 'project_delivery',label: 'Project delivery',description: 'Current project status and deadlines; completion dates are not inferred.',definition: { source: 'projects',fields: ['id','title','customer_id','status','deadline'],sort: [{ field: 'deadline',direction: 'asc' }] } },
    { key: 'maintenance_visits',label: 'Maintenance visits',description: 'Visits scheduled in the current UTC month, including report flags.',definition: { source: 'visits',fields: ['id','title','customer_id','status','scheduled_date','report_sent','report_forwarded'],filters: range('scheduled_date') } },
    { key: 'pending_visit_reports',label: 'Maintenance reports pending',description: 'Completed visits without a submitted report.',definition: { source: 'visits',fields: ['id','title','customer_id','scheduled_date','report_sent'],filters: [{ field: 'status',operator: 'eq',value: 'completed' },{ field: 'report_sent',operator: 'eq',value: 0 }],sort: [{ field: 'scheduled_date',direction: 'asc' }] } },
    { key: 'customer_service_hours',label: 'Customer service time',description: 'Current UTC month: recorded minutes by customer and classification. Divide minutes by 60 for hours; this is not capacity.',definition: group('activities',['customer_id','classification'],range('activity_date'),[count,minutes]) },
    { key: 'recommendation_status',label: 'Recommendation status',description: 'Recommendation counts by status and risk.',definition: group('recommendations',['status','risk_level'],[]) },
    { key: 'approval_backlog',label: 'Approval backlog',description: 'Projects awaiting closure review.',definition: { source: 'projects',fields: ['id','title','customer_id','status','deadline'],filters: [{ field: 'status',operator: 'eq',value: 'pending_approval' }] } },
    { key: 'customer_activity_summary',label: 'Customer activity summary',description: 'Current UTC month: activity counts and recorded minutes per customer.',definition: group('activities',['customer_id'],range('activity_date'),[count,minutes]) },
  ];
  // Keep the engine's IN-value limit; never silently omit configured terminal states.
  if (terminal.length<=50) rows.push({ key: 'overdue_projects',label: 'Overdue projects',description: 'Deadlines before today, excluding default and configured terminal states.',definition: { source: 'projects',fields: ['id','title','customer_id','status','deadline'],filters: [{ field: 'deadline',operator: 'lt',value: today },{ field: 'status',operator: 'not_in',value: terminal }],sort: [{ field: 'deadline',direction: 'asc' }] } });
  return { as_of: today,month_start: monthStart,month_end: monthEnd,rows };
}
module.exports = { reportTemplates };
