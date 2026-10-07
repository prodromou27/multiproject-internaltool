const { validDate } = require('./workloadModel');
const appTime = require('./appTime');
// A field is SQL plus a type. Lookup types (customer, user, team, project,
// category) hold an ID in SQL and show the name; `encrypted` fields are stored
// encrypted, so they are shown and sorted but cannot be filtered or grouped.
const field = (sql,type,label,options = {}) => ({ sql,type,label,...options });
const LOOKUPS = ['customer','user','team','project','category'];
const enc = (sql,label) => field(sql,'text',label,{ encrypted: true });
const common = { id: field('r.id','id','ID'),title: field('r.title','text','Title'),status: field('r.status','text','Status'),created_at: field('r.created_at','text','Created at'),created_date: field('substr(r.created_at,1,10)','date','Created date (UTC)') };
const SOURCES = {
  projects: { label: 'Projects',grain: 'One row per project',from: 'projects r',fields: { ...common,customer_id: field('r.customer_id','customer','Customer'),priority: field('r.priority','text','Priority'),deadline: field('r.deadline','date','Deadline'),closed_date: field('substr(r.closed_at,1,10)','date','Closed date') } },
  tasks: { label: 'Tasks',grain: 'One row per task; customer is its own or its project\'s',from: 'tasks r LEFT JOIN projects p ON p.id=r.project_id',fields: { ...common,project_id: field('r.project_id','project','Project'),customer_id: field('COALESCE(r.customer_id,p.customer_id)','customer','Customer'),engineer_id: field('r.assigned_to','user','Assigned engineer'),priority: field('r.priority','text','Priority'),deadline: field('r.deadline','date','Deadline'),is_adhoc: field('r.is_adhoc','number','Ad-hoc flag') } },
  visits: { label: 'Maintenance visits',grain: 'One row per visit, including multi-engineer visits once',from: 'maintenance_visits r',fields: { ...common,customer_id: field('r.customer_id','customer','Customer'),scheduled_date: field('r.scheduled_date','date','Scheduled date'),report_sent: field('r.report_sent','number','Report submitted'),report_forwarded: field('r.report_sent_to_customer','number','Report forwarded') } },
  activities: { label: 'Service activities',grain: 'One row per service activity',from: 'service_activities r',fields: { ...common,reference: field('r.activity_reference','text','Reference'),customer_id: field('r.customer_id','customer','Customer'),engineer_id: field('r.engineer_id','user','Engineer'),team_id: field('r.team_id','team','Team'),category_id: field('r.category_id','category','Category'),activity_date: field('r.activity_date','date','Activity date'),duration_minutes: field('r.duration_minutes','number','Duration minutes'),hours: field('r.duration_minutes/60.0','number','Hours'),classification: field('r.billable_classification','text','Billable classification'),location: field('r.work_location','text','Work location'),ticket: field('r.ticket_reference','text','Ticket reference'),description: field('r.description','text','Description') } },
  recommendations: { label: 'Customer recommendations',grain: 'One row per recommendation',from: 'customer_recommendations r',fields: { id: common.id,status: common.status,created_at: common.created_at,created_date: common.created_date,customer_id: field('r.customer_id','customer','Customer'),owner_id: field('r.owner_id','user','Owner'),finding: field('r.finding','text','Finding'),recommendation: field('r.recommendation','text','Recommendation'),risk_level: field('r.risk_level','text','Risk level'),due_date: field('r.due_date','date','Due date'),project_id: field('r.related_project_id','project','Converted project') } },
  tickets: { label: 'Tickets',grain: 'One row per ticket synced from the ticketing system',from: 'external_tickets r',fields: { id: common.id,ticket_number: field('r.ticket_number','text','Ticket'),subject: field('r.subject','text','Subject'),customer_id: field('r.customer_id','customer','Customer'),queue: field('r.external_queue_name','text','Queue'),status: field('r.normalized_status','text','Status'),status_group: field('r.status_group','text','Open or closed'),priority: field('r.normalized_priority','text','Priority'),owner: field('r.owner_name','text','Owner (RT)'),owner_user_id: field('r.owner_user_id','user','Engineer'),category: field('r.category','text','Category'),created_date: field('substr(r.created_at_external,1,10)','date','Created date'),updated_date: field('substr(r.updated_at_external,1,10)','date','Updated date'),resolved_date: field('substr(r.resolved_at_external,1,10)','date','Resolved date'),closed_date: field('substr(r.closed_at_external,1,10)','date','Closed date'),sla_due_date: field('substr(r.sla_due_at,1,10)','date','SLA due date'),sla_breached: field('r.sla_breached','number','SLA breached (1 = yes)') } },
  assets: { label: 'Assets',grain: 'One row per customer asset',from: 'customer_assets r',fields: { id: common.id,name: enc('r.name','Asset'),customer_id: field('r.customer_id','customer','Customer'),asset_type: field('r.asset_type','text','Type'),vendor: enc('r.vendor','Vendor'),model: enc('r.model','Model'),version: enc('r.software_version','Software version'),environment: field('r.environment','text','Environment'),criticality: field('r.criticality','text','Criticality'),lifecycle: field('r.lifecycle_status','text','Lifecycle'),coverage: field('r.coverage_type','text','Coverage'),support_provider: enc('r.support_provider','Support provider'),support_end: field('r.support_end_date','date','Support ends'),warranty_end: field('r.warranty_expiry_date','date','Warranty ends'),location: enc('r.location','Location'),created_date: common.created_date } },
  cves: { label: 'CVEs',grain: 'One row per CVE for the vendors and products we watch',from: 'cves r LEFT JOIN cve_kev k ON k.cve_id=r.id',fields: { cve: field('r.id','text','CVE'),published: field('substr(r.published,1,10)','date','Published'),modified: field('substr(r.last_modified,1,10)','date','Last modified'),severity: field('r.severity','text','Severity'),cvss: field('r.cvss_score','number','CVSS score'),products: field('r.products','text','Products'),description: field('r.description','text','Description'),known_exploited: field('CASE WHEN k.cve_id IS NULL THEN 0 ELSE 1 END','number','Known exploited (1 = yes)'),kev_added: field('k.date_added','date','Added to KEV'),kev_due: field('k.due_date','date','KEV due date'),ransomware: field('k.ransomware','text','Used in ransomware') } },
  time_logs: { label: 'Time logs',grain: 'One row per time entry on a task or visit',from: 'time_logs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN maintenance_visits v ON v.id=r.visit_id',fields: { id: common.id,user_id: field('r.user_id','user','Engineer'),logged_date: field('substr(r.logged_at,1,10)','date','Date'),hours: field('r.hours','number','Hours'),description: field('r.description','text','Description'),task: field('t.title','text','Task'),project_id: field('t.project_id','project','Project'),visit: field('v.title','text','Maintenance visit'),customer_id: field('COALESCE(t.customer_id,p.customer_id,v.customer_id)','customer','Customer') } },
};
const idOperators = ['eq','neq','in','not_in','is_null','is_not_null'];
const OPERATORS = { text: ['eq','neq','contains','in','not_in','is_null','is_not_null'],id: idOperators,date: ['eq','neq','lt','lte','gt','gte','in','not_in','is_null','is_not_null'],number: ['eq','neq','lt','lte','gt','gte','in','not_in','is_null','is_not_null'],...Object.fromEntries(LOOKUPS.map(type => [type,idOperators])) };
const fail = message => { throw Object.assign(new Error(message),{ status: 400 }); };
const object = value => value && typeof value==='object' && !Array.isArray(value);
function shape(value,keys,label) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(`Invalid ${label}`);
}
function array(value,max,label) {
  if (!Array.isArray(value) || value.length>max) fail(`${label} must be an array of at most ${max} entries`);
  return value;
}
function metadata() {
  return Object.entries(SOURCES).map(([key,source]) => ({ key,label: source.label,grain: source.grain,fields: Object.entries(source.fields).map(([name,value]) => ({ key: name,type: value.type,label: value.label,lookup: LOOKUPS.includes(value.type),filterable: !value.encrypted,groupable: !value.encrypted,operators: value.encrypted ? [] : OPERATORS[value.type],aggregations: value.type==='number' ? ['count','sum','avg','min','max'] : ['count'] })) }));
}
const RELATIVE_ANCHORS = ['today','week_start','week_end','month_start','month_end'];
function relativeDate(relative,now) {
  shape(relative,['anchor','offset_days'],'relative date');
  if (!RELATIVE_ANCHORS.includes(relative.anchor) || !Number.isSafeInteger(relative.offset_days) || Math.abs(relative.offset_days)>3660) fail('Invalid relative date');
  // "Today" in the organisation's time zone; the arithmetic below is on that calendar date.
  const date = new Date(`${appTime.today(now)}T00:00:00Z`);
  if (relative.anchor==='week_start' || relative.anchor==='week_end') {
    const mondayOffset = (date.getUTCDay()+6)%7;
    date.setUTCDate(date.getUTCDate()-mondayOffset+(relative.anchor==='week_end' ? 6 : 0));
  } else if (relative.anchor==='month_start') date.setUTCDate(1);
  else if (relative.anchor==='month_end') date.setUTCMonth(date.getUTCMonth()+1,0);
  date.setUTCDate(date.getUTCDate()+relative.offset_days);
  return date.toISOString().slice(0,10);
}
function compileReport(definition,limit,now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) fail('Invalid report execution date');
  shape(definition,['source','fields','filters','group_by','aggregations','sort'],'report definition');
  if (typeof definition.source!=='string' || !Object.hasOwn(SOURCES,definition.source)) fail('Unknown report source');
  const source = SOURCES[definition.source];
  const get = key => {
    if (typeof key!=='string' || !Object.hasOwn(source.fields,key)) fail('Unknown report field');
    return source.fields[key];
  };
  const fields = array(definition.fields ?? [],12,'Fields');
  const groups = array(definition.group_by ?? [],4,'Groups');
  if (new Set(fields).size!==fields.length || new Set(groups).size!==groups.length) fail('Duplicate report fields');
  fields.forEach(get); groups.forEach(get);
  if (groups.some(key => get(key).encrypted)) fail('Encrypted fields cannot be grouped');
  const metrics = array(definition.aggregations ?? [],6,'Aggregations');
  const grouped = groups.length>0 || metrics.length>0;
  if (grouped && (fields.length!==groups.length || fields.some(key => !groups.includes(key)))) fail('Grouped fields must match group_by');
  if (!grouped && !fields.length) fail('Choose at least one field');
  const columns = (grouped ? groups : fields).map(key => ({ key,label: get(key).label,sql: get(key).sql,...(LOOKUPS.includes(get(key).type) ? { lookup: get(key).type } : {}),...(get(key).encrypted ? { encrypted: true } : {}) }));
  metrics.forEach((metric,index) => {
    shape(metric,['field','operation'],'aggregation');
    if (metric.field==='*' && metric.operation==='count') columns.push({ key: `metric_${index}`,label: 'Record count',sql: 'COUNT(*)' });
    else {
      const value = get(metric.field);
      if (!['count','sum','avg','min','max'].includes(metric.operation) || metric.operation!=='count' && value.type!=='number') fail('Unsupported aggregation');
      if (value.encrypted) fail('Encrypted fields cannot be aggregated');
      columns.push({ key: `metric_${index}`,label: `${metric.operation.toUpperCase()} ${value.label}`,sql: `${metric.operation.toUpperCase()}(${value.sql})` });
    }
  });
  if (!columns.length || columns.length>12) fail('Choose between 1 and 12 output columns');
  const params = [],clauses = [];
  const scalar = (value,type) => {
    const valid = type==='date' ? validDate(value) : type==='number' ? typeof value==='number' && Number.isFinite(value) : type==='id' || LOOKUPS.includes(type) ? Number.isSafeInteger(value) && value>0 : typeof value==='string' && value.length<=5000;
    if (!valid) fail('Filter value does not match its field type');
    return value;
  };
  array(definition.filters ?? [],12,'Filters').forEach(filter => {
    shape(filter,['field','operator','value','relative'],'filter');
    const value = get(filter.field);
    if (value.encrypted) fail(`${value.label} is stored encrypted and cannot be filtered`);
    if (!OPERATORS[value.type].includes(filter.operator)) fail('Unsupported filter operator');
    if (filter.relative!==undefined && (filter.value!==undefined || value.type!=='date' || ['in','not_in','is_null','is_not_null'].includes(filter.operator))) fail('Relative dates require a scalar date comparison');
    if (['is_null','is_not_null'].includes(filter.operator)) {
      if (filter.value!==undefined || filter.relative!==undefined) fail('Null operators do not accept values');
      clauses.push(`${value.sql} IS ${filter.operator==='is_not_null' ? 'NOT ' : ''}NULL`);
    } else if (['in','not_in'].includes(filter.operator)) {
      const entries = array(filter.value,50,'IN values');
      if (!entries.length) fail('IN requires values');
      entries.forEach(entry => params.push(scalar(entry,value.type)));
      clauses.push(`${value.sql} ${filter.operator==='not_in' ? 'NOT IN' : 'IN'} (${entries.map(() => '?').join(',')})`);
    } else {
      const entry = filter.relative===undefined ? scalar(filter.value,value.type) : relativeDate(filter.relative,now);
      if (filter.operator==='contains') {
        params.push(`%${entry.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`);
        clauses.push(`LOWER(${value.sql}) ILIKE ?`);
      } else {
        params.push(entry);
        const operator = { eq: '=',neq: '<>',lt: '<',lte: '<=',gt: '>',gte: '>=' }[filter.operator];
        clauses.push(`${value.sql}${operator}?`);
      }
    }
  });
  const sortList = array(definition.sort ?? [],3,'Sorts');
  sortList.forEach(sort => { shape(sort,['field','direction'],'sort'); if (!['asc','desc'].includes(sort.direction)) fail('Invalid sort direction'); });
  // Names and encrypted values only exist after the query, so sorting by them
  // happens then, on the output columns.
  const byName = sortList.some(sort => { const column = columns.find(entry => entry.key===sort.field); return column && (column.lookup || column.encrypted); });
  if (byName && sortList.some(sort => !columns.some(column => column.key===sort.field))) fail('To sort by a name, sort only by output columns');
  const sorts = byName ? [] : sortList.map(sort => {
    const selected = columns.find(column => column.key===sort.field);
    const sql = grouped ? selected?.sql : get(sort.field).sql;
    if (!sql) fail('Grouped sorts must refer to an output column');
    return `${sql} ${sort.direction.toUpperCase()} NULLS LAST`;
  });
  const stable = grouped ? groups.map(key => `${get(key).sql} ASC NULLS LAST`) : [`${Object.values(source.fields)[0].sql} ASC`];
  const order = [...sorts,...stable];
  const sql = `SELECT ${columns.map(column => `${column.sql} AS "${column.key}"`).join(',')} FROM ${source.from}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}${groups.length ? ` GROUP BY ${groups.map(key => get(key).sql).join(',')}` : ''}${order.length ? ` ORDER BY ${order.join(',')}` : ''} LIMIT ?`;
  return { sql,params: [...params,limit+1],columns: columns.map(({ key,label,lookup,encrypted }) => ({ key,label,...(lookup ? { lookup } : {}),...(encrypted ? { encrypted } : {}) })),postSort: byName ? sortList : [] };
}
function csvCell(value) {
  if (value==null) return '""';
  let text = String(value);
  if (typeof value==='string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
module.exports = { SOURCES,LOOKUPS,metadata,compileReport,csvCell };
